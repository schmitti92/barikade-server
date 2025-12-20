import express from "express";
import http from "http";
import { WebSocketServer } from "ws";

const PORT = process.env.PORT || 10000;

const app = express();
app.get("/", (_req, res) => res.status(200).send("barikade-server ok"));
app.get("/health", (_req, res) => res.status(200).json({ ok: true, ts: Date.now() }));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

/**
 * Room model:
 * rooms.get(code) = {
 *   code,
 *   clients: Map<clientId, {ws, id, role, name, connected, lastSeen}>,
 *   hostId: string|null,
 *   state: any|null,
 *   updatedAt: number
 * }
 */
const rooms = new Map();

const COLOR_ORDER = ["red","blue","green","yellow"];


function normalizeRoomCode(s){
  return String(s||"").toUpperCase().replace(/[^A-Z0-9]/g,"").slice(0,10);
}
function now(){ return Date.now(); }

function safeParse(txt){
  try{ return JSON.parse(txt); }catch{ return null; }
}

function send(ws, obj){
  if(!ws || ws.readyState !== 1) return false;
  try{ ws.send(JSON.stringify(obj)); return true; }catch{ return false; }
}

function getOrCreateRoom(code){
  const c = normalizeRoomCode(code);
  if(!c) return null;
  if(!rooms.has(c)){
    rooms.set(c, { code:c, clients:new Map(), hostId:null, state:null, updatedAt:0 });
  }
  return rooms.get(c);
}

function roster(room){
  const list = [];
  for(const [id, c] of room.clients.entries()){
    list.push({
      id,
      name: c.name || id,
      role: c.role || "client",
      connected: !!c.connected,
      color: c.color || null
    });
  }
  // Put host first
  list.sort((a,b)=>{
    if(a.id===room.hostId) return -1;
    if(b.id===room.hostId) return 1;
    return a.id.localeCompare(b.id);
  });
  return list;
}

function broadcast(room, obj){
  for(const c of room.clients.values()){
    send(c.ws, obj);
  }
}

function broadcastRoster(room){
  broadcast(room, { type:"players", room: room.code, players: roster(room), ts: now() });
}

function pickColor(room, preferred=null){
  const used = new Set();
  for(const c of room.clients.values()){
    if(c.color) used.add(c.color);
  }
  if(preferred && !used.has(preferred) && COLOR_ORDER.includes(preferred)) return preferred;
  for(const col of COLOR_ORDER){
    if(!used.has(col)) return col;
  }
  return null;
}

function setClient(room, clientId, ws, role="client"){
  const id = String(clientId || "").trim() || ("anon-" + Math.random().toString(36).slice(2,10));
  let c = room.clients.get(id);

  if(c && c.ws && c.ws !== ws){
    // Replace old connection (reconnect)
    try{ c.ws.close(); }catch{}
  }

  const prevColor = c?.color || null;
  const color = prevColor || pickColor(room);

  c = {
    ws,
    id,
    role,
    color,
    name: role==="host" ? "Host" : "Spieler",
    connected:true,
    lastSeen: now()
  };
  room.clients.set(id, c);
  if(role==="host") room.hostId = id;
  return c;
}

function cleanupRoom(room){
  // Remove dead clients
  for(const [id,c] of room.clients.entries()){
    if(!c.connected) room.clients.delete(id);
  }
  // If no clients remain, delete room
  if(room.clients.size===0){
    rooms.delete(room.code);
  }
}

function handleMessage(ws, msg){
  const type = msg?.type || msg?.t || msg?.action || msg?.kind;

  // Identify + Join (client sends a mix of variants; we accept all)
  if(type==="hello" || type==="join" || msg?.action==="join" || msg?.t==="join"){
    const roomCode = normalizeRoomCode(msg.room);
    const room = getOrCreateRoom(roomCode);
    if(!room) return;

    const role = (msg.mode || msg.role || "client");
    const clientId = msg.clientId || msg.id || msg.client || msg.userId;
    const c = setClient(room, clientId, ws, role);

    // Remember on socket
    ws.__room = room.code;
    ws.__clientId = c.id;

    send(ws, { type:"joined", room: room.code, clientId: c.id, players: roster(room), ts: now() });
    broadcastRoster(room);

    // If we already have a state, send it to new clients
    if(room.state){
      send(ws, { type:"snapshot", room: room.code, state: room.state, ts: now() });
    }
    return;
  }

  const roomCode = normalizeRoomCode(msg.room || ws.__room || "");
  if(!roomCode || !rooms.has(roomCode)) return;
  const room = rooms.get(roomCode);

  // Update last seen
  const cid = String(msg.clientId || ws.__clientId || "");
  const c = room.clients.get(cid);
  if(c){ c.lastSeen = now(); c.connected = true; }

  if(type==="ping"){
    send(ws, { type:"pong", ts: now() });
    return;
  }

  // Client asks for snapshot
  if(type==="need_snapshot" || type==="need_state" || msg?.action==="need_state"){
    if(room.state){
      send(ws, { type:"snapshot", room: room.code, state: room.state, ts: now() });
    }else{
      // If no state yet, ask host (if exists) to broadcast one
      if(room.hostId && room.clients.get(room.hostId)){
        send(room.clients.get(room.hostId).ws, { type:"need_snapshot", room: room.code, ts: now() });
      }
    }
    return;
  }

  // Host broadcasts authoritative state
  if(type==="snapshot" || type==="state" || type==="sync" || msg?.action==="state"){
    // Accept only from host connection if known (best-effort)
    const senderId = cid;
    if(room.hostId && senderId && room.hostId !== senderId){
      // ignore non-host state updates
      return;
    }
    const st = msg.state || msg.payload || msg.data;
    if(!st) return;
    room.state = st;
    room.updatedAt = now();
    broadcast(room, { type:"state", room: room.code, state: st, players: roster(room), ts: now() });
    return;
  }

  // Intents: forward to host (host simulates and broadcasts state)
  if(type==="intent" || type==="move" || type==="cmd"){
    const intent = msg.intent || msg.payload || msg.data || msg;
    if(!intent) return;

    if(room.hostId && room.clients.get(room.hostId)){
      send(room.clients.get(room.hostId).ws, { type:"intent", room: room.code, clientId: cid, intent, ts: now() });
    }else{
      // No host? broadcast intent to everyone (fallback)
      broadcast(room, { type:"intent", room: room.code, clientId: cid, intent, ts: now() });
    }
    return;
  }

  // Unknown message types ignored
}

wss.on("connection", (ws) => {
  ws.on("message", (data) => {
    const txt = (typeof data === "string") ? data : data.toString("utf-8");
    const msg = safeParse(txt);
    if(!msg) return;
    handleMessage(ws, msg);
  });

  ws.on("close", () => {
    const roomCode = normalizeRoomCode(ws.__room || "");
    const clientId = String(ws.__clientId || "");
    if(roomCode && rooms.has(roomCode) && clientId){
      const room = rooms.get(roomCode);
      const c = room.clients.get(clientId);
      if(c){ c.connected = false; c.ws = null; }
      broadcastRoster(room);

      // hard cleanup after a short grace period (reconnect)
      setTimeout(() => {
        if(!rooms.has(roomCode)) return;
        const r = rooms.get(roomCode);
        const cc = r.clients.get(clientId);
        if(cc && cc.connected===false) r.clients.delete(clientId);
        // If host left, clear hostId
        if(r.hostId === clientId) r.hostId = null;
        cleanupRoom(r);
        if(rooms.has(roomCode)) broadcastRoster(r);
      }, 15000);
    }
  });
});

// Periodic cleanup: drop rooms idle > 6h
setInterval(() => {
  const t = now();
  for(const [code, room] of rooms.entries()){
    let newest = room.updatedAt || 0;
    for(const c of room.clients.values()){
      newest = Math.max(newest, c.lastSeen || 0);
    }
    if(t - newest > 6*60*60*1000){
      rooms.delete(code);
    }
  }
}, 60*1000);

server.listen(PORT, () => {
  console.log("barikade-server listening on", PORT);
});
