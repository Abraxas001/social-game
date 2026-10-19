// Shared constants, protocol types and deterministic terrain generation.
// Used by both the client (rendering) and the server (validation).

export const WORLD_X = 64;
export const WORLD_Y = 32;
export const WORLD_Z = 64;
export const CHUNK = 16;
export const MAX_PLAYERS = 8;
export const REACH = 7;

/** Index into the flat voxel array. Layout: x + z * X + y * X * Z. */
export function idx(x: number, y: number, z: number): number {
  return x + z * WORLD_X + y * WORLD_X * WORLD_Z;
}

export function inBounds(x: number, y: number, z: number): boolean {
  return x >= 0 && x < WORLD_X && y >= 0 && y < WORLD_Y && z >= 0 && z < WORLD_Z;
}

// ---------------------------------------------------------------- blocks

export interface BlockDef {
  id: number;
  name: string;
  color: string;
}

/** Block id 0 is air. */
export const BLOCKS: BlockDef[] = [
  { id: 1, name: "Grass", color: "#5da63a" },
  { id: 2, name: "Dirt", color: "#8a5a3a" },
  { id: 3, name: "Stone", color: "#8c8c8c" },
  { id: 4, name: "Sand", color: "#e0d08a" },
  { id: 5, name: "Snow", color: "#f2f6fa" },
  { id: 6, name: "Wood", color: "#7a5230" },
  { id: 7, name: "Leaves", color: "#2f7d32" },
  { id: 8, name: "Planks", color: "#c19a5b" },
  { id: 9, name: "Brick", color: "#a34a3a" },
];
export const MAX_BLOCK_ID = BLOCKS.length;

const GRASS = 1, DIRT = 2, STONE = 3, SAND = 4, SNOW = 5, WOOD = 6, LEAVES = 7;

// ------------------------------------------------------------------ maps

export type MapId = "meadow" | "desert" | "snow";

export interface MapDef {
  id: MapId;
  name: string;
  blurb: string;
  /** Sky colour for the client. */
  sky: string;
  top: number;
  under: number;
  base: number;
  amp: number;
  trees: number;
}

export const MAPS: Record<MapId, MapDef> = {
  meadow: {
    id: "meadow",
    name: "Meadow",
    blurb: "Rolling green hills and little forests.",
    sky: "#9fd3f5",
    top: GRASS,
    under: DIRT,
    base: 8,
    amp: 9,
    trees: 0.015,
  },
  desert: {
    id: "desert",
    name: "Dune Sea",
    blurb: "Wide golden dunes under a hot sun.",
    sky: "#f3dcae",
    top: SAND,
    under: SAND,
    base: 7,
    amp: 11,
    trees: 0,
  },
  snow: {
    id: "snow",
    name: "Frost Peaks",
    blurb: "Snowy ridges with scattered pines.",
    sky: "#cfdff0",
    top: SNOW,
    under: STONE,
    base: 9,
    amp: 13,
    trees: 0.006,
  },
};

export function isMapId(v: unknown): v is MapId {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(MAPS, v);
}

// -------------------------------------------------------------- terrain

function hash2(x: number, z: number, seed: number): number {
  let h = Math.imul(x, 374761393) + Math.imul(z, 668265263) + Math.imul(seed, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = h ^ (h >>> 16);
  return (h >>> 0) / 4294967296;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

function valueNoise(x: number, z: number, seed: number): number {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const fx = smooth(x - x0);
  const fz = smooth(z - z0);
  const a = hash2(x0, z0, seed);
  const b = hash2(x0 + 1, z0, seed);
  const c = hash2(x0, z0 + 1, seed);
  const d = hash2(x0 + 1, z0 + 1, seed);
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}

function fbm(x: number, z: number, seed: number): number {
  let sum = 0;
  let amp = 0.55;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < 3; i++) {
    sum += valueNoise(x * freq, z * freq, seed + i * 17) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

function seedOf(map: MapId): number {
  let s = 7;
  for (const ch of map) s = (Math.imul(s, 31) + ch.charCodeAt(0)) | 0;
  return s;
}

/** Deterministically generates the base terrain for a map. */
export function generateTerrain(map: MapId): Uint8Array {
  const def = MAPS[map];
  const seed = seedOf(map);
  const data = new Uint8Array(WORLD_X * WORLD_Y * WORLD_Z);
  const heights = new Int32Array(WORLD_X * WORLD_Z);

  for (let z = 0; z < WORLD_Z; z++) {
    for (let x = 0; x < WORLD_X; x++) {
      const n = fbm(x / 22, z / 22, seed);
      let h = Math.floor(def.base + (n - 0.5) * 2 * def.amp * 0.8 + def.amp * 0.4);
      h = Math.max(2, Math.min(WORLD_Y - 9, h));
      heights[x + z * WORLD_X] = h;
      for (let y = 0; y <= h; y++) {
        let id: number;
        if (y === h) id = def.top;
        else if (y >= h - 3) id = def.under;
        else id = STONE;
        data[idx(x, y, z)] = id;
      }
    }
  }

  // Trees: a tree grows where its random roll beats all 8 neighbours,
  // which keeps them spaced out.
  if (def.trees > 0) {
    for (let z = 3; z < WORLD_Z - 3; z++) {
      for (let x = 3; x < WORLD_X - 3; x++) {
        const roll = hash2(x, z, seed + 99);
        if (roll < 1 - def.trees * 6) continue;
        let isMax = true;
        for (let dz = -1; dz <= 1 && isMax; dz++) {
          for (let dx = -1; dx <= 1; dx++) {
            if ((dx !== 0 || dz !== 0) && hash2(x + dx, z + dz, seed + 99) >= roll) {
              isMax = false;
              break;
            }
          }
        }
        if (!isMax) continue;
        const base = heights[x + z * WORLD_X] + 1;
        const trunk = 4;
        for (let y = base; y < base + trunk; y++) data[idx(x, y, z)] = WOOD;
        for (let dy = trunk - 2; dy <= trunk + 1; dy++) {
          const r = dy >= trunk ? 1 : 2;
          for (let dz = -r; dz <= r; dz++) {
            for (let dx = -r; dx <= r; dx++) {
              if (r === 2 && Math.abs(dx) === 2 && Math.abs(dz) === 2) continue;
              const px = x + dx, py = base + dy, pz = z + dz;
              if (inBounds(px, py, pz) && data[idx(px, py, pz)] === 0) {
                data[idx(px, py, pz)] = LEAVES;
              }
            }
          }
        }
      }
    }
  }
  return data;
}

// -------------------------------------------------------------- protocol

export type Vec3 = [number, number, number];

export interface Look {
  skin: string;
  hair: string;
  shirt: string;
  pants: string;
}

export interface PlayerInfo {
  id: string;
  name: string;
  look: Look;
  p: Vec3;
  r: [number, number];
}

export type ClientMsg =
  | { t: "join"; room: string; map: MapId; name: string; look: Look }
  | { t: "move"; p: Vec3; r: [number, number] }
  | { t: "block"; x: number; y: number; z: number; id: number }
  | { t: "chat"; text: string };

export type ServerMsg =
  | { t: "init"; you: string; room: string; map: MapId; edits: [number, number, number, number][]; players: PlayerInfo[] }
  | { t: "join"; player: PlayerInfo }
  | { t: "leave"; id: string }
  | { t: "move"; id: string; p: Vec3; r: [number, number] }
  | { t: "block"; x: number; y: number; z: number; id: number }
  | { t: "chat"; id: string; name: string; text: string }
  | { t: "error"; msg: string };

export const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
export const ROOM_CODE = /^[a-z0-9]{4,12}$/;

export const DEFAULT_LOOK: Look = {
  skin: "#f1c27d",
  hair: "#4a2f1b",
  shirt: "#3a7bd5",
  pants: "#2d3a5a",
};
