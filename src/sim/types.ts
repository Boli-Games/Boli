export type BoliState = "WANDER" | "PAUSE" | "REGROUP" | "REACT";

export type BehaviorCheckKind = "fountain" | "sit" | "house";

export type WalkLayer = "ground" | "roof";

export type RoundPhase = "PLAYING" | "HUNTER_WIN" | "INFILTRATOR_WIN";

export type ControlRole = "INFILTRATOR" | "HUNTER";

export type Rect = {
  x: number;
  y: number;
  w: number;
  h: number;
};

export type Ramp = {
  x: number;
  y: number;
  w: number;
  h: number;
  z0: number;
  z1: number;
  along: "x" | "y";
};

export type Roof = {
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
};

export type House = {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  wall: number;
  roofZ: number;
  walls: Rect[];
  ramp: Ramp;
  color: number;
};

export type Poi = {
  id: string;
  x: number;
  y: number;
  radius: number;
  kind: "fountain" | "statue" | "plaza";
};

export type Objective = {
  id: string;
  x: number;
  y: number;
  z: number;
  radius: number;
  label: string;
  done: boolean;
  hold: number;
};

export type Entity = {
  id: string;
  x: number;
  y: number;
  z: number;
  vz: number;
  layer: WalkLayer;
  angle: number;
  state: BoliState;
  isPlayer: boolean;
  targetX: number;
  targetY: number;
  stateTimer: number;
  walkTime: number;
  headPhase: number;
  lookAngle: number;
  regroupPoiId: string | null;
  hp: number;
  downed: boolean;
  stumbleTtl: number;
  controllerId: string | null;
  isolationTimer: number;
  crouch: boolean;
};

export type Hunter = {
  x: number;
  y: number;
  z: number;
  vz: number;
  layer: WalkLayer;
  angle: number;
  pitch: number;
  targetX: number;
  targetY: number;
  state: BoliState;
  stateTimer: number;
  walkTime: number;
  lookAngle: number;
  hp: number;
  controllerId: string | null;
  crouch: boolean;
};

export type AmmoCrate = {
  id: string;
  x: number;
  y: number;
  z: number;
  taken: boolean;
};

export type BehaviorCheck = {
  kind: BehaviorCheckKind;
  ttl: number;
  x: number;
  y: number;
  radius: number;
  banner: string;
};

export type World = {
  width: number;
  height: number;
  pois: Poi[];
  obstacles: Rect[];
  cover: Rect[];
  ramps: Ramp[];
  roofs: Roof[];
  houses: House[];
};

export type ShotEvent = {
  id: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  hitX: number;
  hitY: number;
  hitZ: number;
  hit: boolean;
  ttl: number;
};

export type GameState = {
  world: World;
  entities: Entity[];
  hunter: Hunter;
  extraHunters: Hunter[];
  objectives: Objective[];
  timeLeft: number;
  /** Minutes past midnight (0–1440). Drives sun/moon; stays in sync with timeLeft. */
  worldMinute: number;
  phase: RoundPhase;
  revealTtl: number;
  shotKick: number;
  accusationsLeft: number;
  shotEvent: ShotEvent | null;
  promotedControllerId: string | null;
  clock: number;
  ammoCrates: AmmoCrate[];
  isolationTimer: number;
  herdPulseCooldown: number;
  behaviorCheck: BehaviorCheck | null;
  behaviorCheckCooldown: number;
  regroup: {
    poiId: string | null;
    cooldown: number;
  };
};

/** Ritmo compartido: un solo lugar para tunear. */
export const RHYTHM = {
  speed: 24,
  sprintMul: 1.55,
  crouchMul: 0.55,
  radius: 5.5,
  pauseMin: 1.2,
  pauseMax: 2.0,
  wanderArriveSlack: 6,
  walkBouncePeriod: 0.35,
  walkBounceAmp: 0.9,
  headTurnPeriod: 2.4,
  headTurnAmp: 0.45,
  lookAroundChance: 0.55,
  regroupChanceOnPauseEnd: 0.12,
  regroupIntervalMin: 10,
  regroupIntervalMax: 16,
  regroupGroupMin: 5,
  regroupGroupMax: 9,
  regroupHold: 2.4,
  regroupScatterRadius: 28,
  reactLook: 0.55,
  reactRadius: 92,
  objectiveHold: 1.15,
  gravity: 120,
  fallControl: 0.85,
  isolationRadius: 90,
  isolationStumble: 20,
  herdPulseInterval: 60,
  herdPulseGroupMin: 16,
  behaviorCheckDuration: 20,
  behaviorCheckMin: 60,
  behaviorCheckMax: 90,
  ammoPickupRadius: 14,
} as const;

export const ROUND = {
  duration: 600,
  boliCount: 28,
  revealSeconds: 1,
  shells: 8,
  maxShells: 12,
  pickupAmount: 2,
  hiderKillShells: 3,
  hunterHp: 100,
  npcHitPenalty: 20,
  npcDownPenalty: 30,
  hitsToDown: 3,
  shotRange: 72,
  maxPlayers: 8,
} as const;

export const VIEW = {
  eyeHeight: 15,
  crouchEyeHeight: 8.2,
  bodyHeight: 16,
  lookSensitivity: 0.0022,
} as const;

export function locomotionSpeed(opts: { sprint: boolean; crouch: boolean; blend?: boolean }): number {
  if (opts.blend) {
    return RHYTHM.speed;
  }
  if (opts.crouch) {
    return RHYTHM.speed * RHYTHM.crouchMul;
  }
  if (opts.sprint) {
    return RHYTHM.speed * RHYTHM.sprintMul;
  }
  return RHYTHM.speed;
}
