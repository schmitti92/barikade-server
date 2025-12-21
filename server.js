import express from "express";
import http from "http";
import { WebSocketServer } from "ws";

const PORT = process.env.PORT || 10000;

// ===== HTTP (health) =====
const app = express();
app.get("/", (_req, res) => res.status(200).send("barikade-server ok"));
app.get("/health", (_req, res) => res.status(200).json({ ok: true, ts: Date.now() }));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// ===== helpers =====
const COLORS = ["red","blue","green","yellow"];
const CLAIM_TTL_MS = 10 * 60 * 1000; // 10 min reservation after disconnect

function now(){ return Date.now(); }
function safeSend(ws, obj){
  try{
    if(ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
  }catch(_e){}
}

function makeId(){
  return Math.random().toString(36).slice(2,10) + "-" + Math.random().toString(36).slice(2,6);
}

// ===== room model =====
// rooms.get(code) = {
//   code,
//   hostClientId: string|null,
//   clientsByWs: Map<ws, clientId>,
//   clients: Map<clientId, { clientId, role, name, connected, lastSeen, lastWs, color } >,
//   colorClaims: Map<color, { clientId, ts } >,
//   lastSnapshot: object|null,
//   lastState: object|null
// }
const rooms = new Map();

function getRoom(code){
  const key = String(code || "").trim();
  if(!key) return null;
  if(!rooms.has(key)){
    rooms.set(key, {
      code:key,
      hostClientId:null,
      clientsByWs:new Map(),
      clients:new Map(),
      colorClaims:new Map(),
      lastSnapshot:null,
      lastState:null
    });
  }
  return rooms.get(key);
}

function cleanupClaims(room){
  const t = now();
  for(const [color, rec] of room.colorClaims.entries()){
    if(t - rec.ts > CLAIM_TTL_MS){
      room.colorClaims.delete(color);
      // also clear from client record if still set to that color
      const c = room.clients.get(rec.clientId);
      if(c && c.color === color) c.color = null;
    }
  }
}

function roster(room){
  cleanupClaims(room);
  const players = [];
  for(const c of room.clients.values()){
    players.push({
      clientId: c.clientId,
      name: c.name || "",
      role: c.role || "client",
      connected: !!c.connected,
      color: c.color || null,
      isHost: room.hostClientId === c.clientId
    });
  }
  // stable ordering: host first, then by color order, then name
  players.sort((a,b)=>{
    if(a.isHost && !b.isHost) return -1;
    if(!a.isHost && b.isHost) return 1;
    const ai = a.color ? COLORS.indexOf(a.color) : 99;
    const bi = b.color ? COLORS.indexOf(b.color) : 99;
    if(ai !== bi) return ai - bi;
    return (a.name||"").localeCompare(b.name||"");
  });
  return { players, hostClientId: room.hostClientId };
}

function broadcastRoster(room){
  const payload = { type:"players", room: room.code, ...roster(room), ts: now() };
  for(const [ws] of room.clientsByWs.entries()) safeSend(ws, payload);
}

// ===== message handlers =====
function handleJoin(ws, msg){
  const room = getRoom(msg.room);
  if(!room) return;

  const clientId = String(msg.clientId || "").trim() || makeId();
  const role = msg.role === "host" ? "host" : "client";
  const name = String(msg.name || (role==="host" ? "Host" : "Client")).slice(0,40);

  // register
  room.clientsByWs.set(ws, clientId);

  let rec = room.clients.get(clientId);
  if(!rec){
    rec = { clientId, role, name, connected:true, lastSeen:now(), lastWs:ws, color:null };
    room.clients.set(clientId, rec);
  }else{
    rec.role = role; // allow upgrade/downgrade
    rec.name = name || rec.name;
    rec.connected = true;
    rec.lastSeen = now();
    rec.lastWs = ws;
  }

  // decide host
  if(role === "host"){
    room.hostClientId = clientId;
  }else{
    // if no host yet, first joiner can become host if they reconnect as host later
    if(!room.hostClientId){
      // keep null, client won't be host automatically
    }
  }

  // restore color from claim
  cleanupClaims(room);
  if(!rec.color){
    // if this clientId still has a claim, restore it
    for(const [color, claim] of room.colorClaims.entries()){
      if(claim.clientId === clientId){
        rec.color = color;
        break;
      }
    }
  }

  safeSend(ws, { type:"joined", room: room.code, clientId, hostClientId: room.hostClientId, ts: now() });
  broadcastRoster(room);

  // if we have cached snapshot/state, offer them
  if(room.lastSnapshot) safeSend(ws, { type:"snapshot", room:room.code, snapshot: room.lastSnapshot, ts: now() });
  if(room.lastState) safeSend(ws, { type:"state", room:room.code, state: room.lastState, ts: now() });
}

function handleNeed(ws, msg, kind){
  const room = getRoom(msg.room);
  if(!room) return;
  if(kind === "snapshot" && room.lastSnapshot) safeSend(ws, { type:"snapshot", room:room.code, snapshot: room.lastSnapshot, ts: now() });
  if(kind === "state" && room.lastState) safeSend(ws, { type:"state", room:room.code, state: room.lastState, ts: now() });
  // always send roster too
  safeSend(ws, { type:"players", room: room.code, ...roster(room), ts: now() });
}

function handleChooseColor(ws, msg){
  const room = getRoom(msg.room);
  if(!room) return;
  const clientId = room.clientsByWs.get(ws) || String(msg.clientId||"").trim();
  if(!clientId) return;

  const color = String(msg.color||"").trim().toLowerCase();
  if(!COLORS.includes(color)) return;

  cleanupClaims(room);

  // already claimed by someone else and still valid?
  const existing = room.colorClaims.get(color);
  if(existing && existing.clientId !== clientId){
    // deny
    safeSend(ws, { type:"color_denied", room:room.code, color, reason:"taken", ts: now() });
    safeSend(ws, { type:"players", room: room.code, ...roster(room), ts: now() });
    return;
  }

  // release old color of this client
  const rec = room.clients.get(clientId);
  if(rec && rec.color && rec.color !== color){
    room.colorClaims.delete(rec.color);
  }

  // claim new
  room.colorClaims.set(color, { clientId, ts: now() });
  if(rec) rec.color = color;

  broadcastRoster(room);
}

function handleSnapshot(ws, msg){
  const room = getRoom(msg.room);
  if(!room) return;
  const fromId = room.clientsByWs.get(ws) || msg.clientId;
  if(fromId && room.hostClientId && fromId !== room.hostClientId){
    // only host updates snapshot
    return;
  }
  room.lastSnapshot = msg.snapshot || null;
  // broadcast to everyone except sender? keep simple broadcast all
  for(const [cws] of room.clientsByWs.entries()) safeSend(cws, { type:"snapshot", room:room.code, snapshot: room.lastSnapshot, ts: now() });
}

function handleState(ws, msg){
  const room = getRoom(msg.room);
  if(!room) return;
  const fromId = room.clientsByWs.get(ws) || msg.clientId;
  if(fromId && room.hostClientId && fromId !== room.hostClientId){
    return;
  }
  room.lastState = msg.state || null;
  for(const [cws] of room.clientsByWs.entries()) safeSend(cws, { type:"state", room:room.code, state: room.lastState, ts: now() });
}

function handleIntent(ws, msg){
  const room = getRoom(msg.room);
  if(!room) return;
  // forward intent to host only
  const hostId = room.hostClientId;
  if(!hostId) return;
  const hostRec = room.clients.get(hostId);
  if(!hostRec || !hostRec.lastWs) return;
  safeSend(hostRec.lastWs, { type:"intent", room:room.code, from: room.clientsByWs.get(ws) || msg.clientId || null, intent: msg.intent || null, ts: now() });
}

function handlePing(ws, msg){
  const room = getRoom(msg.room);
  if(!room) return;
  const id = room.clientsByWs.get(ws);
  if(!id) return;
  const rec = room.clients.get(id);
  if(rec){
    rec.lastSeen = now();
    rec.connected = true;
  }
}

wss.on("connection", (ws) => {
  ws.on("message", (data) => {
    let msg;
    try{ msg = JSON.parse(data.toString()); }catch(_e){ return; }
    const type = msg?.type;

    if(type === "join") return handleJoin(ws, msg);
    if(type === "need_snapshot") return handleNeed(ws, msg, "snapshot");
    if(type === "need_state") return handleNeed(ws, msg, "state");
    if(type === "chooseColor") return handleChooseColor(ws, msg);
    if(type === "snapshot") return handleSnapshot(ws, msg);
    if(type === "state") return handleState(ws, msg);
    if(type === "intent") return handleIntent(ws, msg);
    if(type === "ping") return handlePing(ws, msg);

    // ignore hello/unknown
  });

  ws.on("close", () => {
    // mark disconnected, keep claims reserved for a while
    for(const [code, room] of rooms.entries()){
      const cid = room.clientsByWs.get(ws);
      if(!cid) continue;
      room.clientsByWs.delete(ws);
      const rec = room.clients.get(cid);
      if(rec){
        rec.connected = false;
        rec.lastSeen = now();
        rec.lastWs = null;
        // keep claim timestamp fresh so reconnect has time
        if(rec.color){
          room.colorClaims.set(rec.color, { clientId: cid, ts: now() });
        }
      }
      broadcastRoster(room);
      break;
    }
  });
});

server.listen(PORT, () => console.log("barikade-server listening on", PORT));
