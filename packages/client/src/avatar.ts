import * as THREE from "three";
import type { Look } from "@sg/shared";

export interface Avatar {
  group: THREE.Group;
  legL: THREE.Object3D;
  legR: THREE.Object3D;
  armL: THREE.Object3D;
  armR: THREE.Object3D;
  look: Look;
  dispose(): void;
}

const box = new THREE.BoxGeometry(1, 1, 1);
const eyeMat = new THREE.MeshLambertMaterial({ color: "#151515" });

function part(
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  size: [number, number, number],
  pos: [number, number, number],
  pivotTop = false,
): THREE.Object3D {
  const mesh = new THREE.Mesh(geo, mat);
  mesh.scale.set(...size);
  if (!pivotTop) {
    mesh.position.set(...pos);
    return mesh;
  }
  // Limbs swing from the top, so wrap them in a pivot at the joint.
  const pivot = new THREE.Group();
  pivot.position.set(pos[0], pos[1] + size[1] / 2, pos[2]);
  mesh.position.y = -size[1] / 2;
  pivot.add(mesh);
  return pivot;
}

/** Builds a blocky avatar standing on y = 0, facing +Z. */
export function buildAvatar(look: Look): Avatar {
  const skin = new THREE.MeshLambertMaterial({ color: look.skin });
  const hair = new THREE.MeshLambertMaterial({ color: look.hair });
  const shirt = new THREE.MeshLambertMaterial({ color: look.shirt });
  const pants = new THREE.MeshLambertMaterial({ color: look.pants });

  const group = new THREE.Group();
  const legL = part(box, pants, [0.25, 0.7, 0.25], [-0.13, 0.7, 0], true);
  const legR = part(box, pants, [0.25, 0.7, 0.25], [0.13, 0.7, 0], true);
  const body = part(box, shirt, [0.5, 0.7, 0.25], [0, 1.05, 0]);
  const armL = part(box, shirt, [0.2, 0.7, 0.2], [-0.36, 1.4, 0], true);
  const armR = part(box, shirt, [0.2, 0.7, 0.2], [0.36, 1.4, 0], true);
  const head = part(box, skin, [0.45, 0.45, 0.45], [0, 1.6, 0]);
  const hairTop = part(box, hair, [0.47, 0.14, 0.47], [0, 1.82, -0.0]);
  const hairBack = part(box, hair, [0.47, 0.3, 0.1], [0, 1.65, -0.19]);
  const eyeL = part(box, eyeMat, [0.07, 0.07, 0.03], [-0.1, 1.63, 0.23]);
  const eyeR = part(box, eyeMat, [0.07, 0.07, 0.03], [0.1, 1.63, 0.23]);
  group.add(legL, legR, body, armL, armR, head, hairTop, hairBack, eyeL, eyeR);

  return {
    group, legL, legR, armL, armR, look,
    dispose() {
      skin.dispose(); hair.dispose(); shirt.dispose(); pants.dispose();
    },
  };
}

/** Swing limbs; `amount` is 0 when idle and ~1 when walking. */
export function animateWalk(a: Avatar, amount: number, time: number): void {
  const swing = Math.sin(time * 9) * 0.7 * amount;
  a.legL.rotation.x = swing;
  a.legR.rotation.x = -swing;
  a.armL.rotation.x = -swing;
  a.armR.rotation.x = swing;
}

export function makeNameTag(name: string): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  ctx.font = "bold 30px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const w = Math.min(244, ctx.measureText(name).width + 24);
  ctx.fillStyle = "rgba(10,14,24,0.65)";
  ctx.beginPath();
  ctx.roundRect((256 - w) / 2, 8, w, 48, 12);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.fillText(name, 128, 33, 232);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
  sprite.scale.set(1.6, 0.4, 1);
  sprite.position.y = 2.25;
  return sprite;
}

export function addLights(scene: THREE.Scene): void {
  scene.add(new THREE.AmbientLight(0xffffff, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  sun.position.set(3, 8, 5);
  scene.add(sun);
}

/** A small spinning avatar for the start menu. */
export function createPreview(canvas: HTMLCanvasElement) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(canvas.width, canvas.height, false);
  const scene = new THREE.Scene();
  addLights(scene);
  const camera = new THREE.PerspectiveCamera(30, canvas.width / canvas.height, 0.1, 50);
  camera.position.set(0, 1.1, 5.2);
  camera.lookAt(0, 0.95, 0);

  let avatar: Avatar | null = null;
  let raf = 0;
  const start = performance.now();

  function setLook(look: Look): void {
    if (avatar) {
      scene.remove(avatar.group);
      avatar.dispose();
    }
    avatar = buildAvatar(look);
    scene.add(avatar.group);
  }
  function frame(): void {
    const t = (performance.now() - start) / 1000;
    if (avatar) {
      avatar.group.rotation.y = Math.sin(t * 0.8) * 0.9 + 0.3;
      animateWalk(avatar, 0.25, t);
    }
    renderer.render(scene, camera);
    raf = requestAnimationFrame(frame);
  }
  frame();

  return {
    setLook,
    stop() {
      cancelAnimationFrame(raf);
      renderer.dispose();
    },
  };
}
