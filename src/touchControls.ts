import type { ControlRole } from "./sim/types";
import { canRequestFullscreen, toggleFullscreen, usesTouchInput } from "./platform";

export type TouchFrame = {
  forward: number;
  strafe: number;
  sprint: boolean;
  crouch: boolean;
  boliMode: boolean;
  pause: boolean;
  shootPresses: number;
  lookDx: number;
  lookDy: number;
  stickActive: boolean;
  sessionActive: boolean;
};

const STICK_RADIUS = 56;
const STICK_DEAD = 0.12;
const STICK_SPRINT = 0.92;
const LOOK_SLOP = 12;
const LEFT_FRACTION = 0.46;

type StickPointer = {
  kind: "stick";
  originX: number;
  originY: number;
};

type LookPointer = {
  kind: "look";
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  armed: boolean;
};

type Pointer = StickPointer | LookPointer;

export type TouchControls = {
  read: () => TouchFrame;
  setEnabled: (value: boolean) => void;
  setVisible: (value: boolean) => void;
  setRole: (role: ControlRole) => void;
};

function must(selector: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(selector);
  if (!el) {
    throw new Error(`No se encontró ${selector}`);
  }
  return el;
}

export function bindTouchControls(): TouchControls {
  const root = must("#touch");
  const stage = must("#touchStage");
  const stickBase = must("#stickBase");
  const stickKnob = must("#stickKnob");
  const btnPause = must("#touchPause");
  const btnSprint = must("#touchSprint");
  const btnCrouch = must("#touchCrouch");
  const btnBoli = must("#touchBoli");
  const btnFire = must("#touchFire");
  const btnFull = must("#touchFull");
  const rotate = must("#touchRotate");

  const pointers = new Map<number, Pointer>();
  let enabled = false;
  let visible = false;
  let sessionActive = false;
  let pauseQueued = false;
  let shootPresses = 0;
  let lookDx = 0;
  let lookDy = 0;
  let stickX = 0;
  let stickY = 0;
  let stickActive = false;
  let sprintHeld = false;
  let crouchHeld = false;
  let boliHeld = false;
  let role: ControlRole = "INFILTRATOR";

  const syncChrome = () => {
    root.classList.toggle("hidden", !visible);
    root.setAttribute("aria-hidden", visible ? "false" : "true");
    const hunter = role === "HUNTER";
    btnFire.classList.toggle("hidden", !hunter);
    btnBoli.classList.toggle("hidden", hunter);
    rotate.classList.toggle(
      "hidden",
      !visible || !window.matchMedia("(orientation: portrait)").matches,
    );
    btnFull.classList.toggle("hidden", !visible || !canRequestFullscreen());
  };

  const resetStick = () => {
    stickX = 0;
    stickY = 0;
    stickActive = false;
    stickBase.classList.remove("dragging");
    stickBase.style.left = "";
    stickBase.style.top = "";
    stickKnob.style.transform = "";
  };

  const applyStick = (nx: number, ny: number) => {
    const mag = Math.hypot(nx, ny);
    const cap = mag > 1 ? 1 / mag : 1;
    stickX = nx * cap;
    stickY = ny * cap;
    stickKnob.style.transform = `translate(${stickX * STICK_RADIUS}px, ${stickY * STICK_RADIUS}px)`;
  };

  const onStageDown = (event: PointerEvent) => {
    if (!enabled || !visible || event.button !== 0) {
      return;
    }
    const rect = stage.getBoundingClientRect();
    const left = event.clientX - rect.left < rect.width * LEFT_FRACTION;
    event.preventDefault();
    stage.setPointerCapture(event.pointerId);
    if (left && ![...pointers.values()].some((item) => item.kind === "stick")) {
      stickActive = true;
      stickBase.classList.add("dragging");
      stickBase.style.left = `${event.clientX}px`;
      stickBase.style.top = `${event.clientY}px`;
      pointers.set(event.pointerId, {
        kind: "stick",
        originX: event.clientX,
        originY: event.clientY,
      });
      applyStick(0, 0);
      return;
    }
    pointers.set(event.pointerId, {
      kind: "look",
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      armed: false,
    });
  };

  const onStageMove = (event: PointerEvent) => {
    const pointer = pointers.get(event.pointerId);
    if (!pointer) {
      return;
    }
    event.preventDefault();
    if (pointer.kind === "stick") {
      applyStick((event.clientX - pointer.originX) / STICK_RADIUS, (event.clientY - pointer.originY) / STICK_RADIUS);
      return;
    }
    const mx = event.clientX - pointer.lastX;
    const my = event.clientY - pointer.lastY;
    pointer.lastX = event.clientX;
    pointer.lastY = event.clientY;
    if (!pointer.armed) {
      const travel = Math.hypot(event.clientX - pointer.startX, event.clientY - pointer.startY);
      if (travel < LOOK_SLOP) {
        return;
      }
      pointer.armed = true;
      return;
    }
    lookDx += mx;
    lookDy += my;
  };

  const onStageUp = (event: PointerEvent) => {
    const pointer = pointers.get(event.pointerId);
    if (!pointer) {
      return;
    }
    pointers.delete(event.pointerId);
    if (pointer.kind === "stick") {
      resetStick();
    }
    try {
      stage.releasePointerCapture(event.pointerId);
    } catch {
      /* already released */
    }
  };

  stage.addEventListener("pointerdown", onStageDown);
  stage.addEventListener("pointermove", onStageMove);
  stage.addEventListener("pointerup", onStageUp);
  stage.addEventListener("pointercancel", onStageUp);

  const bindHold = (el: HTMLElement, onChange: (down: boolean) => void) => {
    const down = (event: PointerEvent) => {
      if (!enabled || event.button !== 0) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      el.setPointerCapture(event.pointerId);
      el.classList.add("on");
      onChange(true);
    };
    const up = (event: PointerEvent) => {
      event.preventDefault();
      event.stopPropagation();
      el.classList.remove("on");
      onChange(false);
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  };

  bindHold(btnSprint, (down) => {
    sprintHeld = down;
  });
  bindHold(btnCrouch, (down) => {
    crouchHeld = down;
  });
  bindHold(btnBoli, (down) => {
    boliHeld = down;
  });

  btnFire.addEventListener("pointerdown", (event) => {
    if (!enabled || event.button !== 0) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    btnFire.classList.add("on");
    shootPresses += 1;
  });
  const fireUp = (event: PointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    btnFire.classList.remove("on");
  };
  btnFire.addEventListener("pointerup", fireUp);
  btnFire.addEventListener("pointercancel", fireUp);

  btnPause.addEventListener("pointerdown", (event) => {
    if (!enabled || event.button !== 0) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    pauseQueued = true;
  });

  btnFull.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    event.stopPropagation();
    toggleFullscreen();
  });

  const onOrient = () => {
    if (visible) {
      rotate.classList.toggle("hidden", !window.matchMedia("(orientation: portrait)").matches);
    }
  };
  window.addEventListener("orientationchange", onOrient);
  window.addEventListener("resize", onOrient);

  resetStick();
  syncChrome();

  return {
    setEnabled(value: boolean) {
      enabled = value;
      sessionActive = value && visible && usesTouchInput();
      if (!value) {
        pointers.clear();
        resetStick();
        sprintHeld = false;
        crouchHeld = false;
        boliHeld = false;
        pauseQueued = false;
        shootPresses = 0;
        lookDx = 0;
        lookDy = 0;
        btnSprint.classList.remove("on");
        btnCrouch.classList.remove("on");
        btnBoli.classList.remove("on");
        btnFire.classList.remove("on");
      }
    },
    setVisible(value: boolean) {
      visible = value;
      sessionActive = enabled && visible && usesTouchInput();
      if (!value) {
        pointers.clear();
        resetStick();
      }
      syncChrome();
    },
    setRole(next: ControlRole) {
      role = next;
      syncChrome();
    },
    read(): TouchFrame {
      const mag = Math.hypot(stickX, stickY);
      const live = mag <= STICK_DEAD ? 0 : (mag - STICK_DEAD) / (1 - STICK_DEAD);
      const scale = mag > 0 ? live / mag : 0;
      const frame: TouchFrame = {
        forward: stickActive ? -stickY * scale : 0,
        strafe: stickActive ? stickX * scale : 0,
        sprint: sprintHeld || (stickActive && mag >= STICK_SPRINT),
        crouch: crouchHeld,
        boliMode: boliHeld,
        pause: pauseQueued,
        shootPresses,
        lookDx,
        lookDy,
        stickActive,
        sessionActive,
      };
      pauseQueued = false;
      shootPresses = 0;
      lookDx = 0;
      lookDy = 0;
      return frame;
    },
  };
}
