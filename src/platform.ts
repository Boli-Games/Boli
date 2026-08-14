export type FormFactor = "desktop" | "phone" | "tablet";
export type InputMode = "desktop" | "touch";

export type Platform = {
  form: FormFactor;
  input: InputMode;
};

type Media = {
  fine: boolean;
  coarse: boolean;
  hover: boolean;
  primaryCoarse: boolean;
  primaryHover: boolean;
};

const FORCE_PARAM = "controls";

let current: Platform = { form: "desktop", input: "desktop" };
let listening = false;
const listeners = new Set<(platform: Platform) => void>();

function media(): Media {
  const mq = (query: string) => window.matchMedia(query).matches;
  return {
    fine: mq("(any-pointer: fine)"),
    coarse: mq("(any-pointer: coarse)"),
    hover: mq("(any-hover: hover)"),
    primaryCoarse: mq("(pointer: coarse)"),
    primaryHover: mq("(hover: hover)"),
  };
}

function forcedInput(): InputMode | null {
  try {
    const value = new URLSearchParams(window.location.search).get(FORCE_PARAM);
    if (value === "touch") {
      return "touch";
    }
    if (value === "desktop") {
      return "desktop";
    }
  } catch {
    /* ignore */
  }
  return null;
}

function viewportMin(): number {
  return Math.min(window.innerWidth || 1, window.innerHeight || 1);
}

function viewportMax(): number {
  return Math.max(window.innerWidth || 1, window.innerHeight || 1);
}

function touchPoints(): number {
  return navigator.maxTouchPoints || 0;
}

/**
 * Touch-first devices (phones, tablets, Chrome device mode):
 * coarse primary pointer and no hover. A PC with a touch monitor keeps
 * a fine pointer + hover, so it stays on the desktop input path.
 */
function detectInput(forced: InputMode | null, probe: Media): InputMode {
  if (forced) {
    return forced;
  }
  if (probe.primaryCoarse && !probe.primaryHover) {
    return "touch";
  }
  if (!probe.fine && (probe.coarse || touchPoints() > 0) && !probe.hover) {
    return "touch";
  }
  return "desktop";
}

function detectForm(input: InputMode): FormFactor {
  if (input !== "touch") {
    return "desktop";
  }
  const min = viewportMin();
  const max = viewportMax();
  if (min >= 600 && max >= 900) {
    return "tablet";
  }
  return "phone";
}

function detect(): Platform {
  const probe = media();
  const input = detectInput(forcedInput(), probe);
  return { form: detectForm(input), input };
}

function syncDom(platform: Platform): void {
  const root = document.documentElement;
  root.classList.toggle("input-touch", platform.input === "touch");
  root.classList.toggle("input-desktop", platform.input === "desktop");
  root.classList.toggle("form-phone", platform.form === "phone");
  root.classList.toggle("form-tablet", platform.form === "tablet");
  root.classList.toggle("form-desktop", platform.form === "desktop");
  root.classList.toggle("is-portrait", window.matchMedia("(orientation: portrait)").matches);
  root.dataset.platform = `${platform.form}-${platform.input}`;
}

function emit(): void {
  const next = detect();
  const changed = next.form !== current.form || next.input !== current.input;
  current = next;
  syncDom(current);
  if (changed) {
    for (const listener of listeners) {
      listener(current);
    }
  } else {
    syncDom(current);
  }
}

export function initPlatform(): Platform {
  current = detect();
  syncDom(current);
  if (!listening) {
    listening = true;
    const refresh = () => emit();
    for (const query of ["(pointer: coarse)", "(hover: none)", "(any-pointer: fine)", "(orientation: portrait)"]) {
      try {
        window.matchMedia(query).addEventListener("change", refresh);
      } catch {
        /* older Safari */
      }
    }
    window.addEventListener("resize", refresh);
    window.addEventListener("orientationchange", refresh);
  }
  return current;
}

export function getPlatform(): Platform {
  return current;
}

export function usesTouchInput(): boolean {
  return current.input === "touch";
}

export function isPortrait(): boolean {
  return window.matchMedia("(orientation: portrait)").matches;
}

export function onPlatformChange(listener: (platform: Platform) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function viewportSize(): { w: number; h: number } {
  if (usesTouchInput() && window.visualViewport) {
    return {
      w: Math.max(1, Math.round(window.visualViewport.width)),
      h: Math.max(1, Math.round(window.visualViewport.height)),
    };
  }
  return {
    w: Math.max(1, window.innerWidth),
    h: Math.max(1, window.innerHeight),
  };
}

export function preferLandscape(): void {
  const orientation = screen.orientation as ScreenOrientation & {
    lock?: (type: string) => Promise<void>;
  };
  if (!orientation?.lock || !usesTouchInput()) {
    return;
  }
  void orientation.lock("landscape").catch(() => undefined);
}

export function canRequestFullscreen(): boolean {
  const el = document.documentElement as HTMLElement & {
    webkitRequestFullscreen?: () => Promise<void> | void;
  };
  return Boolean(el.requestFullscreen || el.webkitRequestFullscreen);
}

export function toggleFullscreen(): void {
  const doc = document as Document & { webkitExitFullscreen?: () => Promise<void> | void };
  const el = document.documentElement as HTMLElement & {
    webkitRequestFullscreen?: () => Promise<void> | void;
  };
  if (doc.fullscreenElement) {
    void doc.exitFullscreen?.();
    return;
  }
  if (el.requestFullscreen) {
    void el.requestFullscreen().catch(() => undefined);
    return;
  }
  el.webkitRequestFullscreen?.();
}

export function isFullscreen(): boolean {
  return Boolean(document.fullscreenElement);
}
