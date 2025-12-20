import http from "http";
import { WebSocketServer } from "ws";
import { randomBytes } from "crypto";
import fs from "fs";
import path from "path";

const PORT = process.env.PORT || 10000;
const SAVE_PATH = path.join(process.cwd(), "save.json");

// ---------- persistence ----------
function loadSave(){
  try{
    if(!fs.existsSync(SAVE_PATH)) return null;
    return JSON.parse(fs.readFileSync(SAVE_PATH, "utf8"));
  }catch(e){
    console.error("SAVE load failed:", e);
    return null;
  }
}

let saveTimer = null;
function scheduleSave(){
  if(saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try{
      const data = {};
      for(const [code, room] of rooms){
        data[code] = {
          code: room.code,
          createdAt: room.createdAt,
          maxPlayers: room.maxPlayers,
          turnClientId: room.turnClientId,
          phase: room.phase,
          // Only events + minimal room info are persisted. Players are NOT persisted.
          events: room.events || []
        };
      }
      fs.writeFileSync(SAVE_PATH, JSON.stringify(data), "utf8");
    }catch(e){
      console.error("SAVE write failed:", e);
    }
  }, 400);
}

// ---------- helpers ----------
function now(){ return Date.now(); }
function uid(n=8){ return randomBytes(n).toString("hex"); }

function safeSend(ws, obj){
  try{
    if(ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
  }catch(e){}
}

function roomSnapshot(room){
  const arr = [];
  for(const p of room.players.values()){
    arr.push({
      clientId: p.clientId,
      name: p.name,
      role: p.role,
      color: p.color,
      isHost: p.isHost,
      connected: !!(p.ws && p.ws.readyState === 1),
      lastSeen: p.lastSeen
    });
  }
  return {
    code: room.code,
    createdAt: room.createdAt,
    maxPlayers: room.maxPlayers,
    phase: room.phase,
    turnClientId: room.turnClientId,
    players: arr
  };
}

function broadcast(room, obj){
  const msg = JSON.stringify(obj);
  for(const p of room.players.values()){
    if(p.ws && p.ws.readyState === 1){
      try{ p.ws.send(msg); }catch(e){}
    }
  }
}

function sendRoomState(room){
  broadcast(room, { type:"room_state", room: roomSnapshot(room) });
}

function assignColor(room){
  const colors = ["red","blue","green","yellow"];
  const used = new Set([...room.players.values()].filter(p=>p.role==="player").map(p=>p.color));
  for(const c of colors) if(!used.has(c)) return c;
  return colors[0];
}

function ensureTurn(room){
  const players = [...room.players.values()].filter(p=>p.role==="player");
  if(players.length === 0){ room.turnClientId = null; return; }
  if(!room.turnClientId || !room.players.has(room.turnClientId) || room.players.get(room.turnClientId).role!=="player"){
    room.turnClientId = players[0].clientId;
  }
}

function nextTurn(room){
  const players = [...room.players.values()].filter(p=>p.role==="player");
  if(players.length === 0){ room.turnClientId = null; return; }
  const idx = Math.max(0, players.findIndex(p=>p.clientId === room.turnClientId));
  room.turnClientId = players[(idx + 1) % players.length].clientId;
}

function getRoom(code){
  if(!rooms.has(code)){
    rooms.set(code, {
      code,
      createdAt: now(),
      players: new Map(), // clientId -> player
      maxPlayers: 4,
      turnClientId: null,
      phase: "lobby",
      events: [] // persisted history of gameplay events
    });
  }
  return rooms.get(code);
}

// ---------- server ----------
const server = http.createServer((req,res)=>{
  if(req.url === "/" || req.url === "/health") {
    res.writeHead(200, {"content-type":"text/plain"});
    res.end("ok");
    return;
  }
  res.writeHead(404); res.end("not found");
});

const wss = new WebSocketServer({ server, path: "/ws" });

const rooms = new Map();

// Restore persisted rooms (events + minimal state)
const saved = loadSave();
if(saved && typeof saved === "object"){
  for(const [code, r] of Object.entries(saved)){
    rooms.set(code, {
      code,
      createdAt: r.createdAt || now(),
      players: new Map(),
      maxPlayers: r.maxPlayers || 4,
      turnClientId: r.turnClientId || null,
      phase: r.phase || "lobby",
      events: Array.isArray(r.events) ? r.events : []
    });
  }
  console.log("Loaded saves for rooms:", Object.keys(saved).length);
}

wss.on("connection", (ws) => {
  ws.isAlive = true;

  ws.on("pong", () => { ws.isAlive = true; });

  ws.on("message", (buf) => {
    let msg;
    try{ msg = JSON.parse(buf.toString()); }catch(e){ return; }

    // keepalive
    if(msg.type === "ping"){
      safeSend(ws, { type:"pong", t: now() });
      return;
    }

    // join/hello
    if(msg.type === "hello"){
      const code = (msg.room || "").trim() || "1";
      const room = getRoom(code);

      room.maxPlayers = msg.maxPlayers || room.maxPlayers;

      const clientId = msg.clientId || uid(8);
      const name = (msg.name || "Spieler").slice(0, 24);
      const wantRole = msg.wantRole === "spectator" ? "spectator" : "player";

      let self = room.players.get(clientId);
      if(!self){
        self = {
          clientId,
          name,
          role: wantRole,
          color: wantRole === "player" ? assignColor(room) : "spectator",
          isHost: false,
          ws: null,
          lastSeen: now()
        };
        room.players.set(clientId, self);
      }

      // host assignment (first connected player becomes host)
      const hasHost = [...room.players.values()].some(p=>p.isHost);
      if(!hasHost && self.role === "player") self.isHost = true;

      self.name = name;
      self.role = wantRole;
      if(self.role === "player" && (!self.color || self.color === "spectator")) self.color = assignColor(room);
      if(self.role === "spectator") self.color = "spectator";

      self.ws = ws;
      self.lastSeen = now();

      ws.roomCode = code;
      ws.clientId = clientId;

      ensureTurn(room);

      safeSend(ws, { type:"hello_ok", room: roomSnapshot(room), clientId });

      // NEW: send persisted event history so clients can rebuild state after reconnect/server restart
      if(room.events && room.events.length){
        safeSend(ws, { type:"sync", room: code, events: room.events });
      }

      sendRoomState(room);
      scheduleSave();
      return;
    }

    const code = ws.roomCode;
    if(!code) return;
    const room = rooms.get(code);
    if(!room) return;
    const self = ws.clientId ? room.players.get(ws.clientId) : null;
    if(!self) return;

    self.lastSeen = now();

    // skip / end_turn
    if(msg.type === "skip" || msg.type === "end_turn"){
      if(room.turnClientId === self.clientId){
        nextTurn(room);
        sendRoomState(room);
        scheduleSave();
      }
      return;
    }

    // gameplay events: relay + persist
    if(msg.type === "roll" || msg.type === "move" || msg.type === "place_barricade" || msg.type === "reset"){
      const entry = { t: now(), from: self.clientId, event: msg };
      room.events.push(entry);
      // cap history to prevent huge file
      if(room.events.length > 5000) room.events.splice(0, room.events.length - 5000);

      broadcast(room, { type:"event", from:self.clientId, event: msg });
      scheduleSave();
      return;
    }
  });

  ws.on("close", () => {
    const code = ws.roomCode;
    if(!code) return;
    const room = rooms.get(code);
    if(!room) return;
    const self = ws.clientId ? room.players.get(ws.clientId) : null;
    if(self && self.ws === ws) self.ws = null;

    // if host left, promote next player
    if(self && self.isHost){
      self.isHost = false;
      const next = [...room.players.values()].find(p=>p.role==="player" && p.ws && p.ws.readyState===1);
      if(next) next.isHost = true;
    }

    ensureTurn(room);
    sendRoomState(room);
    scheduleSave();
  });

  ws.on("error", () => {});
});

// ws heartbeat
setInterval(()=>{
  for(const ws of wss.clients){
    if(ws.isAlive === false){
      try{ ws.terminate(); }catch(e){}
      continue;
    }
    ws.isAlive = false;
    try{ ws.ping(); }catch(e){}
  }
}, 25000);

// cleanup dead rooms after 30min w/o players
setInterval(()=>{
  const cutoff = now() - 1000*60*30;
  for(const [code, room] of rooms){
    const anyRecent = [...room.players.values()].some(p=>p.lastSeen > cutoff);
    if(!anyRecent){
      rooms.delete(code);
      scheduleSave();
    }
  }
}, 60000);

server.listen(PORT, () => {
  console.log("WS server listening on", PORT);
});
