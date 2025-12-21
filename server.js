import express from "express";
import http from "http";
import { WebSocketServer } from "ws";

const PORT = process.env.PORT || 10000;

const app = express();
app.get("/", (_req,res)=>res.status(200).send("barikade-server ok"));
app.get("/health", (_req,res)=>res.status(200).json({ok:true, ts:Date.now()}));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const COLORS = ["red","blue","green","yellow"];
const CLAIM_TTL_MS = 10 * 60 * 1000;

function now(){ return Date.now(); }
function safeSend(ws, obj){
  try{ if(ws && ws.readyState===1) ws.send(JSON.stringify(obj)); }catch(_e){}
}
function makeId(){
  return Math.random().toString(36).slice(2,10) + "-" + Math.random().toString(36).slice(2,6);
}
function normRoom(code){
  return String(code||"").toUpperCase().replace(/[^A-Z0-9]/g,"").slice(0,10);
}

const rooms = new Map();
// rooms.get(code) = {
//   code,
//   hostClientId: string|null,
//   clientsByWs: Map<ws, clientId>,
//   clients: Map<clientId, {clientId,name,role,connected,lastSeen,lastWs,color}>,
//   colorClaims: Map<color, {clientId, ts}>,
//   lastSnapshot: object|null,
//   lastState: object|null
// }

function getRoom(code){
  const key = normRoom(code);
  if(!key) return null;
  if(!rooms.has(key)){
    rooms.set(key, {
      code:key,
      hostClientId:null,
      clientsByWs:new Map(),
      clients:new Map(),
      colorClaims:new Map(),
      lastSnapshot:null,
      lastState:null,
    });
  }
  return rooms.get(key);
}

function cleanupClaims(room){
  const t = now();
  for(const [color, rec] of room.colorClaims.entries()){
    if(t - rec.ts > CLAIM_TTL_MS){
      room.colorClaims.delete(color);
      const c = room.clients.get(rec.clientId);
      if(c && c.color===color) c.color = null;
    }
  }
}

function autoAssignColor(room, clientId){
  cleanupClaims(room);
  const rec = room.clients.get(clientId);
  if(rec && rec.color) return rec.color;

  // restore from claim if any
  for(const [color, claim] of room.colorClaims.entries()){
    if(claim.clientId === clientId){
      if(rec) rec.color=color;
      return color;
    }
  }

  // assign first free
  const taken = new Set();
  for(const claim of room.colorClaims.values()) taken.add(claim.clientId + ":" + claim.color);
  for(const c of COLORS){
    const existing = room.colorClaims.get(c);
    if(!existing){
      room.colorClaims.set(c, { clientId, ts: now() });
      if(rec) rec.color=c;
      return c;
    }
  }
  return null; // room full (4)
}

function roster(room){
  cleanupClaims(room);
  const players=[];
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
  // stable: host first, then color order, then name
  players.sort((a,b)=>{
    if(a.isHost && !b.isHost) return -1;
    if(!a.isHost && b.isHost) return 1;
    const ai = a.color ? COLORS.indexOf(a.color) : 99;
    const bi = b.color ? COLORS.indexOf(b.color) : 99;
    if(ai!==bi) return ai-bi;
    return (a.name||"").localeCompare(b.name||"");
  });
  return { players, hostClientId: room.hostClientId };
}

function broadcastRoster(room){
  const payload = { type:"players", room: room.code, ...roster(room), ts: now() };
  for(const ws of room.clientsByWs.keys()) safeSend(ws, payload);
}

function broadcast(room, obj){
  for(const ws of room.clientsByWs.keys()) safeSend(ws, obj);
}

function handleJoin(ws, msg){
  const room = getRoom(msg.room);
  if(!room) return;

  const clientId = String(msg.clientId||"").trim() || makeId();
  const role = msg.role === "host" ? "host" : "client";
  const name = String(msg.name || (role==="host"?"Host":"Client")).slice(0,40);

  room.clientsByWs.set(ws, clientId);

  let rec = room.clients.get(clientId);
  if(!rec){
    rec = { clientId, role, name, connected:true, lastSeen: now(), lastWs: ws, color:null };
    room.clients.set(clientId, rec);
  }else{
    rec.role = role;
    rec.name = name || rec.name;
    rec.connected = true;
    rec.lastSeen = now();
    rec.lastWs = ws;
  }

  if(role==="host") room.hostClientId = clientId;

  // auto color assign (first free) – makes it idiotensicher
  const color = autoAssignColor(room, clientId);
  rec.color = color;

  safeSend(ws, { type:"joined", room: room.code, clientId, hostClientId: room.hostClientId, ts: now() });
  broadcastRoster(room);

  // cached state
  if(room.lastSnapshot) safeSend(ws, { type:"snapshot", room: room.code, snapshot: room.lastSnapshot, ts: now() });
  if(room.lastState) safeSend(ws, { type:"state", room: room.code, state: room.lastState, ts: now() });
}

function handleNeed(ws, msg, kind){
  const room = getRoom(msg.room);
  if(!room) return;
  if(kind==="snapshot" && room.lastSnapshot) safeSend(ws, { type:"snapshot", room: room.code, snapshot: room.lastSnapshot, ts: now() });
  if(kind==="state" && room.lastState) safeSend(ws, { type:"state", room: room.code, state: room.lastState, ts: now() });
  safeSend(ws, { type:"players", room: room.code, ...roster(room), ts: now() });
}

function handleSnapshot(ws, msg){
  const room = getRoom(msg.room);
  if(!room) return;
  const fromId = room.clientsByWs.get(ws) || msg.clientId;
  if(room.hostClientId && fromId !== room.hostClientId) return; // only host
  room.lastSnapshot = msg.snapshot || null;
  broadcast(room, { type:"snapshot", room: room.code, snapshot: room.lastSnapshot, ts: now() });
}

function handleState(ws, msg){
  const room = getRoom(msg.room);
  if(!room) return;
  const fromId = room.clientsByWs.get(ws) || msg.clientId;
  if(room.hostClientId && fromId !== room.hostClientId) return; // only host
  room.lastState = msg.state || null;
  broadcast(room, { type:"state", room: room.code, state: room.lastState, ts: now() });
}

function handleIntent(ws, msg){
  const room = getRoom(msg.room);
  if(!room) return;
  // relay intent to host (authoritative)
  if(!room.hostClientId) return;

  // Find host ws
  let hostWs = null;
  for(const [cws, cid] of room.clientsByWs.entries()){
    if(cid === room.hostClientId){ hostWs = cws; break; }
  }
  if(!hostWs) return;
  safeSend(hostWs, { type:"intent", room: room.code, clientId: msg.clientId, intent: msg.intent, ts: now() });
}

function markDisconnected(ws){
  for(const room of rooms.values()){
    const clientId = room.clientsByWs.get(ws);
    if(!clientId) continue;
    room.clientsByWs.delete(ws);

    const rec = room.clients.get(clientId);
    if(rec){
      rec.connected = false;
      rec.lastSeen = now();
      // keep color claim for TTL
      if(rec.color){
        room.colorClaims.set(rec.color, { clientId, ts: now() });
      }
    }
    broadcastRoster(room);
  }
}

wss.on("connection", (ws) => {
  ws.on("message", (buf) => {
    const s = Buffer.isBuffer(buf) ? buf.toString("utf8") : String(buf||"");
    let msg=null;
    try{ msg = JSON.parse(s); }catch(_e){ return; }
    const type = msg.type;

    if(type==="join") return handleJoin(ws, msg);
    if(type==="need_state") return handleNeed(ws, msg, "state");
    if(type==="need_snapshot") return handleNeed(ws, msg, "snapshot");
    if(type==="snapshot") return handleSnapshot(ws, msg);
    if(type==="state") return handleState(ws, msg);
    if(type==="intent") return handleIntent(ws, msg);
  });

  ws.on("close", ()=>markDisconnected(ws));
  ws.on("error", ()=>markDisconnected(ws));
});

server.listen(PORT, ()=>console.log("barikade-server listening on", PORT));
