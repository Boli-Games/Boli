const STORAGE_KEY = "boli-profile";
const SENS_STEP = 0.00055;

export type ProfileStats = {
  rounds: number;
  hiderWins: number;
  hunterWins: number;
  missionRounds: number;
};

export type CameraMode = "thirdPerson" | "firstPerson";

export type ProfileData = {
  displayName: string;
  equippedSkin: string;
  unlocked: string[];
  stats: ProfileStats;
  lookSensitivity: number;
  cameraMode: CameraMode;
};

export function parseCameraMode(value: unknown): CameraMode {
  return value === "firstPerson" ? "firstPerson" : "thirdPerson";
}

export type HunterSkin = {
  id: string;
  name: string;
  color: number;
  shade: number;
  hint: string;
};

export const HUNTER_SKINS: HunterSkin[] = [
  { id: "oak", name: "Roble", color: 0x3c342c, shade: 0x5a4c40, hint: "Inicial" },
  { id: "ash", name: "Ceniza", color: 0x6a6560, shade: 0x8a847c, hint: "Jugá 1 partida" },
  { id: "moss", name: "Musgo", color: 0x3d4a38, shade: 0x5a6a52, hint: "Ganá como boli" },
  { id: "clay", name: "Barro", color: 0x6b3d2a, shade: 0x8a5840, hint: "Ganá como boli" },
  { id: "night", name: "Noche", color: 0x1e2430, shade: 0x3a4454, hint: "Completá las 3 misiones" },
  { id: "ember", name: "Brasa", color: 0x5a2a22, shade: 0x7a4034, hint: "Ganá como cazador" },
  { id: "bone", name: "Hueso", color: 0xc4b49a, shade: 0xa89070, hint: "Jugá 5 partidas" },
];

const DEFAULT_UNLOCKED = ["oak"];

export function defaultProfile(): ProfileData {
  return {
    displayName: "Jugador",
    equippedSkin: "oak",
    unlocked: [...DEFAULT_UNLOCKED],
    stats: { rounds: 0, hiderWins: 0, hunterWins: 0, missionRounds: 0 },
    lookSensitivity: 4 * SENS_STEP,
    cameraMode: "thirdPerson",
  };
}

export function loadLocalProfile(): ProfileData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return defaultProfile();
    }
    return sanitizeProfile(JSON.parse(raw) as Partial<ProfileData>);
  } catch {
    return defaultProfile();
  }
}

export function saveLocalProfile(data: ProfileData): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitizeProfile(data)));
}

export function sanitizeProfile(raw: Partial<ProfileData> | null | undefined): ProfileData {
  const base = defaultProfile();
  const stats = raw?.stats;
  const unlocked = new Set(DEFAULT_UNLOCKED);
  for (const id of raw?.unlocked ?? []) {
    if (HUNTER_SKINS.some((skin) => skin.id === id)) {
      unlocked.add(id);
    }
  }
  const equipped =
    raw?.equippedSkin && unlocked.has(raw.equippedSkin) ? raw.equippedSkin : "oak";
  const name = (raw?.displayName ?? base.displayName).trim().slice(0, 18) || base.displayName;
  const look = typeof raw?.lookSensitivity === "number" ? raw.lookSensitivity : base.lookSensitivity;
  return {
    displayName: name,
    equippedSkin: equipped,
    unlocked: [...unlocked],
    stats: {
      rounds: Math.max(0, stats?.rounds ?? 0),
      hiderWins: Math.max(0, stats?.hiderWins ?? 0),
      hunterWins: Math.max(0, stats?.hunterWins ?? 0),
      missionRounds: Math.max(0, stats?.missionRounds ?? 0),
    },
    lookSensitivity: Math.min(0.006, Math.max(0.00055, look)),
    cameraMode: parseCameraMode(raw?.cameraMode ?? base.cameraMode),
  };
}

export function mergeProfiles(local: ProfileData, remote: ProfileData): ProfileData {
  const unlocked = new Set([...local.unlocked, ...remote.unlocked]);
  const equipped = unlocked.has(local.equippedSkin) ? local.equippedSkin : remote.equippedSkin;
  return sanitizeProfile({
    displayName: remote.displayName !== "Jugador" ? remote.displayName : local.displayName,
    equippedSkin: equipped,
    unlocked: [...unlocked],
    stats: {
      rounds: Math.max(local.stats.rounds, remote.stats.rounds),
      hiderWins: Math.max(local.stats.hiderWins, remote.stats.hiderWins),
      hunterWins: Math.max(local.stats.hunterWins, remote.stats.hunterWins),
      missionRounds: Math.max(local.stats.missionRounds, remote.stats.missionRounds),
    },
    lookSensitivity: local.lookSensitivity,
    cameraMode: local.cameraMode,
  });
}

export function skinById(id: string): HunterSkin {
  return HUNTER_SKINS.find((skin) => skin.id === id) ?? HUNTER_SKINS[0];
}

export function sensitivityToSlider(value: number): number {
  return Math.round(value / SENS_STEP);
}

export function sliderToSensitivity(slider: number): number {
  return Math.min(10, Math.max(1, slider)) * SENS_STEP;
}

export type RoundResult = {
  startedAsHunter: boolean;
  hunterWin: boolean;
  missionWin: boolean;
};

export function applyRoundRewards(profile: ProfileData, result: RoundResult): { profile: ProfileData; unlocked: string[] } {
  const next = sanitizeProfile(profile);
  next.stats.rounds += 1;
  if (result.startedAsHunter) {
    if (result.hunterWin) {
      next.stats.hunterWins += 1;
    }
  } else if (!result.hunterWin) {
    next.stats.hiderWins += 1;
  }
  if (result.missionWin) {
    next.stats.missionRounds += 1;
  }

  const fresh: string[] = [];
  const grant = (id: string) => {
    if (!next.unlocked.includes(id)) {
      next.unlocked.push(id);
      fresh.push(id);
    }
  };
  if (next.stats.rounds >= 1) {
    grant("ash");
  }
  if (next.stats.hiderWins >= 1) {
    grant("moss");
    grant("clay");
  }
  if (next.stats.missionRounds >= 1) {
    grant("night");
  }
  if (next.stats.hunterWins >= 1) {
    grant("ember");
  }
  if (next.stats.rounds >= 5) {
    grant("bone");
  }
  return { profile: next, unlocked: fresh };
}
