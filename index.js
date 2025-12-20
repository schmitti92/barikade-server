import http from "http";
import { WebSocketServer } from "ws";
import { randomBytes } from "crypto";

const PORT = process.env.PORT || 10000;

const server = http.createServer((req,res)=>{
  if (req.url === "/" || req.url === "/health") {
    res.writeHead(200, {"content-type":"text/plain"});
    res.end("ok");
    return;
  }
  res.writeHead(404); res.end("not found");
});

const wss = new WebSocketServer({ server, path: "/ws" });

const rooms = new Map(); // roomCode -> roomObj

function now(){ return Date.now(); }
function genCode(len=4){
  const chars="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out="";
  for(let i=0;i<len;i++) out += chars[Math.floor(Math.random()*chars.length)];
  return out;
}
function safeSend(ws, obj){
  try{ ws.send(JSON.stringify(obj)); }catch(e){}
}
function broadcast(room, obj){
  const msg = JSON.stringify(obj);
  for (const p of room.players.values()){
    if (p.ws && p.ws.readyState === 1){
      try{ p.ws.send(msg); }catch(e){}
    }
  }
}
function getRoom(code){
  if(!rooms.has(code)){
    rooms.set(code, {
      code,
      createdAt: now(),
      players: new Map(), // clientId -> player
      maxPlayers: 4,
      turnClientId: null,
      phase: "lobby"
    });
  }
  return rooms.get(code);
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
      connected: !!(p.ws && p.ws.readyState===1),
      lastSeen: p.lastSeen
    });
  }
  return {
    code: room.code,
    maxPlayers: room.maxPlayers,
    phase: room.phase,
    turnClientId: room.turnClientId,
    players: arr
  };
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
  const order = [...room.players.values()].filter(p=>p.role==="player").map(p=>p.clientId);
  if(order.length===0){ room.turnClientId=null; return; }
  const idx = Math.max(0, order.indexOf(room.turnClientId));
  room.turnClientId = order[(idx+1)%order.length];
}

wss.on("connection", (ws) => {
  ws.isAlive = true;
  ws.on("pong", ()=> { ws.isAlive = true; });

  let boundRoom = null;
  let boundClientId = null;

  ws.on("message", (data) => {
    let msg;
    try{ msg = JSON.parse(data.toString()); }catch(e){ return; }
    if(!msg || typeof msg.type!=="string") return;

    if(msg.type === "hello"){
      const roomCodeRaw = (msg.room || "").toString().trim();
      const roomCode = roomCodeRaw ? roomCodeRaw.toUpperCase() : genCode(4);

      const clientId = (msg.clientId || "").toString().trim() || randomBytes(8).toString("hex");
      const name = (msg.name || "Spieler").toString().slice(0,20);
      const wantRole = (msg.wantRole || "player").toString();
      const maxPlayers = Math.max(2, Math.min(4, parseInt(msg.maxPlayers || 2,10)));

      const room = getRoom(roomCode);
      room.maxPlayers = maxPlayers;

      let p = room.players.get(clientId);
      if(!p){
        let role = wantRole;
        const playerCount = [...room.players.values()].filter(x=>x.role==="player").length;
        if(role==="player" && playerCount >= room.maxPlayers) role="spectator";
        const color = role==="player" ? assignColor(room) : "spectator";
        p = { clientId, name, role, color, isHost:false, ws:null, lastSeen: now() };
        room.players.set(clientId, p);
      } else {
        if(name) p.name = name;
      }

      if(p.ws && p.ws !== ws){
        try{ p.ws.close(4000, "replaced"); }catch(e){}
      }
      p.ws = ws;
      p.lastSeen = now();

      const hosts = [...room.players.values()].filter(x=>x.isHost);
      if(hosts.length===0) p.isHost = true;

      ensureTurn(room);

      boundRoom = room;
      boundClientId = clientId;

      safeSend(ws, { type:"hello_ok", room: roomSnapshot(room), clientId });
      sendRoomState(room);
      return;
    }

    if(!boundRoom || !boundClientId) return;

    const room = boundRoom;
    const self = room.players.get(boundClientId);
    if(!self) return;
    self.lastSeen = now();

    if(msg.type === "ping"){
      safeSend(ws, { type:"pong", t: now() });
      return;
    }

    if(msg.type === "skip" || msg.type === "end_turn"){
      if(room.turnClientId === self.clientId){
        nextTurn(room);
        sendRoomState(room);
      }
      return;
    }

    if(msg.type === "roll" || msg.type === "move" || msg.type === "place_barricade" || msg.type==="reset"){
      broadcast(room, { type:"event", from:self.clientId, event: msg });
      return;
    }
  });

  ws.on("close", () => {
    if(!boundRoom || !boundClientId) return;
    const p = boundRoom.players.get(boundClientId);
    if(p && p.ws === ws){
      p.ws = null;
      p.lastSeen = now();
      sendRoomState(boundRoom);
    }
  });
});

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

setInterval(()=>{
  const cutoff = now() - 1000*60*30;
  for(const [code, room] of rooms){
    for(const [cid, p] of room.players){
      if(!p.ws && p.lastSeen < cutoff) room.players.delete(cid);
    }
    if(room.players.size===0 && room.createdAt < cutoff) rooms.delete(code);
    else ensureTurn(room);
  }
}, 60000);

server.listen(PORT, ()=> {
  console.log("Barikade Online WS server listening on", PORT, "path /ws");
});
