export type FrameInput = {
  forward: number;
  strafe: number;
  boliMode: boolean;
  sprint: boolean;
  crouch: boolean;
  pause: boolean;
  click: { x: number; y: number } | null;
  mouseDx: number;
  mouseDy: number;
  pointerLocked: boolean;
};

export function createInput(canvas: HTMLCanvasElement): {
  read: () => FrameInput;
  isPointerLocked: () => boolean;
  setEnabled: (value: boolean) => void;
} {
  const keys = new Set<string>();
  let enabled = false;
  let pauseQueued = false;
  let clickQueued: { x: number; y: number } | null = null;
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
    if (event.code === "Space" || event.code === "KeyQ" || event.code === "ControlLeft" || event.code === "ControlRight") {
      event.preventDefault();
    }
  });

  window.addEventListener("keyup", (event) => {
    keys.delete(event.code);
  });

  canvas.addEventListener("mousedown", (event) => {
    clickQueued = { x: event.clientX, y: event.clientY };
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
      if (!value) {
        keys.clear();
        clickQueued = null;
        mouseDx = 0;
        mouseDy = 0;
      }
    },
    read(): FrameInput {
      const strafe = axis(keys.has("KeyA") || keys.has("ArrowLeft"), keys.has("KeyD") || keys.has("ArrowRight"));
      const forward = axis(keys.has("KeyS") || keys.has("ArrowDown"), keys.has("KeyW") || keys.has("ArrowUp"));
      const input: FrameInput = {
        forward,
        strafe,
        boliMode: keys.has("KeyQ"),
        sprint: keys.has("ShiftLeft") || keys.has("ShiftRight"),
        crouch: keys.has("ControlLeft") || keys.has("ControlRight"),
        pause: pauseQueued,
        click: clickQueued,
        mouseDx,
        mouseDy,
        pointerLocked: document.pointerLockElement === canvas,
      };
      pauseQueued = false;
      clickQueued = null;
      mouseDx = 0;
      mouseDy = 0;
      return input;
    },
  };
}
