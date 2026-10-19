import * as THREE from "three";
import { BLOCKS, CHUNK, WORLD_X, WORLD_Y, WORLD_Z, generateTerrain, idx, inBounds, type MapId } from "@sg/shared";

const COLORS: [number, number, number][] = [[0, 0, 0]];
for (const b of BLOCKS) {
  const c = new THREE.Color(b.color);
  COLORS[b.id] = [c.r, c.g, c.b];
}

interface Face {
  dir: [number, number, number];
  corners: [number, number, number][];
  shade: number;
}

// Corners are counter-clockwise when viewed from outside the block.
const FACES: Face[] = [
  { dir: [1, 0, 0], shade: 0.85, corners: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]] },
  { dir: [-1, 0, 0], shade: 0.75, corners: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]] },
  { dir: [0, 1, 0], shade: 1.0, corners: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]] },
  { dir: [0, -1, 0], shade: 0.55, corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
  { dir: [0, 0, 1], shade: 0.9, corners: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
  { dir: [0, 0, -1], shade: 0.7, corners: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]] },
];

const CHUNKS_X = WORLD_X / CHUNK;
const CHUNKS_Z = WORLD_Z / CHUNK;

export class World {
  readonly data: Uint8Array;
  readonly group = new THREE.Group();
  private meshes = new Map<number, THREE.Mesh>();
  private dirty = new Set<number>();
  private material = new THREE.MeshBasicMaterial({ vertexColors: true });

  constructor(map: MapId) {
    this.data = generateTerrain(map);
    for (let cz = 0; cz < CHUNKS_Z; cz++) {
      for (let cx = 0; cx < CHUNKS_X; cx++) this.rebuild(cx, cz);
    }
  }

  get(x: number, y: number, z: number): number {
    return inBounds(x, y, z) ? this.data[idx(x, y, z)] : 0;
  }

  /** Collision query: world walls and floor are solid, open sky is not. */
  isSolid(x: number, y: number, z: number): boolean {
    if (x < 0 || x >= WORLD_X || z < 0 || z >= WORLD_Z || y < 0) return true;
    if (y >= WORLD_Y) return false;
    return this.data[idx(x, y, z)] !== 0;
  }

  set(x: number, y: number, z: number, id: number): void {
    if (!inBounds(x, y, z)) return;
    this.data[idx(x, y, z)] = id;
    const cx = Math.floor(x / CHUNK);
    const cz = Math.floor(z / CHUNK);
    this.markDirty(cx, cz);
    // Faces on a chunk border depend on the neighbouring chunk too.
    if (x % CHUNK === 0) this.markDirty(cx - 1, cz);
    if (x % CHUNK === CHUNK - 1) this.markDirty(cx + 1, cz);
    if (z % CHUNK === 0) this.markDirty(cx, cz - 1);
    if (z % CHUNK === CHUNK - 1) this.markDirty(cx, cz + 1);
  }

  /** Rebuild any chunk touched since the last call. */
  flush(): void {
    for (const key of this.dirty) this.rebuild(key % CHUNKS_X, Math.floor(key / CHUNKS_X));
    this.dirty.clear();
  }

  dispose(): void {
    for (const m of this.meshes.values()) m.geometry.dispose();
    this.material.dispose();
    this.group.clear();
    this.meshes.clear();
  }

  private markDirty(cx: number, cz: number): void {
    if (cx < 0 || cz < 0 || cx >= CHUNKS_X || cz >= CHUNKS_Z) return;
    this.dirty.add(cx + cz * CHUNKS_X);
  }

  private rebuild(cx: number, cz: number): void {
    const key = cx + cz * CHUNKS_X;
    const old = this.meshes.get(key);
    if (old) {
      this.group.remove(old);
      old.geometry.dispose();
      this.meshes.delete(key);
    }

    const positions: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    const x0 = cx * CHUNK;
    const z0 = cz * CHUNK;

    for (let y = 0; y < WORLD_Y; y++) {
      for (let z = z0; z < z0 + CHUNK; z++) {
        for (let x = x0; x < x0 + CHUNK; x++) {
          const id = this.data[idx(x, y, z)];
          if (id === 0) continue;
          const base = COLORS[id];
          // Small per-block tint so flat areas don't look like a single colour.
          const tint = 0.93 + 0.07 * ((((x * 73856093) ^ (y * 19349663) ^ (z * 83492791)) & 255) / 255);
          for (const face of FACES) {
            const ny = y + face.dir[1];
            if (ny < 0) continue;
            if (this.get(x + face.dir[0], ny, z + face.dir[2]) !== 0) continue;
            const v = positions.length / 3;
            for (const c of face.corners) {
              positions.push(x + c[0], y + c[1], z + c[2]);
              const s = face.shade * tint;
              colors.push(base[0] * s, base[1] * s, base[2] * s);
            }
            indices.push(v, v + 1, v + 2, v, v + 2, v + 3);
          }
        }
      }
    }

    if (indices.length === 0) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geo.setIndex(new THREE.BufferAttribute(new Uint32Array(indices), 1));
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, this.material);
    this.group.add(mesh);
    this.meshes.set(key, mesh);
  }
}

export interface RayHit {
  hit: [number, number, number];
  prev: [number, number, number];
}

/** Voxel traversal (Amanatides & Woo). Returns the first solid block and the empty cell before it. */
export function raycast(world: World, origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number): RayHit | null {
  let x = Math.floor(origin.x);
  let y = Math.floor(origin.y);
  let z = Math.floor(origin.z);
  const stepX = Math.sign(dir.x), stepY = Math.sign(dir.y), stepZ = Math.sign(dir.z);
  const dX = dir.x !== 0 ? Math.abs(1 / dir.x) : Infinity;
  const dY = dir.y !== 0 ? Math.abs(1 / dir.y) : Infinity;
  const dZ = dir.z !== 0 ? Math.abs(1 / dir.z) : Infinity;
  let tX = dir.x > 0 ? (x + 1 - origin.x) * dX : dir.x < 0 ? (origin.x - x) * dX : Infinity;
  let tY = dir.y > 0 ? (y + 1 - origin.y) * dY : dir.y < 0 ? (origin.y - y) * dY : Infinity;
  let tZ = dir.z > 0 ? (z + 1 - origin.z) * dZ : dir.z < 0 ? (origin.z - z) * dZ : Infinity;
  let prev: [number, number, number] = [x, y, z];
  let t = 0;

  while (t <= maxDist) {
    if (world.get(x, y, z) !== 0) return { hit: [x, y, z], prev };
    prev = [x, y, z];
    if (tX < tY && tX < tZ) {
      t = tX; tX += dX; x += stepX;
    } else if (tY < tZ) {
      t = tY; tY += dY; y += stepY;
    } else {
      t = tZ; tZ += dZ; z += stepZ;
    }
  }
  return null;
}
