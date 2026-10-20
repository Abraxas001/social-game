import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import {
  HEX_COLOR,
  MAX_BLOCK_ID,
  MAX_PLAYERS,
  REACH,
  ROOM_CODE,
  WORLD_X,
  WORLD_Y,
  WORLD_Z,
  idx,
  inBounds,
  isMapId,
  type ClientMsg,
  type Look,
  type MapId,
  type PlayerInfo,
  type ServerMsg,
  type Vec3,
} from "@sg/shared";

const PORT = Number(process.env.PORT ?? 3001);
const MAX_EDITS_PER_ROOM = 40_000;
const MAX_CHAT_LEN = 200;
const MAX_NAME_LEN = 16;

interface Client {
  ws: WebSocket;
  info: PlayerInfo;
  room: Room;
  alive: boolean;
  lastChat: number;
  blockTokens: number;
  tokenTime: number;
}

interface Room {
  id: string;
  map: MapId;
  clients: Map<string, Client>;
  /** idx -> block id (0 means a base block was removed). */
  edits: Map<number, number>;
}

const rooms = new Map<string, Room>();

function send(ws: WebSocket, msg: ServerMsg): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function broadcast(room: Room, msg: ServerMsg, except?: string): void {
  const data = JSON.stringify(msg);
  for (const [id, c] of room.clients) {
    if (id !== except && c.ws.readyState === WebSocket.OPEN) c.ws.send(data);
  }
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function cleanVec3(v: unknown): Vec3 | null {
  if (!Array.isArray(v) || v.length !== 3 || !v.every(isNum)) return null;
  const [x, y, z] = v as Vec3;
  if (x < -2 || x > WORLD_X + 2 || z < -2 || z > WORLD_Z + 2 || y < -5 || y > WORLD_Y + 40) return null;
  return [x, y, z];
}

function cleanLook(v: unknown): Look | null {
  if (typeof v !== "object" || v === null) return null;
  const l = v as Record<string, unknown>;
  for (const k of ["skin", "hair", "shirt", "pants"]) {
    if (typeof l[k] !== "string" || !HEX_COLOR.test(l[k] as string)) return null;
  }
  return { skin: l.skin as string, hair: l.hair as string, shirt: l.shirt as string, pants: l.pants as string };
}

function cleanName(v: unknown): string {
  if (typeof v !== "string") return "Player";
  // Strip control characters and trim.
  const name = v.replace(/[\u0000-\u001f\u007f<>]/g, "").trim().slice(0, MAX_NAME_LEN);
  return name || "Player";
}

function handleJoin(ws: WebSocket, msg: Extract<ClientMsg, { t: "join" }>): Client | null {
  const roomId = typeof msg.room === "string" ? msg.room.toLowerCase() : "";
  if (!ROOM_CODE.test(roomId)) {
    send(ws, { t: "error", msg: "Invalid room code." });
    return null;
  }
  const look = cleanLook(msg.look);
  if (!look) {
    send(ws, { t: "error", msg: "Invalid avatar." });
    return null;
  }
  let room = rooms.get(roomId);
  if (!room) {
    const map: MapId = isMapId(msg.map) ? msg.map : "meadow";
    room = { id: roomId, map, clients: new Map(), edits: new Map() };
    rooms.set(roomId, room);
  }
  if (room.clients.size >= MAX_PLAYERS) {
    send(ws, { t: "error", msg: `Room is full (${MAX_PLAYERS} players).` });
    return null;
  }

  const id = randomUUID().slice(0, 8);
  const info: PlayerInfo = {
    id,
    name: cleanName(msg.name),
    look,
    p: [WORLD_X / 2 + (Math.random() - 0.5) * 6, WORLD_Y, WORLD_Z / 2 + (Math.random() - 0.5) * 6],
    r: [0, 0],
  };
  const client: Client = { ws, info, room, alive: true, lastChat: 0, blockTokens: 30, tokenTime: Date.now() };

  const edits: [number, number, number, number][] = [];
  for (const [k, v] of room.edits) {
    const x = k % WORLD_X;
    const z = Math.floor(k / WORLD_X) % WORLD_Z;
    const y = Math.floor(k / (WORLD_X * WORLD_Z));
    edits.push([x, y, z, v]);
  }
  send(ws, {
    t: "init",
    you: id,
    room: room.id,
    map: room.map,
    edits,
    players: [...room.clients.values()].map((c) => c.info),
  });
  room.clients.set(id, client);
  broadcast(room, { t: "join", player: info }, id);
  return client;
}

function handleMessage(client: Client, msg: ClientMsg): void {
  const { room, info } = client;
  switch (msg.t) {
    case "move": {
      const p = cleanVec3(msg.p);
      if (!p || !Array.isArray(msg.r) || !msg.r.every(isNum) || msg.r.length !== 2) return;
      info.p = p;
      info.r = [msg.r[0], msg.r[1]];
      broadcast(room, { t: "move", id: info.id, p, r: info.r }, info.id);
      return;
    }
    case "block": {
      const { x, y, z, id } = msg;
      if (![x, y, z, id].every((n) => Number.isInteger(n))) return;
      if (!inBounds(x, y, z) || id < 0 || id > MAX_BLOCK_ID) return;
      // Reach check (lenient to allow for latency).
      const dx = x + 0.5 - info.p[0];
      const dy = y + 0.5 - (info.p[1] + 1.6);
      const dz = z + 0.5 - info.p[2];
      if (Math.hypot(dx, dy, dz) > REACH + 4) return;
      // Simple token bucket: 30 edits burst, refilling 20/s.
      const now = Date.now();
      client.blockTokens = Math.min(30, client.blockTokens + ((now - client.tokenTime) / 1000) * 20);
      client.tokenTime = now;
      if (client.blockTokens < 1) return;
      client.blockTokens -= 1;
      if (room.edits.size >= MAX_EDITS_PER_ROOM && !room.edits.has(idx(x, y, z))) return;
      room.edits.set(idx(x, y, z), id);
      broadcast(room, { t: "block", x, y, z, id });
      return;
    }
    case "chat": {
      if (typeof msg.text !== "string") return;
      const now = Date.now();
      if (now - client.lastChat < 300) return;
      client.lastChat = now;
      const text = msg.text.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, MAX_CHAT_LEN);
      if (!text) return;
      broadcast(room, { t: "chat", id: info.id, name: info.name, text });
      return;
    }
    default:
      return;
  }
}

function removeClient(client: Client): void {
  const { room, info } = client;
  if (!room.clients.delete(info.id)) return;
  broadcast(room, { t: "leave", id: info.id });
  if (room.clients.size === 0) rooms.delete(room.id);
}

// Plain HTTP endpoint so hosts can health-check the service and clients can
// wake a sleeping free-tier instance before opening the WebSocket.
const httpServer = createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const path = (req.url ?? "").split("?")[0].replace(/\/{2,}/g, "/");
  if (path === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size }));
    return;
  }
  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not found");
});

const wss = new WebSocketServer({ server: httpServer, maxPayload: 4096 });

wss.on("connection", (ws) => {
  let client: Client | null = null;
  ws.on("pong", () => {
    if (client) client.alive = true;
  });
  ws.on("message", (raw) => {
    let msg: ClientMsg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (typeof msg !== "object" || msg === null || typeof msg.t !== "string") return;
    if (!client) {
      if (msg.t === "join") client = handleJoin(ws, msg);
      return;
    }
    handleMessage(client, msg);
  });
  ws.on("close", () => {
    if (client) removeClient(client);
  });
  ws.on("error", () => ws.terminate());
});

// Drop connections that stop answering pings.
setInterval(() => {
  for (const room of rooms.values()) {
    for (const c of [...room.clients.values()]) {
      if (!c.alive) {
        c.ws.terminate();
        removeClient(c);
        continue;
      }
      c.alive = false;
      c.ws.ping();
    }
  }
}, 15_000);

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`[server] listening on port ${PORT} (ws + /health)`);
});
