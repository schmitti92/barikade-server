import express from "express";
import http from "http";
import { WebSocketServer } from "ws";

const PORT = process.env.PORT || 10000;

const app = express();
app.get("/", (_req, res) => res.status(200).send("barikade-server ok"));
app.get("/health", (_req, res) => res.status(200).json({ ok: true, ts: Date.now() }));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// --- Helpers ---
const COLORS = ["blue", "red", "green", "yellow"];
const now = () => Date.now();
const rid = () => Math.random().toString(36).slice(2, 8).toUpperCase();
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

function makeDefaultBoard() {
  // Minimal board: a simple loop + some branches; editable in lobby anyway.
  // Nodes have normalized positions (0..1) for client rendering.
  const nodes = [
    { id: 0, x: 0.10, y: 0.50 },
    { id: 1, x: 0.18, y: 0.35 },
    { id: 2, x: 0.30, y: 0.28 },
    { id: 3, x: 0.42, y: 0.35 },
    { id: 4, x: 0.50, y: 0.50 },
    { id: 5, x: 0.42, y: 0.65 },
    { id: 6, x: 0.30, y: 0.72 },
    { id: 7, x: 0.18, y: 0.65 },

    { id: 8, x: 0.65, y: 0.20 },
    { id: 9, x: 0.78, y: 0.28 },
    { id: 10, x: 0.88, y: 0.40 },
    { id: 11, x: 0.88, y: 0.60 },
    { id: 12, x: 0.78, y: 0.72 },
    { id: 13, x: 0.65, y: 0.80 },

    { id: 14, x: 0.65, y: 0.50 }, // center connector
  ];

  const edges = [
    [0,1],[1,2],[2,3],[3,4],[4,5],[5,6],[6,7],[7,0], // left loop
    [4,14],[14,8],[8,9],[9,10],[10,11],[11,12],[12,13],[13,14] // right loop
  ];

  const startNodes = { blue: 0, red: 2, green: 10, yellow: 12 };

  return {
    nodes,
    edges,
    barricades: [], // array of nodeIds
    startNodes,
    forbiddenBarricadeNodes: Object.values(startNodes), // forbid placing on starts by default
  };
}

function makeInitialRoom(code, hostSocketId) {
  const board = makeDefaultBoard();
  return {
    code,
    createdAt: now(),
    hostSocketId,
    started: false,
    phase: "LOBBY", // LOBBY | GAME
    turn: {
      activeColor: null,
      step: "ROLL", // ROLL | MOVE | BARRICADE_PLACE
      roll: null,
      lastRoll: null,
      lastAction: null,
    },
    players: {
      // color -> { playerId, socketId, connected }
    },
    spectators: {}, // socketId -> true
    pieces: {
      // color -> [pos or null]
      blue: [null,null,null,null],
      red: [null,null,null,null],
      green: [null,null,null,null],
      yellow: [null,null,null,null],
    },
    board,
    // Used in BARRICADE_PLACE
    pendingBarricadeFrom: null,
  };
}

function roomSnapshot(room) {
  const players = {};
  for (const c of COLORS) {
    const p = room.players[c];
    players[c] = p ? { color: c, connected: !!p.connected, taken: true } : { color: c, connected: false, taken: false };
  }
  return {
    code: room.code,
    phase: room.phase,
    started: room.started,
    hostSocketId: room.hostSocketId,
    players,
    pieces: room.pieces,
    board: room.board,
    turn: room.turn,
    pendingBarricadeFrom: room.pendingBarricadeFrom,
    serverTs: now(),
  };
}

function broadcast(room, msg) {
  const payload = JSON.stringify(msg);
  for (const client of wss.clients) {
    if (client.readyState !== 1) continue;
    if (client.__roomCode === room.code) client.send(payload);
  }
}

function send(ws, msg) {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function getRoom(rooms, code) {
  return rooms.get(code);
}

function ensureRoom(rooms, code, hostSocketId) {
  let r = rooms.get(code);
  if (!r) {
    r = makeInitialRoom(code, hostSocketId);
    rooms.set(code, r);
  }
  return r;
}

function isHost(ws, room) {
  return ws && room && ws.__socketId === room.hostSocketId;
}

function playerColorFor(ws, room) {
  for (const c of COLORS) {
    const p = room.players[c];
    if (p && p.socketId === ws.__socketId) return c;
  }
  return null;
}

function isMyTurn(ws, room) {
  const c = playerColorFor(ws, room);
  return c && room.turn.activeColor === c;
}

function countTakenPlayers(room) {
  let n = 0;
  for (const c of COLORS) if (room.players[c]) n++;
  return n;
}

function nextColor(room, current) {
  const taken = COLORS.filter(c => room.players[c]);
  if (taken.length === 0) return null;
  if (!current) return taken[0];
  const idx = taken.indexOf(current);
  return taken[(idx + 1) % taken.length];
}

// --- Move logic ---
function neighbors(board) {
  const map = new Map();
  for (const n of board.nodes) map.set(n.id, []);
  for (const [a,b] of board.edges) {
    if (!map.has(a) || !map.has(b)) continue;
    map.get(a).push(b);
    map.get(b).push(a);
  }
  return map;
}

function isOccupied(room, nodeId) {
  for (const c of COLORS) {
    for (const pos of room.pieces[c]) {
      if (pos === nodeId) return true;
    }
  }
  return false;
}

function shortestExactDestinations(room, color, fromNode, steps) {
  const board = room.board;
  const neigh = neighbors(board);
  const barricadeSet = new Set(board.barricades);

  // BFS by steps, but cannot pass through barricade nodes unless it's the final landing node.
  let frontier = new Set([fromNode]);
  for (let s = 1; s <= steps; s++) {
    const next = new Set();
    for (const u of frontier) {
      const adj = neigh.get(u) || [];
      for (const v of adj) {
        if (!neigh.has(v)) continue;
        // occupancy rule: can't step onto occupied at any time (including final)
        if (isOccupied(room, v)) continue;
        // barricade rule: cannot pass through barricade except as final landing node
        if (barricadeSet.has(v) && s !== steps) continue;
        next.add(v);
      }
    }
    frontier = next;
    if (frontier.size === 0) break;
  }
  return [...frontier];
}

function canMovePiece(room, color, pieceIndex, toNode) {
  const steps = room.turn.roll;
  if (room.turn.step !== "MOVE" || typeof steps !== "number") return { ok:false, reason:"not_in_move_phase" };

  const pos = room.pieces[color][pieceIndex];
  const from = (pos === null) ? room.board.startNodes[color] : pos;

  // If at home (null), entering start consumes full move regardless of roll (house rule: any number can leave).
  // So the only allowed "toNode" when home is the start node.
  if (pos === null) {
    if (toNode !== room.board.startNodes[color]) return { ok:false, reason:"home_can_only_enter_start" };
    if (isOccupied(room, toNode)) return { ok:false, reason:"start_occupied" };
    return { ok:true, from, enteredFromHome:true, stepsUsed:steps };
  }

  const dests = shortestExactDestinations(room, color, from, steps);
  if (!dests.includes(toNode)) return { ok:false, reason:"not_reachable_in_exact_steps" };
  return { ok:true, from, enteredFromHome:false, stepsUsed:steps };
}

function applyMove(room, color, pieceIndex, toNode) {
  const board = room.board;
  const barricadeSet = new Set(board.barricades);

  room.pieces[color][pieceIndex] = toNode;

  // If landed on barricade: pick it up and require placement
  if (barricadeSet.has(toNode)) {
    board.barricades = board.barricades.filter(x => x !== toNode);
    room.pendingBarricadeFrom = toNode;
    room.turn.step = "BARRICADE_PLACE";
    room.turn.lastAction = { type:"PICKUP_BARRICADE", color, pieceIndex, at: toNode };
    return;
  }

  // Otherwise end turn immediately
  room.turn.lastAction = { type:"MOVE", color, pieceIndex, to: toNode, roll: room.turn.roll };
  room.turn.lastRoll = room.turn.roll;
  room.turn.roll = null;
  room.turn.step = "ROLL";
  room.turn.activeColor = nextColor(room, room.turn.activeColor);
}

function canPlaceBarricade(room, nodeId) {
  if (room.turn.step !== "BARRICADE_PLACE") return { ok:false, reason:"not_in_barricade_place" };
  if (!Number.isInteger(nodeId)) return { ok:false, reason:"bad_node" };
  const board = room.board;
  const nodeExists = board.nodes.some(n => n.id === nodeId);
  if (!nodeExists) return { ok:false, reason:"node_missing" };
  if (isOccupied(room, nodeId)) return { ok:false, reason:"occupied" };
  if (board.forbiddenBarricadeNodes?.includes(nodeId)) return { ok:false, reason:"forbidden" };
  if (board.barricades.includes(nodeId)) return { ok:false, reason:"already_has_barricade" };
  return { ok:true };
}

function applyPlaceBarricade(room, color, nodeId) {
  room.board.barricades.push(nodeId);
  room.turn.lastAction = { type:"PLACE_BARRICADE", color, at: nodeId, from: room.pendingBarricadeFrom };
  room.pendingBarricadeFrom = null;
  room.turn.lastRoll = room.turn.roll ?? room.turn.lastRoll;
  room.turn.roll = null;
  room.turn.step = "ROLL";
  room.turn.activeColor = nextColor(room, room.turn.activeColor);
}

// --- Rooms ---
const rooms = new Map();

wss.on("connection", (ws) => {
  ws.__socketId = Math.random().toString(36).slice(2);
  ws.__roomCode = null;

  send(ws, { t:"HELLO", socketId: ws.__socketId, ts: now() });

  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (!msg || typeof msg.t !== "string") return;

    // JOIN or HOST
    if (msg.t === "HOST_ROOM") {
      const code = rid();
      const room = ensureRoom(rooms, code, ws.__socketId);
      room.hostSocketId = ws.__socketId;
      ws.__roomCode = code;
      room.spectators[ws.__socketId] = true;
      send(ws, { t:"ROOM_CODE", code });
      broadcast(room, { t:"STATE", state: roomSnapshot(room) });
      return;
    }

    if (msg.t === "JOIN_ROOM") {
      const code = (msg.code || "").toString().trim().toUpperCase();
      if (!code) return send(ws, { t:"ERR", message:"Missing room code" });

      const room = ensureRoom(rooms, code, room?.hostSocketId ?? ws.__socketId);
      ws.__roomCode = code;

      // If this is first connection in room, set host
      if (!room.hostSocketId) room.hostSocketId = ws.__socketId;

      // Attach as spectator until color claimed
      room.spectators[ws.__socketId] = true;

      broadcast(room, { t:"STATE", state: roomSnapshot(room) });
      return;
    }

    const code = ws.__roomCode;
    if (!code) return;

    const room = getRoom(rooms, code);
    if (!room) return;

    // CLAIM_COLOR (in lobby only, or allow reconnect anytime)
    if (msg.t === "CLAIM_COLOR") {
      const color = (msg.color || "").toString();
      const playerId = (msg.playerId || "").toString();
      if (!COLORS.includes(color) || !playerId) return;

      const existing = room.players[color];
      if (existing && existing.playerId !== playerId) {
        // color taken by different identity
        return send(ws, { t:"ERR", message:"Color already taken" });
      }

      // Disconnect old socket for same playerId (reconnect)
      for (const c of COLORS) {
        const p = room.players[c];
        if (p && p.playerId === playerId && c !== color) {
          // player is trying to switch color: only allowed in lobby
          if (room.phase !== "LOBBY") return send(ws, { t:"ERR", message:"Cannot change color after start" });
          delete room.players[c];
        }
      }

      room.players[color] = { playerId, socketId: ws.__socketId, connected: true };
      delete room.spectators[ws.__socketId];
      broadcast(room, { t:"STATE", state: roomSnapshot(room) });
      return;
    }

    // START (host-only, lobby-only)
    if (msg.t === "START_GAME") {
      if (!isHost(ws, room)) return;
      if (room.phase !== "LOBBY") return;
      const n = countTakenPlayers(room);
      if (n < 2) return send(ws, { t:"ERR", message:"Need at least 2 players" });

      room.phase = "GAME";
      room.started = true;
      room.turn.activeColor = nextColor(room, null);
      room.turn.step = "ROLL";
      room.turn.roll = null;
      room.turn.lastAction = { type:"START", by:"host" };

      broadcast(room, { t:"STATE", state: roomSnapshot(room) });
      return;
    }

    // RESET (host-only): back to lobby
    if (msg.t === "RESET_ROOM") {
      if (!isHost(ws, room)) return;
      const keepPlayers = !!msg.keepPlayers;
      const oldPlayers = room.players;

      const newRoom = makeInitialRoom(room.code, room.hostSocketId);
      if (keepPlayers) {
        newRoom.players = oldPlayers;
        // mark as connected only if socket matches
        for (const c of COLORS) {
          const p = newRoom.players[c];
          if (p) p.connected = (p.socketId && p.socketId.length > 0);
        }
      }
      rooms.set(room.code, newRoom);

      broadcast(newRoom, { t:"STATE", state: roomSnapshot(newRoom) });
      return;
    }

    // BOARD_EDIT (host-only, lobby-only)
    if (msg.t === "BOARD_SET") {
      if (!isHost(ws, room)) return;
      if (room.phase !== "LOBBY") return;
      const board = msg.board;
      if (!board || !Array.isArray(board.nodes) || !Array.isArray(board.edges)) return;
      // Basic sanitization
      room.board.nodes = board.nodes.map(n => ({ id: Number(n.id), x: clamp(Number(n.x), 0, 1), y: clamp(Number(n.y), 0, 1) }))
        .filter(n => Number.isFinite(n.id) && Number.isFinite(n.x) && Number.isFinite(n.y));
      room.board.edges = board.edges.map(e => [Number(e[0]), Number(e[1])])
        .filter(e => e.length===2 && Number.isInteger(e[0]) && Number.isInteger(e[1]) && e[0]!==e[1]);
      room.board.barricades = Array.isArray(board.barricades) ? board.barricades.map(Number).filter(Number.isInteger) : [];
      room.board.startNodes = board.startNodes || room.board.startNodes;
      room.board.forbiddenBarricadeNodes = board.forbiddenBarricadeNodes || room.board.forbiddenBarricadeNodes;

      broadcast(room, { t:"STATE", state: roomSnapshot(room) });
      return;
    }

    // ROLL (active player only)
    if (msg.t === "REQUEST_ROLL") {
      if (room.phase !== "GAME") return;
      if (room.turn.step !== "ROLL") return;
      if (!isMyTurn(ws, room)) return;

      const roll = 1 + Math.floor(Math.random() * 6);
      room.turn.roll = roll;
      room.turn.step = "MOVE";
      room.turn.lastAction = { type:"ROLL", color: room.turn.activeColor, roll };
      broadcast(room, { t:"STATE", state: roomSnapshot(room) });
      return;
    }

    // MOVE (active player only)
    if (msg.t === "MOVE") {
      if (room.phase !== "GAME") return;
      if (!isMyTurn(ws, room)) return;
      if (room.turn.step !== "MOVE") return;

      const color = room.turn.activeColor;
      const pieceIndex = Number(msg.pieceIndex);
      const toNode = Number(msg.toNode);
      if (!Number.isInteger(pieceIndex) || pieceIndex < 0 || pieceIndex > 3) return;

      const check = canMovePiece(room, color, pieceIndex, toNode);
      if (!check.ok) return send(ws, { t:"ERR", message:`Move blocked: ${check.reason}` });

      applyMove(room, color, pieceIndex, toNode);
      broadcast(room, { t:"STATE", state: roomSnapshot(room) });
      return;
    }

    // PLACE_BARRICADE (active player only)
    if (msg.t === "PLACE_BARRICADE") {
      if (room.phase !== "GAME") return;
      if (!isMyTurn(ws, room)) return;
      if (room.turn.step !== "BARRICADE_PLACE") return;

      const nodeId = Number(msg.nodeId);
      const color = room.turn.activeColor;
      const check = canPlaceBarricade(room, nodeId);
      if (!check.ok) return send(ws, { t:"ERR", message:`Cannot place barricade: ${check.reason}` });

      applyPlaceBarricade(room, color, nodeId);
      broadcast(room, { t:"STATE", state: roomSnapshot(room) });
      return;
    }

    // HEARTBEAT
    if (msg.t === "PING") {
      return send(ws, { t:"PONG", ts: now() });
    }
  });

  ws.on("close", () => {
    const code = ws.__roomCode;
    if (!code) return;
    const room = rooms.get(code);
    if (!room) return;

    // mark disconnected
    for (const c of COLORS) {
      const p = room.players[c];
      if (p && p.socketId === ws.__socketId) {
        p.connected = false;
        p.socketId = null;
      }
    }
    delete room.spectators[ws.__socketId];

    // If host disconnected, keep hostSocketId as-is; next host will be first connected client (optional later).
    broadcast(room, { t:"STATE", state: roomSnapshot(room) });
  });
});

server.listen(PORT, () => {
  console.log(`barikade server listening on :${PORT}`);
});
