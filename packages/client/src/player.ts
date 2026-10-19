import * as THREE from "three";
import type { World } from "./world";

export const PLAYER_HEIGHT = 1.8;
export const PLAYER_RADIUS = 0.3;
export const EYE_HEIGHT = 1.62;

const WALK = 4.3;
const SPRINT = 6.5;
const FLY = 9;
const GRAVITY = 28;
const JUMP = 9;

export class LocalPlayer {
  /** Feet position. */
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  onGround = false;
  flying = false;
  readonly keys = new Set<string>();

  get eye(): THREE.Vector3 {
    return new THREE.Vector3(this.pos.x, this.pos.y + EYE_HEIGHT, this.pos.z);
  }

  forward(): THREE.Vector3 {
    const cp = Math.cos(this.pitch);
    return new THREE.Vector3(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
  }

  collides(world: World, px: number, py: number, pz: number): boolean {
    const x0 = Math.floor(px - PLAYER_RADIUS), x1 = Math.floor(px + PLAYER_RADIUS);
    const y0 = Math.floor(py), y1 = Math.floor(py + PLAYER_HEIGHT);
    const z0 = Math.floor(pz - PLAYER_RADIUS), z1 = Math.floor(pz + PLAYER_RADIUS);
    for (let y = y0; y <= y1; y++) {
      for (let z = z0; z <= z1; z++) {
        for (let x = x0; x <= x1; x++) {
          if (world.isSolid(x, y, z)) return true;
        }
      }
    }
    return false;
  }

  intersectsBlock(bx: number, by: number, bz: number): boolean {
    return (
      this.pos.x + PLAYER_RADIUS > bx && this.pos.x - PLAYER_RADIUS < bx + 1 &&
      this.pos.y + PLAYER_HEIGHT > by && this.pos.y < by + 1 &&
      this.pos.z + PLAYER_RADIUS > bz && this.pos.z - PLAYER_RADIUS < bz + 1
    );
  }

  update(dt: number, world: World, controlsActive: boolean): void {
    dt = Math.min(dt, 0.05);
    let mx = 0, mz = 0;
    if (controlsActive) {
      if (this.keys.has("KeyW")) mz -= 1;
      if (this.keys.has("KeyS")) mz += 1;
      if (this.keys.has("KeyA")) mx -= 1;
      if (this.keys.has("KeyD")) mx += 1;
    }
    const len = Math.hypot(mx, mz) || 1;
    mx /= len; mz /= len;
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const speed = this.flying ? FLY : this.keys.has("ShiftLeft") && controlsActive ? SPRINT : WALK;
    this.vel.x = (mx * cos + mz * sin) * speed;
    this.vel.z = (-mx * sin + mz * cos) * speed;

    if (this.flying) {
      this.vel.y = 0;
      if (controlsActive && this.keys.has("Space")) this.vel.y = FLY;
      if (controlsActive && this.keys.has("ShiftLeft")) this.vel.y = -FLY;
    } else {
      this.vel.y -= GRAVITY * dt;
      if (controlsActive && this.keys.has("Space") && this.onGround) this.vel.y = JUMP;
    }

    // Resolve each axis separately so we can slide along walls.
    this.pos.x += this.vel.x * dt;
    if (this.collides(world, this.pos.x, this.pos.y, this.pos.z)) {
      this.pos.x -= this.vel.x * dt;
      this.vel.x = 0;
    }
    this.pos.z += this.vel.z * dt;
    if (this.collides(world, this.pos.x, this.pos.y, this.pos.z)) {
      this.pos.z -= this.vel.z * dt;
      this.vel.z = 0;
    }
    this.pos.y += this.vel.y * dt;
    this.onGround = false;
    if (this.collides(world, this.pos.x, this.pos.y, this.pos.z)) {
      if (this.vel.y < 0) this.onGround = true;
      this.pos.y -= this.vel.y * dt;
      this.vel.y = 0;
      if (this.flying && this.onGround) this.flying = false;
    }
  }

  /** Put the player on top of the terrain at (x, z). */
  spawnAt(world: World, x: number, z: number): void {
    const bx = Math.floor(x), bz = Math.floor(z);
    let y = 0;
    for (let yy = 31; yy >= 0; yy--) {
      if (world.isSolid(bx, yy, bz)) { y = yy + 1; break; }
    }
    this.pos.set(bx + 0.5, y + 0.05, bz + 0.5);
    this.vel.set(0, 0, 0);
  }
}
