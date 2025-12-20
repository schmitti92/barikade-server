import express from "express";
import http from "http";
import { WebSocketServer } from "ws";

const PORT = process.env.PORT || 10000;

const app = express();
app.get("/", (_req, res) => res.status(200).send("barikade-server ok"));
app.get("/health", (_req, res) => res.status(200).json({ ok: true, ts: Date.now() }));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const COLORS = ["red","blue","green","yellow"];

function normRoom(code){
  return String(code||"").toUpperCase().replace(/[^A-Z0-9]/g,"").slice(0,10);
}
function safeJson(s){
  try{ return JSON.parse(s); }catch(_e){ return null; }
}

const rooms = new Map();
/**
 * rooms.get(code) = {
 *   code,
 *   clients: Map<clientId, {id, ws, role, name, color, connected, lastSeen}>,
 *   state: any (latest host snapshot/state)
 * }
 */

function getRoom(code){
  const c = normRoom(code);
  if(!rooms.has(c)){
    rooms.set(c, { code:c, clients:new Map(), state:null });
  }
  return rooms.get(c);
}

function send(ws, obj){
  if(!ws || ws.readyState !== 1) return;
  try{ ws.send(JSON.stringify(obj)); }catch(_e){}
}
function broadcast(room, obj){
  const s = JSON.stringify(obj);
  for(const c of room.clients.values()){
    if(c.ws && c.ws.readyState===1){
      try{ c.ws.send(s); }catch(_e){}
    }
  }
}
function roster(room){
  return [...room.clients.values()].map(c => ({
    id: c.id,
    name: c.name || c.id,
    role: c.role || "client",
    color: c.color || null,
    connected: c.connected !== false
  }));
}
function broadcastRoster(room){
  broadcast(room, { type:"players", room: room.code, players: roster(room), ts: Date.now() });
}

function colorTakenBy(room, color){
  for(const c of room.clients.values()){
    if(c.color === color) return c.id;
  }
  return null;
}

function chooseColor(room, clientId, color){
  if(!COLORS.includes(color)) return { ok:false, reason:"Ungültige Farbe" };
  const takenBy = colorTakenBy(room, color);
  if(takenBy && takenBy !== clientId){
    return { ok:false, reason:"Farbe ist schon vergeben" };
  }
  const c = room.clients.get(clientId);
  if(!c) return { ok:false, reason:"Client unbekannt" };
  c.color = color;
  c.lastSeen = Date.now();
  return { ok:true };
}

wss.on("connection", (ws) => {
  let room = null;
  let clientId = null;

  ws.on("message", (raw) => {
    const msg = safeJson(String(raw||""));
    if(!msg) return;

    const type = msg.type || msg.t || msg.action || msg.kind;

    // HELLO/JOIN
    if(type === "hello" || type === "join"){
      const code = normRoom(msg.room);
      if(!code) return;

      room = getRoom(code);
      clientId = String(msg.clientId || msg.id || "").trim();
      if(!clientId) return;

      const role = String(msg.role || msg.mode || "client");
      const name = String(msg.name || (role==="host"?"Host":"Client"));

      let c = room.clients.get(clientId);
      if(!c){
        c = { id:clientId, ws, role, name, color:null, connected:true, lastSeen:Date.now() };
        room.clients.set(clientId, c);
      }else{
        // reconnect -> keep color
        c.ws = ws;
        c.connected = true;
        c.role = role || c.role;
        c.name = name || c.name;
        c.lastSeen = Date.now();
      }

      // Acknowledge join + roster + maybe state
      send(ws, { type:"joined", room: room.code, clientId, role:c.role, color:c.color, players: roster(room), ts:Date.now() });
      broadcastRoster(room);

      // If we have a state, send it to the joiner
      if(room.state){
        send(ws, { type:"snapshot", room: room.code, state: room.state, ts: Date.now() });
      }
      return;
    }

    // choose color
    if(type === "chooseColor"){
      const code = normRoom(msg.room);
      if(!room || room.code !== code) room = getRoom(code);
      const id = String(msg.clientId||msg.id||clientId||"").trim();
      if(!id) return;

      const color = String(msg.color||"").toLowerCase();
      const res = chooseColor(room, id, color);
      if(!res.ok){
        send(ws, { type:"colorDenied", reason: res.reason, ts: Date.now() });
        return;
      }
      send(ws, { type:"colorChosen", color, ts: Date.now() });
      broadcastRoster(room);
      return;
    }

    // Host publishes state
    if(type === "snapshot" || type === "state" || type === "sync"){
      const code = normRoom(msg.room);
      if(!room || room.code !== code) room = getRoom(code);
      const id = String(msg.clientId||msg.id||clientId||"").trim();
      if(!id) return;
      const c = room.clients.get(id);
      if(!c) return;

      // Only host can publish authoritative state
      if(String(c.role) !== "host") return;

      room.state = msg.state || msg.payload || msg.data || null;
      if(room.state){
        broadcast(room, { type:"state", room: room.code, state: room.state, ts: Date.now(), players: roster(room) });
      }
      return;
    }

    // Need snapshot/state
    if(type === "need_snapshot" || type === "need_state"){
      if(room && room.state){
        send(ws, { type:"snapshot", room: room.code, state: room.state, ts: Date.now() });
      }
      if(room) broadcastRoster(room);
      return;
    }

    // Intent (client -> host)
    if(type === "intent" || type === "cmd" || type === "move"){
      const code = normRoom(msg.room);
      if(!room || room.code !== code) room = getRoom(code);
      const id = String(msg.clientId||msg.id||clientId||"").trim();
      if(!id) return;

      // forward to host(s) in room
      const payload = { type:"intent", room: room.code, clientId: id, intent: msg.intent || msg.payload || msg.data || msg.intent, ts: Date.now() };
      for(const c of room.clients.values()){
        if(c.role === "host" && c.ws && c.ws.readyState===1){
          send(c.ws, payload);
        }
      }
      return;
    }

    // ping/pong
    if(type === "ping"){ send(ws, { type:"pong", ts: Date.now() }); return; }
  });

  ws.on("close", () => {
    if(!room || !clientId) return;
    const c = room.clients.get(clientId);
    if(c){
      c.connected = false;
      c.ws = null;
      c.lastSeen = Date.now();
      // color stays reserved for reconnect
      broadcastRoster(room);
    }
  });
});

server.listen(PORT, () => {
  console.log("barikade-server listening on", PORT);
});
