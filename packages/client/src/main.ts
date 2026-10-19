import "./style.css";
import * as THREE from "three";
import {
  BLOCKS,
  DEFAULT_LOOK,
  MAPS,
  REACH,
  isMapId,
  type Look,
  type MapId,
  type PlayerInfo,
  type ServerMsg,
} from "@sg/shared";
import { addLights, animateWalk, buildAvatar, createPreview, makeNameTag, type Avatar } from "./avatar";
import { Net } from "./net";
import { LocalPlayer } from "./player";
import { World, raycast } from "./world";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// ------------------------------------------------------------ profile

interface Profile {
  name: string;
  look: Look;
  map: MapId;
}

const PROFILE_KEY = "blockhaven-profile";

function loadProfile(): Profile {
  const fallback: Profile = { name: "", look: { ...DEFAULT_LOOK }, map: "meadow" };
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (!raw) return fallback;
    const p = JSON.parse(raw) as Partial<Profile>;
    return {
      name: typeof p.name === "string" ? p.name.slice(0, 16) : "",
      look: { ...DEFAULT_LOOK, ...(p.look ?? {}) },
      map: isMapId(p.map) ? p.map : "meadow",
    };
  } catch {
    return fallback;
  }
}

function saveProfile(p: Profile): void {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(p));
  } catch {
    /* storage may be unavailable */
  }
}

function randomCode(): string {
  const chars = "abcdefghjkmnpqrstuvwxyz23456789";
  let s = "";
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

function randomColor(): string {
  const h = Math.floor(Math.random() * 360);
  const c = new THREE.Color().setHSL(h / 360, 0.55, 0.5);
  return "#" + c.getHexString();
}

// --------------------------------------------------------------- menu

const profile = loadProfile();
const urlRoom = (new URLSearchParams(location.search).get("room") ?? "").toLowerCase();

const nameInput = $<HTMLInputElement>("name");
const roomInput = $<HTMLInputElement>("room");
const playBtn = $<HTMLButtonElement>("play");
const menuErr = $<HTMLParagraphElement>("menu-err");
const colorInputs: Record<keyof Look, HTMLInputElement> = {
  skin: $("c-skin"),
  hair: $("c-hair"),
  shirt: $("c-shirt"),
  pants: $("c-pants"),
};

nameInput.value = profile.name;
for (const k of Object.keys(colorInputs) as (keyof Look)[]) colorInputs[k].value = profile.look[k];
if (urlRoom) {
  roomInput.value = urlRoom;
  $("menu-sub").textContent = `You've been invited to room ${urlRoom}.`;
  $("maps-wrap").hidden = true;
}

const preview = createPreview($<HTMLCanvasElement>("preview"));
function currentLook(): Look {
  return {
    skin: colorInputs.skin.value,
    hair: colorInputs.hair.value,
    shirt: colorInputs.shirt.value,
    pants: colorInputs.pants.value,
  };
}
preview.setLook(currentLook());
for (const input of Object.values(colorInputs)) input.addEventListener("input", () => preview.setLook(currentLook()));
$("randomize").addEventListener("click", () => {
  for (const input of Object.values(colorInputs)) input.value = randomColor();
  preview.setLook(currentLook());
});

let selectedMap: MapId = profile.map;
const mapsEl = $("maps");
function renderMaps(): void {
  mapsEl.innerHTML = "";
  for (const def of Object.values(MAPS)) {
    const top = BLOCKS.find((b) => b.id === def.top)!.color;
    const card = document.createElement("div");
    card.className = "map-card" + (def.id === selectedMap ? " sel" : "");
    const sw = document.createElement("div");
    sw.className = "swatch";
    sw.style.background = `linear-gradient(${def.sky} 0%, ${def.sky} 45%, ${top} 45%)`;
    const title = document.createElement("b");
    title.textContent = def.name;
    const blurb = document.createElement("span");
    blurb.textContent = def.blurb;
    card.append(sw, title, blurb);
    card.addEventListener("click", () => {
      selectedMap = def.id;
      renderMaps();
    });
    mapsEl.appendChild(card);
  }
}
renderMaps();

playBtn.addEventListener("click", () => void start());
for (const el of [nameInput, roomInput]) {
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter") void start();
  });
}

async function start(): Promise<void> {
  menuErr.textContent = "";
  const room = (roomInput.value.trim().toLowerCase() || randomCode()).replace(/[^a-z0-9]/g, "");
  if (room.length < 4 || room.length > 12) {
    menuErr.textContent = "Room codes are 4-12 letters or numbers.";
    return;
  }
  const name = nameInput.value.trim() || "Player";
  const look = currentLook();
  saveProfile({ name, look, map: selectedMap });

  playBtn.disabled = true;
  playBtn.textContent = "Connecting...";
  const net = new Net();
  try {
    await net.connect();
  } catch (e) {
    menuErr.textContent = (e as Error).message;
    playBtn.disabled = false;
    playBtn.textContent = "Play";
    return;
  }
  net.onMessage = (msg) => {
    if (msg.t === "init") {
      preview.stop();
      $("menu").hidden = true;
      runGame(net, msg, look);
    } else if (msg.t === "error") {
      menuErr.textContent = msg.msg;
      playBtn.disabled = false;
      playBtn.textContent = "Play";
      net.close();
    }
  };
  net.send({ t: "join", room, map: selectedMap, name, look });
}

// ---------------------------------------------------------------- game

interface Remote {
  info: PlayerInfo;
  avatar: Avatar;
  tag: THREE.Sprite;
  target: THREE.Vector3;
  targetYaw: number;
  speed: number;
}

function runGame(net: Net, init: Extract<ServerMsg, { t: "init" }>, myLook: Look): void {
  const mapDef = MAPS[init.map];
  const canvas = $<HTMLCanvasElement>("game");
  const hud = $("hud");
  hud.hidden = false;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(mapDef.sky);
  scene.fog = new THREE.Fog(mapDef.sky, 45, 120);
  addLights(scene);
  const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 300);
  camera.rotation.order = "YXZ";
  window.addEventListener("resize", () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  });

  const world = new World(init.map);
  scene.add(world.group);
  for (const [x, y, z, id] of init.edits) world.set(x, y, z, id);
  world.flush();

  const highlight = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(1.003, 1.003, 1.003)),
    new THREE.LineBasicMaterial({ color: 0x000000 }),
  );
  highlight.visible = false;
  scene.add(highlight);

  const player = new LocalPlayer();
  player.spawnAt(world, 32 + (Math.random() - 0.5) * 8, 32 + (Math.random() - 0.5) * 8);

  // ---- room info + invite
  const inviteUrl = `${location.origin}${location.pathname}?room=${init.room}`;
  history.replaceState(null, "", `?room=${init.room}`);
  $("room-label").textContent = `${mapDef.name} · room ${init.room}`;
  const toastEl = $("toast");
  let toastTimer = 0;
  function toast(text: string): void {
    toastEl.textContent = text;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => (toastEl.hidden = true), 2500);
  }
  $("invite").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      toast("Invite link copied!");
    } catch {
      toast(inviteUrl);
    }
  });

  // ---- chat
  const chatLog = $("chat-log");
  const chatInput = $<HTMLInputElement>("chat-input");
  let chatOpen = false;
  function addChat(who: string | null, text: string): void {
    const el = document.createElement("div");
    el.className = "msg" + (who === null ? " sys" : "");
    el.textContent = who === null ? text : `${who}: ${text}`;
    chatLog.appendChild(el);
    while (chatLog.children.length > 8) chatLog.firstElementChild?.remove();
    setTimeout(() => el.classList.add("old"), 12000);
  }
  function openChat(): void {
    chatOpen = true;
    player.keys.clear();
    document.exitPointerLock();
    chatInput.hidden = false;
    chatInput.value = "";
    chatInput.focus();
    pausedEl.hidden = true;
  }
  function closeChat(relock: boolean): void {
    chatOpen = false;
    chatInput.hidden = true;
    chatInput.blur();
    if (relock) canvas.requestPointerLock();
  }
  chatInput.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") {
      const text = chatInput.value.trim();
      if (text) net.send({ t: "chat", text });
      closeChat(true);
    } else if (e.key === "Escape") {
      closeChat(false);
    }
  });

  // ---- remote players
  const remotes = new Map<string, Remote>();
  const playersEl = $("players");
  function renderPlayers(): void {
    playersEl.innerHTML = "";
    const all = [{ name: "You", look: myLook }, ...[...remotes.values()].map((r) => r.info)];
    for (const p of all) {
      const row = document.createElement("div");
      const dot = document.createElement("span");
      dot.textContent = "● ";
      dot.style.color = p.look.shirt;
      row.append(dot, document.createTextNode(p.name));
      playersEl.appendChild(row);
    }
  }
  function addRemote(info: PlayerInfo): void {
    if (remotes.has(info.id)) return;
    const avatar = buildAvatar(info.look);
    const tag = makeNameTag(info.name);
    avatar.group.add(tag);
    avatar.group.position.set(...info.p);
    scene.add(avatar.group);
    remotes.set(info.id, {
      info, avatar, tag,
      target: new THREE.Vector3(...info.p),
      targetYaw: info.r[0],
      speed: 0,
    });
    renderPlayers();
  }
  function removeRemote(id: string): void {
    const r = remotes.get(id);
    if (!r) return;
    scene.remove(r.avatar.group);
    r.avatar.dispose();
    (r.tag.material as THREE.SpriteMaterial).map?.dispose();
    r.tag.material.dispose();
    remotes.delete(id);
    renderPlayers();
  }
  for (const p of init.players) addRemote(p);
  renderPlayers();
  addChat(null, "Welcome! Press Enter to chat, F to fly.");

  net.onMessage = (msg) => {
    switch (msg.t) {
      case "join":
        addRemote(msg.player);
        addChat(null, `${msg.player.name} joined`);
        break;
      case "leave": {
        const r = remotes.get(msg.id);
        if (r) addChat(null, `${r.info.name} left`);
        removeRemote(msg.id);
        break;
      }
      case "move": {
        const r = remotes.get(msg.id);
        if (r) {
          r.target.set(...msg.p);
          r.targetYaw = msg.r[0];
        }
        break;
      }
      case "block":
        world.set(msg.x, msg.y, msg.z, msg.id);
        break;
      case "chat":
        addChat(msg.name, msg.text);
        break;
      case "error":
        toast(msg.msg);
        break;
    }
  };
  net.onClose = () => {
    toast("Disconnected from server. Refresh to rejoin.");
    addChat(null, "Disconnected from server.");
  };

  // ---- hotbar
  let selected = 0;
  const hotbar = $("hotbar");
  const slots: HTMLElement[] = [];
  BLOCKS.forEach((b, i) => {
    const slot = document.createElement("div");
    slot.className = "slot";
    slot.title = b.name;
    const swatch = document.createElement("i");
    swatch.style.background = b.color;
    const num = document.createElement("em");
    num.textContent = String(i + 1);
    slot.append(swatch, num);
    hotbar.appendChild(slot);
    slots.push(slot);
  });
  function select(i: number): void {
    selected = (i + BLOCKS.length) % BLOCKS.length;
    slots.forEach((s, n) => s.classList.toggle("sel", n === selected));
  }
  select(0);

  // ---- input
  const pausedEl = $("paused");
  const locked = () => document.pointerLockElement === canvas;
  canvas.addEventListener("click", () => {
    if (!locked() && !chatOpen) canvas.requestPointerLock();
  });
  pausedEl.hidden = false;
  document.addEventListener("pointerlockchange", () => {
    pausedEl.hidden = locked() || chatOpen;
    if (!locked()) player.keys.clear();
  });
  document.addEventListener("mousemove", (e) => {
    if (!locked()) return;
    player.yaw -= e.movementX * 0.0022;
    player.pitch = Math.max(-1.55, Math.min(1.55, player.pitch - e.movementY * 0.0022));
  });
  document.addEventListener("keydown", (e) => {
    if (chatOpen) return;
    if (e.code === "Enter") {
      e.preventDefault();
      openChat();
      return;
    }
    if (!locked()) return;
    if (e.code === "KeyF" && !e.repeat) player.flying = !player.flying;
    if (e.code.startsWith("Digit")) {
      const n = Number(e.code.slice(5));
      if (n >= 1 && n <= BLOCKS.length) select(n - 1);
    }
    if (e.code === "Space" || e.code === "ShiftLeft") e.preventDefault();
    player.keys.add(e.code);
  });
  document.addEventListener("keyup", (e) => player.keys.delete(e.code));
  window.addEventListener("blur", () => player.keys.clear());
  document.addEventListener("wheel", (e) => {
    if (locked()) select(selected + (e.deltaY > 0 ? 1 : -1));
  });
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  document.addEventListener("mousedown", (e) => {
    if (!locked()) return;
    const hit = raycast(world, player.eye, player.forward(), REACH);
    if (!hit) return;
    if (e.button === 0) {
      const [x, y, z] = hit.hit;
      world.set(x, y, z, 0);
      net.send({ t: "block", x, y, z, id: 0 });
    } else if (e.button === 2) {
      const [x, y, z] = hit.prev;
      if (world.get(x, y, z) !== 0 || y < 0 || y >= 32) return;
      if (player.intersectsBlock(x, y, z)) return;
      const id = BLOCKS[selected].id;
      world.set(x, y, z, id);
      net.send({ t: "block", x, y, z, id });
    }
  });

  // ---- main loop
  let last = performance.now();
  let lastSend = 0;
  let sentYaw = NaN, sentPitch = NaN;
  const sentPos = new THREE.Vector3(NaN, NaN, NaN);
  const lerpAngle = (a: number, b: number, t: number) => {
    let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
    if (d < -Math.PI) d += Math.PI * 2;
    return a + d * t;
  };

  function frame(now: number): void {
    requestAnimationFrame(frame);
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    const time = now / 1000;

    player.update(dt, world, locked());
    world.flush();

    camera.position.copy(player.eye);
    camera.rotation.set(player.pitch, player.yaw, 0);

    if (locked()) {
      const hit = raycast(world, player.eye, player.forward(), REACH);
      highlight.visible = !!hit;
      if (hit) highlight.position.set(hit.hit[0] + 0.5, hit.hit[1] + 0.5, hit.hit[2] + 0.5);
    } else {
      highlight.visible = false;
    }

    for (const r of remotes.values()) {
      const g = r.avatar.group;
      const before = g.position.clone();
      g.position.lerp(r.target, 1 - Math.exp(-12 * dt));
      const moved = Math.hypot(g.position.x - before.x, g.position.z - before.z) / Math.max(dt, 1e-3);
      r.speed += (Math.min(moved / 4, 1) - r.speed) * Math.min(1, dt * 10);
      g.rotation.y = lerpAngle(g.rotation.y, r.targetYaw + Math.PI, 1 - Math.exp(-14 * dt));
      animateWalk(r.avatar, r.speed, time);
    }

    if (now - lastSend > 66) {
      const moved =
        sentPos.distanceToSquared(player.pos) > 1e-4 ||
        Math.abs(player.yaw - sentYaw) > 0.01 ||
        Math.abs(player.pitch - sentPitch) > 0.01 ||
        Number.isNaN(sentYaw);
      if (moved) {
        net.send({ t: "move", p: [player.pos.x, player.pos.y, player.pos.z], r: [player.yaw, player.pitch] });
        sentPos.copy(player.pos);
        sentYaw = player.yaw;
        sentPitch = player.pitch;
      }
      lastSend = now;
    }

    renderer.render(scene, camera);
  }
  requestAnimationFrame(frame);
}
