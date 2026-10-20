import type { LocalPlayer } from "./player";

export type TapMode = "break" | "place";

export interface TouchHooks {
  player: LocalPlayer;
  canvas: HTMLCanvasElement;
  /** Break or place at a screen point given in normalised device coordinates (-1..1). */
  onAction(mode: TapMode, ndcX: number, ndcY: number): void;
  onChat(): void;
  isChatOpen(): boolean;
  closeChat(): void;
  /** Called once, the first time touch controls turn on. */
  onEnable(): void;
  onMode(mode: TapMode): void;
}

export interface TouchControls {
  readonly enabled: boolean;
  enable(): void;
  /** Call every frame to keep button states in step with the player. */
  sync(): void;
}

const JOY_RADIUS = 56;
const DEADZONE = 0.12;
const LOOK_SPEED = 0.0048;
const TAP_MS = 280;
const HOLD_MS = 380;
const MOVE_SLOP = 10;

export function isCoarsePointer(): boolean {
  return window.matchMedia("(pointer: coarse)").matches;
}

interface Track {
  kind: "joy" | "look";
  /** Where the touch started (joystick origin). */
  sx: number;
  sy: number;
  /** Last seen position. */
  x: number;
  y: number;
  t: number;
  /** Total distance travelled, for telling taps from drags. */
  dist: number;
  hold?: number;
  done: boolean;
}

function div(cls: string): HTMLDivElement {
  const d = document.createElement("div");
  d.className = cls;
  return d;
}

function button(cls: string, label: string, title: string): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = `tbtn ${cls}`;
  b.textContent = label;
  b.setAttribute("aria-label", title);
  b.title = title;
  b.addEventListener("contextmenu", (e) => e.preventDefault());
  return b;
}

export function setupTouch(h: TouchHooks): TouchControls {
  const { player, canvas } = h;
  const hud = document.getElementById("hud")!;
  let enabled = false;
  let mode: TapMode = "place";

  const root = div("");
  root.id = "touch-ui";
  root.hidden = true;
  hud.appendChild(root);

  // ------------------------------------------------------------ joystick
  const joy = div("joy");
  const knob = div("joy-knob");
  joy.appendChild(knob);
  root.appendChild(joy);

  function placeJoy(x: number, y: number): void {
    joy.style.left = `${x}px`;
    joy.style.top = `${y}px`;
  }
  function restJoy(): void {
    placeJoy(Math.min(110, window.innerWidth * 0.2), window.innerHeight - 130);
  }
  function setKnob(dx: number, dy: number): void {
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
  }

  // ------------------------------------------------------------- buttons
  const jump = button("tjump", "Jump", "Jump");
  const col = div("tcol");
  const modeBtn = button("", "🧱", "Place blocks (tap to switch to break)");
  const flyBtn = button("", "🕊️", "Toggle flying");
  const downBtn = button("", "⬇", "Fly down");
  const chatBtn = button("", "💬", "Chat");
  downBtn.hidden = true;
  col.append(modeBtn, flyBtn, downBtn, chatBtn);
  if (document.fullscreenEnabled) {
    const fs = button("", "⛶", "Fullscreen");
    fs.addEventListener("click", () => {
      if (document.fullscreenElement) void document.exitFullscreen();
      else void document.documentElement.requestFullscreen?.().catch(() => {});
    });
    col.appendChild(fs);
  }
  root.append(jump, col);

  /** A button that holds a key down while it is pressed. */
  function holdKey(b: HTMLButtonElement, code: string): void {
    const press = (e: PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        b.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      player.keys.add(code);
      b.classList.add("on");
    };
    const release = () => {
      player.keys.delete(code);
      b.classList.remove("on");
    };
    b.addEventListener("pointerdown", press);
    b.addEventListener("pointerup", release);
    b.addEventListener("pointercancel", release);
    b.addEventListener("lostpointercapture", release);
  }
  holdKey(jump, "Space");
  holdKey(downBtn, "ShiftLeft");

  /**
   * Run an action as soon as the button is pressed. Waiting for `click` is
   * unreliable with two thumbs on the screen, so `click` is only used as the
   * keyboard fallback (it has no pointer event before it).
   */
  function onPress(b: HTMLButtonElement, fn: () => void): void {
    let viaPointer = false;
    b.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      viaPointer = true;
      fn();
    });
    b.addEventListener("click", () => {
      if (viaPointer) {
        viaPointer = false;
        return;
      }
      fn();
    });
  }

  onPress(flyBtn, () => {
    player.flying = !player.flying;
  });
  onPress(chatBtn, () => h.onChat());
  onPress(modeBtn, () => {
    mode = mode === "place" ? "break" : "place";
    modeBtn.textContent = mode === "place" ? "🧱" : "⛏️";
    modeBtn.title = mode === "place" ? "Place blocks (tap to switch to break)" : "Break blocks (tap to switch to place)";
    modeBtn.setAttribute("aria-label", modeBtn.title);
    h.onMode(mode);
  });

  // ------------------------------------------------- joystick + look + tap
  const tracks = new Map<number, Track>();
  let joyId: number | null = null;

  function fire(m: TapMode, clientX: number, clientY: number): void {
    h.onAction(m, (clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
  }

  function stopMoving(): void {
    player.analogX = 0;
    player.analogZ = 0;
    joyId = null;
    joy.classList.remove("active");
    setKnob(0, 0);
    restJoy();
  }

  canvas.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse") return;
    enable();
    e.preventDefault();
    if (h.isChatOpen()) {
      h.closeChat();
      return;
    }
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    const now = performance.now();
    const inJoyZone = e.clientX < window.innerWidth * 0.45 && e.clientY > window.innerHeight * 0.4;
    if (joyId === null && inJoyZone) {
      joyId = e.pointerId;
      tracks.set(e.pointerId, {
        kind: "joy", sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY, t: now, dist: 0, done: false,
      });
      placeJoy(e.clientX, e.clientY);
      joy.classList.add("active");
      setKnob(0, 0);
    } else {
      const t: Track = {
        kind: "look", sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY, t: now, dist: 0, done: false,
      };
      // Holding still performs the opposite of a tap.
      t.hold = window.setTimeout(() => {
        if (t.done || t.dist >= MOVE_SLOP) return;
        t.done = true;
        navigator.vibrate?.(15);
        fire(mode === "place" ? "break" : "place", t.x, t.y);
      }, HOLD_MS);
      tracks.set(e.pointerId, t);
    }
  });

  canvas.addEventListener("pointermove", (e) => {
    const t = tracks.get(e.pointerId);
    if (!t) return;
    e.preventDefault();
    const dx = e.clientX - t.x;
    const dy = e.clientY - t.y;
    t.dist += Math.abs(dx) + Math.abs(dy);
    if (t.kind === "joy") {
      const ox = e.clientX - t.sx;
      const oy = e.clientY - t.sy;
      const len = Math.hypot(ox, oy);
      const k = len > JOY_RADIUS ? JOY_RADIUS / len : 1;
      const nx = (ox * k) / JOY_RADIUS;
      const ny = (oy * k) / JOY_RADIUS;
      if (Math.hypot(nx, ny) < DEADZONE) {
        player.analogX = 0;
        player.analogZ = 0;
      } else {
        player.analogX = nx;
        player.analogZ = ny;
      }
      setKnob(nx * JOY_RADIUS, ny * JOY_RADIUS);
    } else {
      player.yaw -= dx * LOOK_SPEED;
      player.pitch = Math.max(-1.55, Math.min(1.55, player.pitch - dy * LOOK_SPEED));
    }
    t.x = e.clientX;
    t.y = e.clientY;
  });

  function end(e: PointerEvent, cancelled: boolean): void {
    const t = tracks.get(e.pointerId);
    if (!t) return;
    tracks.delete(e.pointerId);
    if (t.hold !== undefined) clearTimeout(t.hold);
    if (t.kind === "joy") {
      stopMoving();
      return;
    }
    if (!cancelled && !t.done && t.dist < MOVE_SLOP && performance.now() - t.t < TAP_MS) {
      fire(mode, e.clientX, e.clientY);
    }
  }
  canvas.addEventListener("pointerup", (e) => end(e, false));
  canvas.addEventListener("pointercancel", (e) => end(e, true));

  // Don't leave the player walking if the page loses focus mid-touch.
  window.addEventListener("blur", () => {
    for (const t of tracks.values()) if (t.hold !== undefined) clearTimeout(t.hold);
    tracks.clear();
    stopMoving();
  });
  window.addEventListener("resize", () => {
    if (joyId === null) restJoy();
  });

  function enable(): void {
    if (enabled) return;
    enabled = true;
    root.hidden = false;
    document.body.classList.add("touch");
    restJoy();
    h.onEnable();
  }

  return {
    get enabled() {
      return enabled;
    },
    enable,
    sync() {
      if (!enabled) return;
      flyBtn.classList.toggle("on", player.flying);
      downBtn.hidden = !player.flying;
    },
  };
}
