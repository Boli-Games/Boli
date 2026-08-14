/** Unique menu BGM instance. Change src / volume / loop here. */
export const MENU_MUSIC = {
  src: "/menu_music.m4a",
  volume: 0.32,
  loop: true,
} as const;

/**
 * Gameplay music cues. Add entries here, then call `playMusic(id)` from a
 * local game-event edge. Nothing in this module talks to the network.
 */
export type GameMusicId = "behavior_check";

export type MusicRetrigger = "keep" | "restart" | "replace";

export const GAME_MUSIC = {
  behavior_check: {
    src: "/event_audio.m4a",
    /** File peaks at −1.4 dBFS; stay well below menu (0.32) so SFX stay readable. */
    volume: 0.15,
    /** Clipchamp AAC one-shot (~31s) that ends in silence — not a seamless loop. */
    loop: false,
    fadeInMs: 320,
    fadeOutMs: 420,
    onRetrigger: "keep" as MusicRetrigger,
  },
} as const satisfies Record<
  GameMusicId,
  {
    src: string;
    volume: number;
    loop: boolean;
    fadeInMs: number;
    fadeOutMs: number;
    onRetrigger: MusicRetrigger;
  }
>;

/** localStorage key for the shared mute. `"1"` = muted, anything else = audible. */
export const MENU_MUTE_STORAGE_KEY = "boli-menu-muted";

type GameSlot = {
  id: GameMusicId;
  el: HTMLAudioElement;
  wanted: boolean;
  fadingOut: boolean;
  fadeRaf: number;
  fadeGen: number;
};

let menuTrack: HTMLAudioElement | null = null;
let menuWanted = false;
let unlocking = false;
let muted = readMuted();
const gameSlots = new Map<GameMusicId, GameSlot>();

function readMuted(): boolean {
  try {
    return localStorage.getItem(MENU_MUTE_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeMuted(value: boolean): void {
  try {
    localStorage.setItem(MENU_MUTE_STORAGE_KEY, value ? "1" : "0");
  } catch {
    /* private mode / quota */
  }
}

function getMenuTrack(): HTMLAudioElement {
  if (!menuTrack) {
    menuTrack = new Audio(MENU_MUSIC.src);
    menuTrack.loop = MENU_MUSIC.loop;
    menuTrack.volume = MENU_MUSIC.volume;
    menuTrack.muted = muted;
    menuTrack.preload = "auto";
    menuTrack.setAttribute("playsinline", "");
  }
  return menuTrack;
}

function getGameSlot(id: GameMusicId): GameSlot {
  let slot = gameSlots.get(id);
  if (slot) {
    return slot;
  }
  const cue = GAME_MUSIC[id];
  const el = new Audio(cue.src);
  el.loop = cue.loop;
  el.preload = "auto";
  el.volume = 0;
  el.muted = muted;
  el.setAttribute("playsinline", "");
  slot = { id, el, wanted: false, fadingOut: false, fadeRaf: 0, fadeGen: 0 };
  gameSlots.set(id, slot);
  return slot;
}

function tryPlayMenu(): void {
  if (!menuWanted || muted) {
    return;
  }
  const audio = getMenuTrack();
  if (!audio.paused) {
    return;
  }
  catchPlay(audio.play());
}

function tryPlayGame(slot: GameSlot): void {
  if (!slot.wanted || muted || slot.fadingOut) {
    return;
  }
  if (!slot.el.paused) {
    return;
  }
  catchPlay(slot.el.play());
}

function catchPlay(result: Promise<void> | undefined): void {
  if (result) {
    void result.catch(() => bindUnlock());
  }
}

function bindUnlock(): void {
  if (unlocking) {
    return;
  }
  unlocking = true;
  const unlock = () => {
    if (muted) {
      return;
    }
    const pending: Promise<void>[] = [];
    if (menuWanted) {
      const result = getMenuTrack().play();
      if (result) {
        pending.push(result);
      }
    }
    for (const slot of gameSlots.values()) {
      if (!slot.wanted || slot.fadingOut) {
        continue;
      }
      const result = slot.el.play();
      if (result) {
        pending.push(result);
      }
    }
    if (pending.length === 0) {
      return;
    }
    void Promise.allSettled(pending).then((results) => {
      if (results.some((entry) => entry.status === "rejected")) {
        return;
      }
      document.removeEventListener("pointerdown", unlock);
      document.removeEventListener("keydown", unlock);
      unlocking = false;
    });
  };
  document.addEventListener("pointerdown", unlock);
  document.addEventListener("keydown", unlock);
}

function cancelFade(slot: GameSlot): void {
  if (slot.fadeRaf) {
    cancelAnimationFrame(slot.fadeRaf);
    slot.fadeRaf = 0;
  }
  slot.fadeGen += 1;
}

function fadeVolume(slot: GameSlot, to: number, ms: number, onDone?: () => void): void {
  cancelFade(slot);
  const from = slot.el.volume;
  if (ms <= 0 || Math.abs(from - to) < 0.004) {
    slot.el.volume = to;
    onDone?.();
    return;
  }
  const gen = slot.fadeGen;
  const start = performance.now();
  const step = (now: number) => {
    if (gen !== slot.fadeGen) {
      return;
    }
    const t = Math.min(1, (now - start) / ms);
    slot.el.volume = from + (to - from) * t;
    if (t < 1) {
      slot.fadeRaf = requestAnimationFrame(step);
      return;
    }
    slot.fadeRaf = 0;
    slot.el.volume = to;
    onDone?.();
  };
  slot.fadeRaf = requestAnimationFrame(step);
}

function haltGameSlot(slot: GameSlot): void {
  cancelFade(slot);
  slot.wanted = false;
  slot.fadingOut = false;
  slot.el.pause();
  slot.el.currentTime = 0;
  slot.el.volume = 0;
}

function applyMuteToGame(): void {
  for (const slot of gameSlots.values()) {
    slot.el.muted = muted;
    if (muted) {
      cancelFade(slot);
      slot.el.pause();
      continue;
    }
    if (slot.wanted && !slot.fadingOut) {
      slot.el.volume = GAME_MUSIC[slot.id].volume;
      tryPlayGame(slot);
    }
  }
}

export function isMenuMusicMuted(): boolean {
  return muted;
}

export function isAudioMuted(): boolean {
  return muted;
}

export function setMenuMusicMuted(value: boolean): void {
  muted = value;
  writeMuted(value);
  const audio = getMenuTrack();
  audio.muted = value;
  applyMuteToGame();
  if (value) {
    audio.pause();
    return;
  }
  tryPlayMenu();
}

export function toggleMenuMusicMuted(): boolean {
  setMenuMusicMuted(!muted);
  return muted;
}

export function playMenuMusic(): void {
  menuWanted = true;
  const audio = getMenuTrack();
  audio.loop = MENU_MUSIC.loop;
  audio.volume = MENU_MUSIC.volume;
  audio.muted = muted;
  tryPlayMenu();
}

export function stopMenuMusic(): void {
  menuWanted = false;
  if (!menuTrack) {
    return;
  }
  menuTrack.pause();
  menuTrack.currentTime = 0;
}

/** Create and start buffering every gameplay cue. Safe to call more than once. */
export function preloadGameMusic(): void {
  for (const id of Object.keys(GAME_MUSIC) as GameMusicId[]) {
    const slot = getGameSlot(id);
    slot.el.load();
  }
}

/**
 * Play a gameplay cue. Retrigger policy lives on the cue:
 * `keep` ignores repeats, `restart` seeks to 0, `replace` is for a later mixer.
 */
export function playMusic(id: GameMusicId): void {
  const cue = GAME_MUSIC[id];
  const slot = getGameSlot(id);
  const active = slot.wanted && !slot.fadingOut;
  if (active && cue.onRetrigger === "keep") {
    return;
  }
  if (active && cue.onRetrigger === "restart") {
    slot.el.currentTime = 0;
    return;
  }

  slot.wanted = true;
  slot.fadingOut = false;
  slot.el.loop = cue.loop;
  slot.el.muted = muted;
  if (cue.onRetrigger === "restart" || slot.el.paused) {
    slot.el.currentTime = 0;
  }
  if (muted) {
    cancelFade(slot);
    slot.el.volume = 0;
    return;
  }
  slot.el.volume = 0;
  tryPlayGame(slot);
  fadeVolume(slot, cue.volume, cue.fadeInMs);
}

export function stopMusic(id: GameMusicId, opts?: { immediate?: boolean }): void {
  const slot = gameSlots.get(id);
  if (!slot) {
    return;
  }
  if (!slot.wanted && (slot.fadingOut || slot.el.paused)) {
    if (opts?.immediate) {
      haltGameSlot(slot);
    }
    return;
  }
  slot.wanted = false;
  if (opts?.immediate || muted) {
    haltGameSlot(slot);
    return;
  }
  slot.fadingOut = true;
  fadeVolume(slot, 0, GAME_MUSIC[id].fadeOutMs, () => {
    if (slot.wanted) {
      return;
    }
    haltGameSlot(slot);
  });
}

export function stopAllGameMusic(opts?: { immediate?: boolean }): void {
  for (const id of Object.keys(GAME_MUSIC) as GameMusicId[]) {
    stopMusic(id, opts);
  }
}
