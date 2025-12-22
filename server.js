import express from "express";
import http from "http";
import { WebSocketServer } from "ws";
import fs from "fs";

const PORT = process.env.PORT || 10000;

const app = express();
app.get("/", (_req, res) => res.status(200).send("barikade-server ok"));
app.get("/health", (_req, res) => res.status(200).json({ ok: true, ts: Date.now() }));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

/**
 * Very stable, simple room server:
 * - Host creates room
 * - First two players get colors: red, blue (we keep Phase 3 = 2 players)
 * - Server is authoritative for: start, turn order, dice values
 * - Moves are broadcast (server trusts clients for paths; works for friends)
 *
 * Messages:
 *   client -> server:
 *     {type:"join", room, name, asHost}
 *     {type:"leave"}
 *     {type:"start"}
 *     {type:"roll_request"}
 *     {type:"move_commit", pieceId, color, path, landed}
 *     {type:"picked_barricade", ...}
 *     {type:"place_barricade", nodeId}
 *
 *   server -> client:
 *     {type:"hello", clientId}
 *     {type:"room_update", room, players:[{id,name,color,isHost}]}
 *     {type:"started", state}
 *     {type:"snapshot", state}
 *     {type:"roll", value, turnColor}
 *     {type:"move", state, action:{pieceId,path}}
 *     {type:"turn", state}
 *     {type:"error", message}
 */

function uid(){
  return Math.random().toString(36).slice(2,10) + Math.random().toString(36).slice(2,6);
}

const COLORS = ["red","blue"]; // Phase 3: keep it simple

const rooms = new Map(); // roomCode -> room

function getRoom(code){
  const c = String(code||"").trim().toUpperCase();
  return rooms.get(c);
}

function makeRoom(code){
  const c = String(code||"").trim().toUpperCase();
  const r = {
    code: c,
    hostId: null,
    clients: new Map(), // id -> ws
    players: [],        // {id,name,color,isHost}
    started: false,
    paused: false,
    pausedReason: null,

    // game state
    turnColor: "red",
    pieces: [],
    barricades: [],
    lastRoll: null,
    awaitingBarricade: false,

  };
  rooms.set(c, r);
  return r;
}

function broadcast(room, obj){
  const data = JSON.stringify(obj);
  for(const ws of room.clients.values()){
    try{ ws.send(data); }catch(_e){}
  }
}

function findPlayerByToken(room, token){
  return room.players.find(p => p.token === token);
}

function roomUpdate(room){
  broadcast(room, {
    type:"room_update",
    room: room.code,
    paused: room.paused,
    pausedReason: room.pausedReason,
    players: room.players.map(p => ({id:p.id, name:p.name, color:p.color, online:p.online, isHost: p.id === room.hostId}))
  });
}

function initGameState(room){
  // read board.json to place initial barricades on run fields and initial houses
  let board = null;
  try{
    const raw = fs.readFileSync(new URL("./board.json", import.meta.url), "utf-8");
    board = JSON.parse(raw);
  }catch(e){
    console.error("board.json missing on server", e);
  }

  // pieces: 5 per color, start in their houses (use house ids)
  const nodes = board?.nodes || [];
  const houseIdsByColor = (color) => nodes
    .filter(n => n.kind==="house" && String(n.flags?.houseColor||"").toLowerCase()===color)
    .sort((a,b) => (a.flags?.houseSlot||0)-(b.flags?.houseSlot||0))
    .map(n=>n.id);

  room.pieces = [];
  for(const color of COLORS){
    const houses = houseIdsByColor(color);
    for(let i=0;i<5;i++){
      room.pieces.push({
        id:`p_${color}_${i+1}`,
        label:i+1,
        color,
        posKind:"house",
        houseId: houses[i] || houses[0] || null,
        nodeId: null
      });
    }
  }

  // barricades: all run nodes
  const runNodes = nodes.filter(n => n.kind==="board" && n.flags?.run).map(n=>n.id);
  room.barricades = runNodes.slice(); // keep array
  // starting player random
  room.turnColor = COLORS[Math.floor(Math.random()*COLORS.length)] || "red";
  room.lastRoll = null;
  room.awaitingBarricade = false;
}

function stateSnapshot(room){
  return {
    started: room.started,
    paused: room.paused,
    pausedReason: room.pausedReason,
    turnColor: room.turnColor,
    pieces: room.pieces,
    barricades: room.barricades,
  };
}

function nextTurn(room){
  const idx = COLORS.indexOf(room.turnColor);
  room.turnColor = COLORS[(idx+1)%COLORS.length] || "red";
}

function isHost(room, clientId){
  return room.hostId === clientId;
}

wss.on("connection", (ws) => {
  const clientId = uid();
  ws._id = clientId;
  ws._room = null;

  ws.send(JSON.stringify({type:"hello", clientId}));

  ws.on("message", (buf) => {
    let msg = null;
    try{ msg = JSON.parse(buf.toString("utf-8")); }catch(_e){ return; }
    const type = msg?.type;

    if(type === "ping"){
      ws._lastSeen = Date.now();
      try{ ws.send(JSON.stringify({type:"pong"})); }catch(_e){}
      return;
    }

    if(type === "join"){
      const roomCode = String(msg.room||"").trim().toUpperCase();
      if(!roomCode) return ws.send(JSON.stringify({type:"error", message:"Room fehlt"}));
      let room = getRoom(roomCode);
      if(!room) room = makeRoom(roomCode);

      // attach
      room.clients.set(clientId, ws);
      ws._room = room.code;

      // If first join OR asHost=true with empty host, become host
      if(!room.hostId || msg.asHost){
        room.hostId = clientId;
      }

      // Create/replace player entry (stable via sessionToken)
      const name = String(msg.name||"Spieler").slice(0,16);
      const token = String(msg.sessionToken||"").slice(0,40) || ("anon_" + clientId);

      let player = findPlayerByToken(room, token);

      // If same token connects again: replace connection (reconnect)
      if(player){
        // detach old connection if any
        if(player.id && player.id !== clientId){
          const oldWs = room.clients.get(player.id);
          try{ oldWs?.close(); }catch(_e){}
          room.clients.delete(player.id);
        }
        player.id = clientId;
        player.name = name;
        player.online = true;
        player.token = token;
      }else{
        player = {id: clientId, token, name, color: null, online: true, isHost:false};
        room.players.push(player);
      }

      // If first join OR asHost=true with empty host, become host
      if(!room.hostId || msg.asHost){
        room.hostId = clientId;
      }

      // Assign color if available and not already assigned
      const used = new Set(room.players.map(p => p.color).filter(Boolean));
      const free = COLORS.find(c => !used.has(c));
      if(!player.color && free) player.color = free;

      // If game is paused because active player was offline and they are back -> resume
      if(room.started && room.paused){
        const active = room.players.find(p => p.color === room.turnColor);
        if(active && active.online){
          room.paused = false;
          room.pausedReason = null;
        }
      }

      roomUpdate(room);
      // If already started -> send snapshot so late joiners sync
      if(room.started){
        ws.send(JSON.stringify({type:"snapshot", state: stateSnapshot(room)}));
      }
      return;
    }

    if(type === "leave"){
      const room = ws._room ? getRoom(ws._room) : null;
      if(!room) return;
      room.clients.delete(clientId);
      room.players = room.players.filter(p => p.id !== clientId);

      // If host left -> pick next player as host
      if(room.hostId === clientId){
        room.hostId = room.players[0]?.id || null;
      }
      roomUpdate(room);

      // cleanup empty room
      if(room.clients.size === 0){
        rooms.delete(room.code);
      }
      return;
    }

    const room = ws._room ? getRoom(ws._room) : null;
    if(!room) return ws.send(JSON.stringify({type:"error", message:"Nicht in einem Raum"}));

    if(type === "start"){
      if(!isHost(room, clientId)) return ws.send(JSON.stringify({type:"error", message:"Nur Host kann starten"}));
      const activePlayers = room.players.filter(p => p.color);
      if(activePlayers.length < 2) return ws.send(JSON.stringify({type:"error", message:"Mindestens 2 Spieler nötig"}));
      room.started = true;
      room.paused = false;
      room.lastRoll = null;
      room.awaitingBarricade = false;
      room.pausedReason = null;
      initGameState(room);
      broadcast(room, {type:"started", state: stateSnapshot(room)});
      return;
    }

    if(type === "roll_request"){
      if(!room.started) return;
      if(room.paused) return;
      if(room.paused) return;
      if(room.paused) return;
      if(room.paused) return;
      const me = room.players.find(p => p.id === clientId);
      if(!me?.color) return;
      if(me.color !== room.turnColor) return;

      const value = 1 + Math.floor(Math.random()*6);
      broadcast(room, {type:"roll", value, turnColor: room.turnColor});
      return;
    }

    if(type === "picked_barricade"){
      // server updates barricade list immediately (remove)
      const nodeId = String(msg.nodeId||"");
      if(!nodeId) return;
      room.barricades = room.barricades.filter(id => id !== nodeId);
      room.awaitingBarricade = true;
      broadcast(room, {type:"snapshot", state: stateSnapshot(room)});
      return;
    }

    if(type === "place_barricade"){
      const nodeId = String(msg.nodeId||"");
      if(!nodeId) return;
      if(!room.barricades.includes(nodeId)) room.barricades.push(nodeId);

      room.awaitingBarricade = false;

      // End of turn AFTER barricade placement.
      // Bonus rule: if last roll was 6, same player rolls again.
      if(room.lastRoll !== 6){
        nextTurn(room);
      }

      broadcast(room, {type:"turn", state: stateSnapshot(room)});
      return;
    }

    if(type === "move_commit"){
      if(!room.started) return;
      if(room.paused) return;
      const me = room.players.find(p => p.id === clientId);
      if(!me?.color) return;
      if(me.color !== room.turnColor) return;

      const pieceId = String(msg.pieceId||"");
      const path = Array.isArray(msg.path) ? msg.path : null;
      if(!pieceId || !path || path.length < 2) return;

      // apply final position from path end
      const dest = path[path.length-1];
      const pc = room.pieces.find(p => p.id === pieceId);
      if(pc){
        pc.posKind = "board";
        pc.nodeId = dest;
      }

      // broadcast move with snapshot + path to animate
      broadcast(room, {type:"move", state: stateSnapshot(room), action:{pieceId, path}});

      // If landed on a barricade: wait for client to pick + place -> THEN end turn
      const landedOnBarr = room.barricades.includes(dest);
      if(landedOnBarr){
        room.awaitingBarricade = true;
        return;
      }

      room.awaitingBarricade = false;

      // Normal end of turn (bonus rule)
      if(room.lastRoll !== 6){
        nextTurn(room);
      }

      broadcast(room, {type:"turn", state: stateSnapshot(room)});
      return;
    }

  });

  ws.on("close", () => {
    const room = ws._room ? getRoom(ws._room) : null;
    if(!room) return;

    room.clients.delete(clientId);

    const p = room.players.find(p => p.id === clientId);
    if(p){
      p.online = false;
    }

    // If active player went offline -> pause game
    if(room.started){
      const active = room.players.find(pl => pl.color === room.turnColor);
      if(active && !active.online){
        room.paused = true;
        room.pausedReason = `${room.turnColor} offline`;
      }
    }

    // If host left connection: keep host if same token reconnects; otherwise choose first online
    if(room.hostId === clientId){
      const online = room.players.find(pl => pl.online);
      room.hostId = online?.id || room.players[0]?.id || null;
    }

    roomUpdate(room);

    if(room.clients.size === 0){
      // keep room for 2 minutes to allow reconnect
      setTimeout(() => {
        const r2 = rooms.get(room.code);
        if(r2 && r2.clients.size === 0){
          rooms.delete(room.code);
        }
      }, 120000);
    }
  });
});

server.listen(PORT, () => {
  console.log("barikade server listening on", PORT);
});
