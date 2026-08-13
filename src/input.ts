export type FrameInput = {
  forward: number;
  strafe: number;
  boliMode: boolean;
  restart: boolean;
  reveal: boolean;
  toggleView: boolean;
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
  let restartQueued = false;
  let revealQueued = false;
  let toggleViewQueued = false;
  let clickQueued: { x: number; y: number } | null = null;
  let mouseDx = 0;
  let mouseDy = 0;

  window.addEventListener("keydown", (event) => {
    keys.add(event.code);
    if (!enabled) {
      return;
    }
    if (event.code === "Space") {
      event.preventDefault();
      restartQueued = true;
    }
    if (event.code === "KeyR") {
      revealQueued = true;
    }
    if (event.code === "Tab") {
      event.preventDefault();
      toggleViewQueued = true;
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
        restartQueued = false;
        revealQueued = false;
        toggleViewQueued = false;
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
        boliMode: keys.has("ShiftLeft") || keys.has("ShiftRight"),
        restart: restartQueued,
        reveal: revealQueued,
        toggleView: toggleViewQueued,
        click: clickQueued,
        mouseDx,
        mouseDy,
        pointerLocked: document.pointerLockElement === canvas,
      };
      restartQueued = false;
      revealQueued = false;
      toggleViewQueued = false;
      clickQueued = null;
      mouseDx = 0;
      mouseDy = 0;
      return input;
    },
  };
}
