import express from "express";
import http from "http";
import { WebSocketServer } from "ws";
import fs from "fs";
import path from "path";

const VERSION = "server-auth-v3";

const PORT = process.env.PORT || 10000;

const app = express();
app.get("/", (_req, res) => res.status(200).send("barikade-server ok"));
app.get("/health", (_req, res) => res.status(200).json({ ok: true, version: VERSION, ts: Date.now() }));
app.get("/version", (_req, res) => res.status(200).json({ version: VERSION }));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// ===== Board (shared rules) =====
const BOARD = JSON.parse(fs.readFileSync(new URL("./board.json", import.meta.url), "utf8"));
const NODES = new Map(BOARD.nodes.map(n => [n.id, n]));
const ADJ = new Map();
for(const [a,b] of (BOARD.edges||[])){
  if(!ADJ.has(a)) ADJ.set(a, new Set());
  if(!ADJ.has(b)) ADJ.set(b, new Set());
  ADJ.get(a).add(b);
  ADJ.get(b).add(a);
}

const COLORS = ["red","blue"];
const PIECES_PER = 5;

function now(){ return Date.now(); }
function randInt(min,max){ return Math.floor(Math.random()*(max-min+1))+min; }

function makeClientId(){
  return Math.random().toString(36).slice(2,10) + Math.random().toString(36).slice(2,10);
}

function makeRoomCode(){
  const chars="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out="";
  for(let i=0;i<4;i++) out+=chars[Math.floor(Math.random()*chars.length)];
  return out;
}

function isAdjacent(a,b){
  return !!ADJ.get(a)?.has(b);
}

function computeInitialPieces(){
  const pieces=[];
  for(const color of COLORS){
    // houses for that color ordered
    const houses = BOARD.nodes
      .filter(n=>n.kind==="house" && String(n.flags?.houseColor||"").toLowerCase()===color)
      .sort((x,y)=> (x.flags?.houseSlot ?? 0) - (y.flags?.houseSlot ?? 0));
    for(let i=0;i<PIECES_PER;i++){
      pieces.push({
        id:`p_${color}_${i+1}`,
        label:i+1,
        color,
        posKind:"house",
        houseId: houses[i]?.id ?? houses[0]?.id,
        nodeId:null,
      });
    }
  }
  return pieces;
}

function computeInitialBarricades(){
  // place on all RUN nodes, target 11
  let runNodes = BOARD.nodes.filter(n=>n.kind==="board" && n.flags?.run);
  const TARGET = 11;
  if(runNodes.length < TARGET){
    const candidates = BOARD.nodes.filter(n =>
      n.kind==="board" &&
      !n.flags?.run &&
      !n.flags?.goal &&
      !n.flags?.startColor &&
      !n.flags?.noBarricade
    ).sort((a,b)=> (ADJ.get(b.id)?.size||0)-(ADJ.get(a.id)?.size||0));
    for(const c of candidates){
      if(runNodes.length>=TARGET) break;
      runNodes.push(c);
    }
  }
  return runNodes.slice(0,TARGET).map(n=>n.id);
}

function snapshot(room){
  return {
    started: room.started,
    paused: room.paused,
    turnColor: room.turnColor,
    phase: room.phase,
    pieces: room.pieces,
    barricades: room.barricades,
  };
}

function broadcast(room, obj){
  const msg = JSON.stringify(obj);
  for(const c of room.clients.values()){
    try{ if(c.ws.readyState===1) c.ws.send(msg); }catch(_e){}
  }
}

function send(ws, obj){
  try{ ws.send(JSON.stringify(obj)); }catch(_e){}
}

function playerList(room){
  return Array.from(room.clients.values()).map(c=>({
    id:c.id,
    name:c.name,
    color:c.color,
    isHost:c.isHost,
    connected:true,
  }));
}

function occupiedNodesByColor(room, color, excludePieceId=null){
  const set=new Set();
  for(const p of room.pieces){
    if(p.color!==color) continue;
    if(excludePieceId && p.id===excludePieceId) continue;
    if(p.posKind==="board" && p.nodeId) set.add(p.nodeId);
  }
  return set;
}

function validatePath_NoBacktrack_NoOwn({room, piece, roll, path}){
  if(!Array.isArray(path) || path.length<1) return {ok:false, code:"bad_path", message:"Pfad fehlt."};

  const startNode = room.meta.starts[piece.color]; // same start per color? (client uses turnColor start; we use piece.color)
  // BUT original board meta starts are per color; ensure
  const starts = room.meta.starts;
  const startId = starts[piece.color] || starts[room.turnColor] || starts.red;
  const fromHouse = (piece.posKind==="house");
  const mustLen = fromHouse ? roll : (roll+1);
  if(path.length !== mustLen) return {ok:false, code:"bad_len", message:`Pfadlänge falsch (${path.length} statt ${mustLen}).`};

  // first node:
  if(fromHouse){
    if(path[0] !== startId) return {ok:false, code:"bad_start", message:"Aus Haus muss Startfeld als erstes."};
  }else{
    if(path[0] !== piece.nodeId) return {ok:false, code:"bad_start", message:"Pfad muss am aktuellen Feld starten."};
  }

  // adjacency
  for(let i=1;i<path.length;i++){
    if(!isAdjacent(path[i-1], path[i])) return {ok:false, code:"not_adj", message:"Pfad hat nicht verbundene Felder."};
  }

  // no immediate backtracking and no loops
  const visited = new Set([path[0]]);
  for(let i=1;i<path.length;i++){
    if(i>=2 && path[i]===path[i-2]) return {ok:false, code:"backtrack", message:"A→B→A ist nicht erlaubt."};
    if(visited.has(path[i])) return {ok:false, code:"loop", message:"Schleife im Zug ist nicht erlaubt."};
    visited.add(path[i]);
  }

  // own pieces: may pass through, but may not end on own
  const blocked = occupiedNodesByColor(room, piece.color, piece.id);
  const dest = path[path.length-1];
  if(blocked.has(dest)) return {ok:false, code:"own_block", message:"Zielfeld ist durch eigene Figur belegt."};

  // barricade: cannot pass over; if hit barricade before end -> invalid
  const barr = new Set(room.barricades);
  for(let i=1;i<path.length-1;i++){
    if(barr.has(path[i])) return {ok:false, code:"barricade_block", message:"Barikade darf nicht übersprungen werden."};
  }

  return {ok:true, dest};
}

function advanceTurn(room){
  const idx = COLORS.indexOf(room.turnColor);
  room.turnColor = COLORS[(idx+1)%COLORS.length];
  room.phase = "need_roll";
  room.roll = null;
  room.mustPlaceBarricade = null;
}

function startGame(room){
  room.started = true;
  room.paused = false;
  room.pieces = computeInitialPieces();
  room.barricades = computeInitialBarricades();
  room.turnColor = COLORS[Math.floor(Math.random()*COLORS.length)];
  room.phase = "need_roll";
  room.roll = null;
  room.mustPlaceBarricade = null;
}

const rooms = new Map(); // code -> room

function getOrCreateRoom(code){
  if(!rooms.has(code)){
    rooms.set(code, {
      code,
      createdAt: now(),
      clients: new Map(), // id -> client
      started: false,
      paused: false,
      meta: { starts: BOARD.meta?.starts || {red:null,blue:null}, goal: BOARD.meta?.goal || null },
      pieces: [],
      barricades: [],
      turnColor: "red",
      phase: "need_roll",
      roll: null,
      mustPlaceBarricade: null, // {color, pieceId}
    });
  }
  return rooms.get(code);
}

function assignColor(room){
  const used = new Set(Array.from(room.clients.values()).map(c=>c.color).filter(Boolean));
  for(const c of COLORS){
    if(!used.has(c)) return c;
  }
  return null;
}

wss.on("connection", (ws)=>{
  const clientId = makeClientId();
  const client = { id: clientId, ws, room:null, name:"Spieler", color:null, isHost:false, sessionToken:null, lastSeen: now() };

  send(ws, {type:"hello", clientId});

  ws.on("message", (buf)=>{
    let msg;
    try{ msg = JSON.parse(String(buf)); }catch(_e){ return; }
    client.lastSeen = now();
    const t = msg.type;

    if(t==="ping"){ send(ws,{type:"pong"}); return; }

    if(t==="join"){
      const roomCode = String(msg.room||"").trim().toUpperCase();
      if(!roomCode){ send(ws,{type:"error", code:"no_room", message:"Raumcode fehlt."}); return; }

      const room = getOrCreateRoom(roomCode);

      // reconnect by sessionToken
      const st = String(msg.sessionToken||"");
      client.sessionToken = st || null;
      client.name = String(msg.name||"Spieler").slice(0,18);
      const asHost = !!msg.asHost;

      // if sessionToken already in room, replace that old socket
      if(st){
        for(const old of room.clients.values()){
          if(old.sessionToken && old.sessionToken===st){
            try{ old.ws.close(); }catch(_e){}
            room.clients.delete(old.id);
          }
        }
      }

      client.room = roomCode;
      if(!room.clients.size){
        client.isHost = true;
      }else{
        client.isHost = false;
      }
      if(asHost) client.isHost = true;

      // assign color if free
      client.color = assignColor(room);

      room.clients.set(client.id, client);

      broadcast(room, {type:"room_update", players: playerList(room), paused: room.paused});
      send(ws, {type:"snapshot", state: snapshot(room)});
      return;
    }

    if(!client.room){ send(ws,{type:"error", code:"not_in_room", message:"Erst Host/Beitreten."}); return; }
    const room = rooms.get(client.room);
    if(!room){ send(ws,{type:"error", code:"room_missing", message:"Raum nicht gefunden."}); return; }

    if(t==="leave"){
      room.clients.delete(client.id);
      if(room.clients.size===0){
        rooms.delete(room.code);
        return;
      }
      // if host left, pick new host
      if(client.isHost){
        const first = room.clients.values().next().value;
        if(first) first.isHost = true;
      }
      broadcast(room, {type:"room_update", players: playerList(room), paused: room.paused});
      return;
    }

    if(t==="start"){
      if(!client.isHost){ send(ws,{type:"error", code:"not_host", message:"Nur Host kann starten."}); return; }
      const colored = Array.from(room.clients.values()).filter(c=>c.color).length;
      if(colored < 2){ send(ws,{type:"error", code:"need2", message:"Mindestens 2 Spieler mit Farbe."}); return; }
      startGame(room);
      broadcast(room, {type:"started", state: snapshot(room)});
      broadcast(room, {type:"room_update", players: playerList(room), paused: room.paused});
      return;
    }

    if(!room.started){
      send(ws,{type:"error", code:"not_started", message:"Spiel noch nicht gestartet."});
      return;
    }

    // Hard rule: only current player can act
    if(t==="roll_request"){
      if(client.color !== room.turnColor){
        send(ws,{type:"error", code:"not_turn", message:"Du bist nicht dran."});
        return;
      }
      if(room.phase !== "need_roll"){
        send(ws,{type:"error", code:"bad_phase", message:"Gerade kann nicht gewürfelt werden."});
        return;
      }
      if(room.mustPlaceBarricade){
        send(ws,{type:"error", code:"must_place", message:"Erst Barikade platzieren."});
        return;
      }
      room.roll = randInt(1,6);
      room.phase = "need_piece";
      broadcast(room, {type:"roll", value: room.roll, state: snapshot(room)});
      return;
    }

    if(t==="move_commit"){
      if(client.color !== room.turnColor){ send(ws,{type:"error", code:"not_turn", message:"Du bist nicht dran."}); return; }
      if(room.phase !== "need_piece"){ send(ws,{type:"error", code:"bad_phase", message:"Erst würfeln."}); return; }
      const pieceId = String(msg.pieceId||"");
      const pathArr = msg.path;

      const piece = room.pieces.find(p=>p.id===pieceId);
      if(!piece){ send(ws,{type:"error", code:"no_piece", message:"Figur nicht gefunden."}); return; }
      if(piece.color !== room.turnColor){ send(ws,{type:"error", code:"wrong_piece", message:"Nicht deine Figur."}); return; }

      const roll = room.roll || 0;
      const v = validatePath_NoBacktrack_NoOwn({room, piece, roll, path: pathArr});
      if(!v.ok){ send(ws,{type:"error", code:v.code, message:v.message}); return; }

      const dest = v.dest;
      // move piece
      if(piece.posKind==="house"){
        piece.posKind="board";
        piece.nodeId = pathArr[0];
      }
      piece.posKind="board";
      piece.nodeId = dest;

      // barricade pickup if landed
      const barrSet = new Set(room.barricades);
      if(barrSet.has(dest)){
        barrSet.delete(dest);
        room.barricades = Array.from(barrSet);
        room.mustPlaceBarricade = { color: room.turnColor, pieceId: piece.id };
        room.phase = "place_barricade";
      }else{
        room.mustPlaceBarricade = null;
        // 6 rule: if roll==6 => extra roll (same player) after completing turn
        if(room.roll === 6){
          room.phase = "need_roll";
        }else{
          advanceTurn(room);
        }
      }
      room.roll = null;

      broadcast(room, {type:"move", action:{pieceId: piece.id, path: pathArr}, state: snapshot(room)});
      broadcast(room, {type:"room_update", players: playerList(room), paused: room.paused});
      return;
    }

    if(t==="place_barricade"){
      if(client.color !== room.turnColor){ send(ws,{type:"error", code:"not_turn", message:"Du bist nicht dran."}); return; }
      if(room.phase !== "place_barricade"){ send(ws,{type:"error", code:"bad_phase", message:"Keine Barikade zum Platzieren."}); return; }
      if(!room.mustPlaceBarricade || room.mustPlaceBarricade.color !== room.turnColor){
        send(ws,{type:"error", code:"must_place", message:"Du musst gerade keine Barikade platzieren."}); return;
      }
      const nodeId = String(msg.nodeId||"");
      const node = NODES.get(nodeId);
      if(!node || node.kind!=="board"){ send(ws,{type:"error", code:"bad_node", message:"Ungültiges Feld."}); return; }
      if(node.flags?.goal || node.flags?.noBarricade || node.flags?.startColor){
        send(ws,{type:"error", code:"bad_node", message:"Hier darf keine Barikade hin."}); return;
      }
      const occAny = new Set(room.pieces.filter(p=>p.posKind==="board").map(p=>p.nodeId));
      if(occAny.has(nodeId)){ send(ws,{type:"error", code:"occupied", message:"Feld ist belegt."}); return; }
      const barrSet = new Set(room.barricades);
      if(barrSet.has(nodeId)){ send(ws,{type:"error", code:"exists", message:"Hier liegt schon eine Barikade."}); return; }

      barrSet.add(nodeId);
      room.barricades = Array.from(barrSet);
      room.mustPlaceBarricade = null;

      // end turn after placement (unless 6 rule? original: after picking barricade, placement ends turn)
      advanceTurn(room);

      broadcast(room, {type:"snapshot", state: snapshot(room)});
      broadcast(room, {type:"room_update", players: playerList(room), paused: room.paused});
      return;
    }

    send(ws,{type:"error", code:"unknown", message:"Unbekannter Befehl."});
  });

  ws.on("close", ()=>{
    if(client.room){
      const room = rooms.get(client.room);
      if(room){
        room.clients.delete(client.id);
        if(room.clients.size===0){
          rooms.delete(room.code);
        }else{
          // if host disconnected, pick new host
          if(client.isHost){
            const first = room.clients.values().next().value;
            if(first) first.isHost = true;
          }
          broadcast(room, {type:"room_update", players: playerList(room), paused: room.paused});
        }
      }
    }
  });
});

server.listen(PORT, ()=> console.log("barikade-server listening on", PORT));
