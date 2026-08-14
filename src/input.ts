import type { TouchControls, TouchFrame } from "./touchControls";

export type FrameInput = {
  forward: number;
  strafe: number;
  boliMode: boolean;
  sprint: boolean;
  crouch: boolean;
  pause: boolean;
  click: { x: number; y: number } | null;
  shootPresses: number;
  mouseDx: number;
  mouseDy: number;
  pointerLocked: boolean;
  lookActive: boolean;
};

const EMPTY_TOUCH: TouchFrame = {
  forward: 0,
  strafe: 0,
  sprint: false,
  crouch: false,
  boliMode: false,
  pause: false,
  shootPresses: 0,
  lookDx: 0,
  lookDy: 0,
  stickActive: false,
  sessionActive: false,
};

export function createInput(
  canvas: HTMLCanvasElement,
  touch?: TouchControls,
): {
  read: () => FrameInput;
  isPointerLocked: () => boolean;
  setEnabled: (value: boolean) => void;
} {
  const keys = new Set<string>();
  let enabled = false;
  let pauseQueued = false;
  let clickQueued: { x: number; y: number } | null = null;
  let shootPresses = 0;
  let mouseDx = 0;
  let mouseDy = 0;

  window.addEventListener("keydown", (event) => {
    keys.add(event.code);
    if (event.code === "Escape") {
      event.preventDefault();
      if (document.pointerLockElement !== canvas) {
        pauseQueued = true;
      }
    }
    if (!enabled) {
      return;
    }
    if (
      event.code === "Space" ||
      event.code === "KeyQ" ||
      event.code === "KeyC" ||
      event.code === "ControlLeft" ||
      event.code === "ControlRight"
    ) {
      event.preventDefault();
    }
  });

  window.addEventListener("keyup", (event) => {
    keys.delete(event.code);
  });

  canvas.addEventListener("contextmenu", (event) => {
    event.preventDefault();
  });

  canvas.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    clickQueued = { x: event.clientX, y: event.clientY };
    if (enabled && document.pointerLockElement === canvas) {
      shootPresses += 1;
    }
  });

  window.addEventListener("mousemove", (event) => {
    if (document.pointerLockElement !== canvas) {
      return;
    }
    mouseDx += event.movementX;
    mouseDy += event.movementY;
  });

  const axis = (neg: boolean, pos: boolean): number => (pos ? 1 : 0) - (neg ? 1 : 0);

  return {
    isPointerLocked: () => document.pointerLockElement === canvas,
    setEnabled(value: boolean) {
      enabled = value;
      touch?.setEnabled(value);
      if (!value) {
        keys.clear();
        clickQueued = null;
        shootPresses = 0;
        mouseDx = 0;
        mouseDy = 0;
      }
    },
    read(): FrameInput {
      const touchFrame = touch?.read() ?? EMPTY_TOUCH;
      const keyStrafe = axis(keys.has("KeyA") || keys.has("ArrowLeft"), keys.has("KeyD") || keys.has("ArrowRight"));
      const keyForward = axis(keys.has("KeyS") || keys.has("ArrowDown"), keys.has("KeyW") || keys.has("ArrowUp"));
      const pointerLocked = document.pointerLockElement === canvas;
      const input: FrameInput = {
        forward: touchFrame.stickActive ? touchFrame.forward : keyForward,
        strafe: touchFrame.stickActive ? touchFrame.strafe : keyStrafe,
        boliMode: keys.has("KeyQ") || touchFrame.boliMode,
        sprint: keys.has("ShiftLeft") || keys.has("ShiftRight") || touchFrame.sprint,
        crouch: keys.has("ControlLeft") || keys.has("ControlRight") || keys.has("KeyC") || touchFrame.crouch,
        pause: pauseQueued || touchFrame.pause,
        click: clickQueued,
        shootPresses: shootPresses + touchFrame.shootPresses,
        mouseDx: mouseDx + touchFrame.lookDx,
        mouseDy: mouseDy + touchFrame.lookDy,
        pointerLocked,
        lookActive: pointerLocked || touchFrame.sessionActive,
      };
      pauseQueued = false;
      clickQueued = null;
      shootPresses = 0;
      mouseDx = 0;
      mouseDy = 0;
      return input;
    },
  };
}
