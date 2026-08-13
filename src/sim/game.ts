import { enterWander, startleCrowd, tickBolis } from "./boliAi";
import { clockAllowsTimerWin, clockTickDelta } from "./debugClock";
import { createHunter, tickHunterAi, tickHunterControlled, type HunterInput } from "./hunter";
import { tickInfiltrator, type InfiltratorInput } from "./infiltrator";
import { RHYTHM, ROUND, VIEW, type Entity, type GameState, type Hunter } from "./types";
import { worldMinuteFromTimeLeft, wrapMinute, WORLD_MINUTES_PER_SECOND } from "./worldClock";
import { createAmmoCrates, createObjectives, createWorld, randomWalkablePoint, sampleHeight } from "./world";

export type CreateGameOpts = {
  hiderIds?: string[];
  hunterId?: string | null;
  rng?: () => number;
};

export type GameTickInput = {
  infiltrators: Record<string, InfiltratorInput>;
  hunters: Record<string, HunterInput>;
};

export function createGame(opts: CreateGameOpts | (() => number) = {}): GameState {
  const resolved: CreateGameOpts = typeof opts === "function" ? { rng: opts } : opts;
  const rng = resolved.rng ?? Math.random;
  const hiderIds = resolved.hiderIds ?? ["local"];
  const hunterId = resolved.hunterId ?? null;
  const world = createWorld();
  const entities: Entity[] = [];
  const total = ROUND.boliCount + hiderIds.length;
  const hiderSlots = new Set<number>();
  while (hiderSlots.size < hiderIds.length && hiderSlots.size < total) {
    hiderSlots.add(Math.floor(rng() * total));
  }
  const remainingHiders = [...hiderIds];

  for (let i = 0; i < total; i++) {
    const layer = rng() < 0.22 ? "roof" : "ground";
    const spawn = randomWalkablePoint(world, rng, layer);
    const controllerId = hiderSlots.has(i) ? remainingHiders.shift() ?? null : null;
    const entity: Entity = {
      id: `e${i}`,
      x: spawn.x,
      y: spawn.y,
      z: sampleHeight(world, spawn.x, spawn.y, spawn.layer),
      vz: 0,
      layer: spawn.layer,
      angle: rng() * Math.PI * 2,
      state: "PAUSE",
      isPlayer: controllerId !== null,
      targetX: spawn.x,
      targetY: spawn.y,
      stateTimer: 0,
      walkTime: rng() * RHYTHM.walkBouncePeriod,
      headPhase: rng() * RHYTHM.headTurnPeriod,
      lookAngle: 0,
      regroupPoiId: null,
      hp: ROUND.hitsToDown,
      downed: false,
      stumbleTtl: 0,
      controllerId,
      isolationTimer: 0,
      crouch: false,
    };
    entity.lookAngle = entity.angle;
    if (!entity.isPlayer) {
      enterWander(world, entity, rng);
    }
    entities.push(entity);
  }

  const hunter = createHunter({ world }, rng);
  hunter.controllerId = hunterId;

  return {
    world,
    entities,
    hunter,
    extraHunters: [],
    objectives: createObjectives(),
    timeLeft: ROUND.duration,
    worldMinute: 0,
    phase: "PLAYING",
    revealTtl: 0,
    shotKick: 0,
    accusationsLeft: ROUND.shells,
    shotEvent: null,
    promotedControllerId: null,
    clock: 0,
    ammoCrates: createAmmoCrates(),
    isolationTimer: 0,
    herdPulseCooldown: RHYTHM.herdPulseInterval,
    behaviorCheck: null,
    behaviorCheckCooldown: 68,
    regroup: {
      poiId: null,
      cooldown: 4,
    },
  };
}

export function tickGame(
  state: GameState,
  input: GameTickInput,
  dt: number,
  rng: () => number = Math.random,
): void {
  if (state.revealTtl > 0) {
    state.revealTtl = Math.max(0, state.revealTtl - dt);
  }
  if (state.shotKick > 0) {
    state.shotKick = Math.max(0, state.shotKick - dt * 4.5);
  }
  if (state.shotEvent) {
    state.shotEvent.ttl -= dt;
    if (state.shotEvent.ttl <= 0) {
      state.shotEvent = null;
    }
  }

  if (state.phase !== "PLAYING") {
    return;
  }

  state.clock += dt;
  tickBolis(state, dt, rng);

  tickHunterUnit(state, state.hunter, input.hunters, dt, rng);
  for (const extra of state.extraHunters) {
    tickHunterUnit(state, extra, input.hunters, dt, rng);
  }

  for (const entity of hiderEntities(state)) {
    const local = input.infiltrators[entity.controllerId ?? ""];
    if (!local) {
      continue;
    }
    tickInfiltrator(state, entity, local, dt);
  }

  tickMission(state, dt);
  tickIsolation(state, dt);
  tickAmmoPickups(state);

  const dtClock = clockTickDelta(dt);
  state.timeLeft -= dtClock;
  state.worldMinute = wrapMinute((state.worldMinute ?? 0) + dtClock * WORLD_MINUTES_PER_SECOND);
  if (state.timeLeft <= 0) {
    state.timeLeft = 0;
    if (clockAllowsTimerWin()) {
      state.phase = "INFILTRATOR_WIN";
    }
  }
}

function tickHunterUnit(
  state: GameState,
  hunter: Hunter,
  hunters: Record<string, HunterInput>,
  dt: number,
  rng: () => number,
): void {
  const control = hunterControl(hunter, hunters);
  if (control) {
    tickHunterControlled(hunter, state, control, dt);
    return;
  }
  tickHunterAi(hunter, state, dt, rng);
}

function hunterControl(hunter: Hunter, hunters: Record<string, HunterInput>): HunterInput | null {
  if (hunter.controllerId && hunters[hunter.controllerId]) {
    return hunters[hunter.controllerId];
  }
  if (!hunter.controllerId && hunters.local) {
    return hunters.local;
  }
  return null;
}

function tickMission(state: GameState, dt: number): void {
  const hiders = hiderEntities(state);
  if (hiders.length === 0) {
    return;
  }
  for (const objective of state.objectives) {
    if (objective.done) {
      continue;
    }
    const near = hiders.some(
      (player) =>
        Math.hypot(player.x - objective.x, player.y - objective.y) <= objective.radius &&
        Math.abs(player.z - objective.z) < 8,
    );
    if (!near) {
      objective.hold = 0;
      continue;
    }
    objective.hold += dt;
    if (objective.hold >= RHYTHM.objectiveHold) {
      objective.done = true;
    }
  }
  if (state.objectives.every((objective) => objective.done)) {
    state.phase = "INFILTRATOR_WIN";
  }
}

function tickIsolation(state: GameState, dt: number): void {
  for (const player of hiderEntities(state)) {
    if (onActiveObjective(state, player)) {
      player.isolationTimer = Math.max(0, player.isolationTimer - dt * 2);
      continue;
    }
    let nearest = Infinity;
    for (const entity of state.entities) {
      if (entity.isPlayer || entity.downed || entity.id === player.id) {
        continue;
      }
      nearest = Math.min(nearest, Math.hypot(entity.x - player.x, entity.y - player.y));
    }
    if (nearest > RHYTHM.isolationRadius) {
      player.isolationTimer += dt;
    } else {
      player.isolationTimer = Math.max(0, player.isolationTimer - dt);
    }
    if (player.isolationTimer >= RHYTHM.isolationStumble) {
      player.stumbleTtl = Math.max(player.stumbleTtl, 0.45);
    }
  }
}

function onActiveObjective(state: GameState, player: Entity): boolean {
  return state.objectives.some((objective) => {
    if (objective.done) {
      return false;
    }
    return (
      Math.hypot(player.x - objective.x, player.y - objective.y) <= objective.radius + 8 &&
      Math.abs(player.z - objective.z) < 10
    );
  });
}

function tickAmmoPickups(state: GameState): void {
  for (const hunter of allHunters(state)) {
    for (const crate of state.ammoCrates) {
      if (crate.taken) {
        continue;
      }
      const near =
        Math.hypot(hunter.x - crate.x, hunter.y - crate.y) < RHYTHM.ammoPickupRadius &&
        Math.abs(hunter.z - crate.z) < 14;
      if (!near) {
        continue;
      }
      crate.taken = true;
      state.accusationsLeft = Math.min(ROUND.maxShells, state.accusationsLeft + ROUND.pickupAmount);
    }
  }
}

function addHunterHp(state: GameState, hunter: Hunter, delta: number): void {
  hunter.hp = Math.max(0, hunter.hp + delta);
  if (hunterTeamDown(state)) {
    state.phase = "INFILTRATOR_WIN";
  }
}

function hunterTeamDown(state: GameState): boolean {
  const humans = allHunters(state).filter((hunter) => hunter.controllerId);
  if (humans.length === 0) {
    return state.hunter.hp <= 0;
  }
  return humans.every((hunter) => hunter.hp <= 0);
}

export function fireAtEntity(state: GameState, target: Entity | null, hunter: Hunter = state.hunter): void {
  if (state.phase !== "PLAYING") {
    return;
  }
  if (state.accusationsLeft <= 0 || hunter.hp <= 0) {
    return;
  }

  state.accusationsLeft -= 1;
  state.shotKick = 1;
  const range = ROUND.shotRange;
  const look = Math.cos(hunter.pitch);
  const eye = hunter.z + (hunter.crouch ? VIEW.crouchEyeHeight : VIEW.eyeHeight);
  const hitX = target && !target.downed ? target.x : hunter.x + Math.cos(hunter.angle) * look * range;
  const hitY = target && !target.downed ? target.y : hunter.y + Math.sin(hunter.angle) * look * range;
  const hitZ = target && !target.downed ? target.z + 8 : eye + Math.sin(hunter.pitch) * range;
  state.shotEvent = {
    id: (state.shotEvent?.id ?? 0) + 1,
    x: hunter.x,
    y: hunter.y,
    z: eye,
    yaw: hunter.angle,
    pitch: hunter.pitch,
    hitX,
    hitY,
    hitZ,
    hit: Boolean(target && !target.downed),
    ttl: 0.55,
  };
  startleCrowd(state, hunter.x, hunter.y);

  if (!target || target.downed) {
    return;
  }

  target.hp -= 1;

  if (!target.isPlayer) {
    addHunterHp(state, hunter, -ROUND.npcHitPenalty);
    if (target.hp <= 0) {
      target.downed = true;
      addHunterHp(state, hunter, -ROUND.npcDownPenalty);
    }
    return;
  }

  if (target.hp > 0) {
    return;
  }

  const controllerId = target.controllerId;
  target.downed = true;
  target.isPlayer = false;
  target.controllerId = null;
  state.accusationsLeft = Math.min(ROUND.maxShells, state.accusationsLeft + ROUND.hiderKillShells);

  const keepOriginal = Boolean(state.hunter.controllerId);
  if (keepOriginal) {
    const extra = createHunter(state, Math.random, {
      x: target.x,
      y: target.y,
      z: target.z,
      layer: target.layer,
    });
    extra.controllerId = controllerId;
    extra.hp = ROUND.hunterHp;
    state.extraHunters.push(extra);
  } else {
    state.extraHunters.push({ ...state.hunter });
    state.hunter = createHunter(state, Math.random, {
      x: target.x,
      y: target.y,
      z: target.z,
      layer: target.layer,
    });
    state.hunter.controllerId = controllerId;
    state.accusationsLeft = ROUND.shells;
  }

  state.promotedControllerId = controllerId;
  if (!state.entities.some((entity) => entity.isPlayer && !entity.downed)) {
    state.phase = "HUNTER_WIN";
  }
}

export function revealInfiltrator(state: GameState): void {
  state.revealTtl = ROUND.revealSeconds;
}

export function playerEntity(state: GameState, localId = "local"): Entity | undefined {
  return state.entities.find((entity) => entity.controllerId === localId && !entity.downed);
}

export function hiderEntities(state: GameState): Entity[] {
  return state.entities.filter((entity) => entity.isPlayer && !entity.downed);
}

export function allHunters(state: GameState): Hunter[] {
  return [state.hunter, ...state.extraHunters];
}

export function hunterForController(state: GameState, localId: string): { hunter: Hunter; index: number } | null {
  if (state.hunter.controllerId === localId) {
    return { hunter: state.hunter, index: 0 };
  }
  const extraIndex = state.extraHunters.findIndex((hunter) => hunter.controllerId === localId);
  if (extraIndex >= 0) {
    return { hunter: state.extraHunters[extraIndex], index: extraIndex + 1 };
  }
  return null;
}

export function missionSummary(state: GameState): { done: number; total: number; next: string } {
  const done = state.objectives.filter((objective) => objective.done).length;
  const next = state.objectives.find((objective) => !objective.done)?.label ?? "completa";
  return { done, total: state.objectives.length, next };
}

export function snapshotOf(state: GameState): Omit<GameState, "world"> {
  return JSON.parse(JSON.stringify({ ...state, world: undefined })) as Omit<GameState, "world">;
}

export function applySnapshot(
  state: GameState,
  snapshot: Omit<GameState, "world">,
  localId?: string,
): void {
  const keptHunter = localId ? hunterForController(state, localId)?.hunter : null;
  const keptHunterCopy = keptHunter ? { ...keptHunter } : null;
  const keptEntity = localId ? playerEntity(state, localId) : null;
  const keptEntityCopy = keptEntity ? { ...keptEntity } : null;
  const world = state.world;
  Object.assign(state, snapshot);
  state.world = world;
  if (typeof state.worldMinute !== "number") {
    state.worldMinute = worldMinuteFromTimeLeft(state.timeLeft);
  }
  if (keptHunterCopy && localId) {
    const next = hunterForController(state, localId);
    if (next) {
      keepPredictedPose(next.hunter, keptHunterCopy);
    }
  }
  if (keptEntityCopy) {
    const next = state.entities.find((entity) => entity.id === keptEntityCopy.id);
    if (next) {
      keepPredictedPose(next, keptEntityCopy);
    }
  }
}

export function tickLocalPrediction(
  state: GameState,
  localId: string,
  input: InfiltratorInput & HunterInput,
  dt: number,
): void {
  if (state.phase !== "PLAYING") {
    return;
  }
  const found = hunterForController(state, localId);
  if (found) {
    tickHunterControlled(found.hunter, state, input, dt);
    return;
  }
  const player = playerEntity(state, localId);
  if (player) {
    tickInfiltrator(state, player, input, dt);
  }
}

function keepPredictedPose(
  server: {
    x: number;
    y: number;
    z: number;
    vz: number;
    layer: Hunter["layer"];
    walkTime: number;
    state: Hunter["state"];
    crouch: boolean;
  },
  predicted: {
    x: number;
    y: number;
    z: number;
    vz: number;
    layer: Hunter["layer"];
    walkTime: number;
    state: Hunter["state"];
    crouch: boolean;
  },
): void {
  const err = Math.hypot(server.x - predicted.x, server.y - predicted.y);
  if (err > 28) {
    return;
  }
  server.x = predicted.x;
  server.y = predicted.y;
  server.z = predicted.z;
  server.vz = predicted.vz;
  server.layer = predicted.layer;
  server.walkTime = predicted.walkTime;
  server.state = predicted.state;
  server.crouch = predicted.crouch;
}
