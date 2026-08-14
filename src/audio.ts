/** Unique menu BGM instance. Change src / volume / loop here. */
export const MENU_MUSIC = {
  src: "/menu_music.m4a",
  volume: 0.32,
  loop: true,
} as const;

/** localStorage key for menu mute. `"1"` = muted, anything else = audible. */
export const MENU_MUTE_STORAGE_KEY = "boli-menu-muted";

let track: HTMLAudioElement | null = null;
let wanted = false;
let unlocking = false;
let muted = readMuted();

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

function getTrack(): HTMLAudioElement {
  if (!track) {
    track = new Audio(MENU_MUSIC.src);
    track.loop = MENU_MUSIC.loop;
    track.volume = MENU_MUSIC.volume;
    track.muted = muted;
    track.preload = "auto";
    track.setAttribute("playsinline", "");
  }
  return track;
}

function tryPlay(): void {
  if (!wanted || muted) {
    return;
  }
  const audio = getTrack();
  if (!audio.paused) {
    return;
  }
  const result = audio.play();
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
    if (!wanted || muted) {
      return;
    }
    const result = getTrack().play();
    if (!result) {
      return;
    }
    void result
      .then(() => {
        document.removeEventListener("pointerdown", unlock);
        document.removeEventListener("touchstart", unlock);
        document.removeEventListener("keydown", unlock);
        unlocking = false;
      })
      .catch(() => {
        /* keep waiting for a later gesture */
      });
  };
  document.addEventListener("pointerdown", unlock);
  document.addEventListener("touchstart", unlock, { passive: true });
  document.addEventListener("keydown", unlock);
}

export function isMenuMusicMuted(): boolean {
  return muted;
}

export function setMenuMusicMuted(value: boolean): void {
  muted = value;
  writeMuted(value);
  const audio = getTrack();
  audio.muted = value;
  if (value) {
    audio.pause();
    return;
  }
  tryPlay();
}

export function toggleMenuMusicMuted(): boolean {
  setMenuMusicMuted(!muted);
  return muted;
}

export function playMenuMusic(): void {
  wanted = true;
  const audio = getTrack();
  audio.loop = MENU_MUSIC.loop;
  audio.volume = MENU_MUSIC.volume;
  audio.muted = muted;
  tryPlay();
}

export function stopMenuMusic(): void {
  wanted = false;
  if (!track) {
    return;
  }
  track.pause();
  track.currentTime = 0;
}
