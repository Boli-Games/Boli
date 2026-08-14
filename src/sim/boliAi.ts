import { angleTo, applyVertical, assignPose, moveToward, readPose } from "./physics";
import {
  RHYTHM,
  type BehaviorCheck,
  type BehaviorCheckKind,
  type Entity,
  type GameState,
  type Poi,
  type World,
} from "./types";
import { isWalkable, poiById, randInt, randRange, randomCrowdPoint, clamp } from "./world";

let stuckDebug = false;

export function setStuckDebug(enabled: boolean): void {
  stuckDebug = enabled;
}

export function isStuckDebug(): boolean {
  return stuckDebug;
}

export type BoliStuckInfo = {
  id: string;
  state: Entity["state"];
  stuckTimer: number;
  dist: number;
  moved: number;
  speed: number;
  expected: number;
  toward: number;
  useful: number;
  recover: number;
  keepGoal: boolean;
};

export function boliStuckInfo(entity: Entity, checkActive = false): BoliStuckInfo {
  return {
    id: entity.id,
    state: entity.state,
    stuckTimer: entity.stuckTimer ?? 0,
    dist: Math.hypot(entity.targetX - entity.x, entity.targetY - entity.y),
    moved: Math.hypot(entity.x - (entity.stuckX ?? entity.x), entity.y - (entity.stuckY ?? entity.y)),
    speed: entity.stuckSpeed ?? 0,
    expected: RHYTHM.speed,
    toward: entity.stuckToward ?? 0,
    useful: entity.stuckUseful ?? 0,
    recover: entity.stuckRecoverTtl ?? 0,
    keepGoal: checkActive || Boolean(entity.regroupPoiId && !entity.regroupPoiId.startsWith("check-")),
  };
}

export function tickBolis(state: GameState, dt: number, rng: () => number): void {
  tickCrowdEvents(state, dt, rng);

  for (const entity of state.entities) {
    if (entity.isPlayer || entity.downed) {
      continue;
    }
    entity.walkTime = state.clock;
    entity.headPhase = state.clock;
    ensureStuckFields(entity);
    tickBoli(state, entity, dt, rng);
    assignPose(entity, applyVertical(state.world, readPose(entity), dt));
  }
}

export function startleCrowd(state: GameState, x: number, y: number): void {
  for (const entity of state.entities) {
    if (entity.isPlayer || entity.downed || entity.state === "DANCE") {
      continue;
    }
    const dist = Math.hypot(entity.x - x, entity.y - y);
    if (dist > RHYTHM.reactRadius) {
      continue;
    }
    enterReact(entity, x, y);
  }
}

function tickCrowdEvents(state: GameState, dt: number, rng: () => number): void {
  tickBehaviorCheck(state, dt, rng);
  tickHerdPulse(state, dt, rng);
  tickRegroupDirector(state, dt, rng);
}

function tickBehaviorCheck(state: GameState, dt: number, rng: () => number): void {
  if (state.behaviorCheck) {
    state.behaviorCheck.ttl -= dt;
    if (state.behaviorCheck.ttl <= 0) {
      state.behaviorCheck = null;
      state.behaviorCheckCooldown = randRange(rng, RHYTHM.behaviorCheckMin, RHYTHM.behaviorCheckMax);
    }
    return;
  }

  state.behaviorCheckCooldown -= dt;
  if (state.behaviorCheckCooldown > 0) {
    return;
  }
  startBehaviorCheck(state, rng);
}

function startBehaviorCheck(state: GameState, rng: () => number): void {
  applyBehaviorCheck(state, pickBehaviorCheck(state, rng), rng);
}

/** Localhost debug helper: force a crowd check without waiting for the cooldown. */
export function debugForceBehaviorCheck(
  state: GameState,
  rng: () => number,
  kind: BehaviorCheckKind,
): void {
  applyBehaviorCheck(state, pickBehaviorCheck(state, rng, kind), rng);
}

function applyBehaviorCheck(state: GameState, check: BehaviorCheck, rng: () => number): void {
  state.behaviorCheck = check;
  for (const entity of state.entities) {
    if (entity.isPlayer || entity.downed) {
      continue;
    }
    sendToCheck(state, entity, check, rng);
  }
}

function pickBehaviorCheck(
  state: GameState,
  rng: () => number,
  kind?: BehaviorCheckKind,
): BehaviorCheck {
  const roll = kind ? -1 : rng();
  const ttl = RHYTHM.behaviorCheckDuration;
  if (kind === "fountain" || (kind === undefined && roll < 0.34)) {
    const fountain = poiById(state.world, "fountain") ?? state.world.pois[0];
    return {
      kind: "fountain",
      ttl,
      x: fountain.x,
      y: fountain.y,
      radius: 48,
      banner: "los bolis van a la fuente",
    };
  }
  if (kind === "sit" || (kind === undefined && roll < 0.67)) {
    const plaza = poiById(state.world, "plaza") ?? state.world.pois[0];
    return {
      kind: "sit",
      ttl,
      x: plaza.x,
      y: plaza.y,
      radius: 46,
      banner: "los bolis se detienen",
    };
  }
  return {
    kind: "house",
    ttl,
    x: 146,
    y: 100,
    radius: 42,
    banner: "los bolis entran a la casa chica",
  };
}

function sendToCheck(state: GameState, entity: Entity, check: BehaviorCheck, rng: () => number): void {
  if (entity.state === "DANCE") {
    return;
  }
  const offset = randRange(rng, 0, Math.PI * 2);
  const dist = randRange(rng, 6, Math.max(10, check.radius * 0.55));
  let targetX = check.x + Math.cos(offset) * dist;
  let targetY = check.y + Math.sin(offset) * dist;
  if (!isWalkable(state.world, targetX, targetY, entity.layer === "roof" ? "ground" : entity.layer)) {
    targetX = check.x;
    targetY = check.y;
  }
  entity.state = "REGROUP";
  entity.regroupPoiId = `check-${check.kind}`;
  entity.stateTimer = check.ttl;
  entity.targetX = targetX;
  entity.targetY = targetY;
  entity.stuckRetries = 0;
  entity.stuckRecoverTtl = 0;
  resetStuck(entity);
}

function tickHerdPulse(state: GameState, dt: number, rng: () => number): void {
  if (state.behaviorCheck) {
    return;
  }
  state.herdPulseCooldown -= dt;
  if (state.herdPulseCooldown > 0) {
    return;
  }
  state.herdPulseCooldown = RHYTHM.herdPulseInterval;
  const poi = state.world.pois[Math.floor(rng() * state.world.pois.length)];
  if (!poi) {
    return;
  }
  const bolis = state.entities.filter(
    (entity) => !entity.isPlayer && !entity.downed && entity.layer === "ground",
  );
  shuffleInPlace(bolis, rng);
  const count = Math.min(bolis.length, Math.max(RHYTHM.herdPulseGroupMin, Math.floor(bolis.length * 0.7)));
  for (let i = 0; i < count; i++) {
    startRegroup(state, bolis[i], poi, rng);
  }
  state.regroup.poiId = poi.id;
}

function tickRegroupDirector(state: GameState, dt: number, rng: () => number): void {
  if (state.behaviorCheck) {
    return;
  }
  state.regroup.cooldown -= dt;
  if (state.regroup.poiId) {
    const stillGoing = state.entities.some(
      (entity) => !entity.isPlayer && !entity.downed && entity.state === "REGROUP",
    );
    if (!stillGoing) {
      state.regroup.poiId = null;
      state.regroup.cooldown = randRange(
        rng,
        RHYTHM.regroupIntervalMin,
        RHYTHM.regroupIntervalMax,
      );
    }
    return;
  }

  if (state.regroup.cooldown > 0) {
    return;
  }

  const poi = state.world.pois[Math.floor(rng() * state.world.pois.length)];
  if (!poi) {
    return;
  }

  const bolis = state.entities.filter((entity) => !entity.isPlayer && !entity.downed && entity.layer === "ground");
  const count = Math.min(
    bolis.length,
    randInt(rng, RHYTHM.regroupGroupMin, RHYTHM.regroupGroupMax),
  );
  shuffleInPlace(bolis, rng);
  for (let i = 0; i < count; i++) {
    startRegroup(state, bolis[i], poi, rng);
  }
  state.regroup.poiId = poi.id;
}

function tickBoli(state: GameState, entity: Entity, dt: number, rng: () => number): void {
  if (entity.stuckRecoverTtl > 0) {
    tickStuckRecover(state, entity, dt, rng);
    return;
  }

  if (entity.state === "DANCE") {
    tickDance(state, entity, dt, rng);
    return;
  }

  if (state.behaviorCheck && entity.state !== "REACT") {
    tickCheckFollow(state, entity, dt, rng);
    return;
  }

  switch (entity.state) {
    case "WANDER":
      tickWander(state, entity, dt, rng);
      break;
    case "PAUSE":
      tickPause(state, entity, dt, rng);
      break;
    case "REGROUP":
      tickRegroup(state, entity, dt, rng);
      break;
    case "REACT":
      tickReact(entity, dt);
      break;
  }
}

function tickCheckFollow(state: GameState, entity: Entity, dt: number, rng: () => number): void {
  if (!hasArrived(entity)) {
    entity.state = "REGROUP";
    if (stepWalk(state, entity, dt)) {
      recoverFromStuck(state, entity, rng);
    }
    return;
  }
  resetStuck(entity);
  enterDance(entity, rng);
}

function tickWander(state: GameState, entity: Entity, dt: number, rng: () => number): void {
  if (stepWalk(state, entity, dt)) {
    recoverFromStuck(state, entity, rng);
    return;
  }
  entity.stateTimer -= dt;
  if (hasArrived(entity)) {
    enterDance(entity, rng);
    return;
  }
  if (entity.stateTimer <= 0) {
    enterPause(entity, rng);
  }
}

function tickPause(state: GameState, entity: Entity, dt: number, rng: () => number): void {
  entity.stateTimer -= dt;
  applyIdleLook(entity);

  if (entity.stateTimer > 0) {
    return;
  }

  if (rng() < RHYTHM.regroupChanceOnPauseEnd && entity.layer === "ground") {
    const poi = pickPoi(state, rng);
    if (poi) {
      startRegroup(state, entity, poi, rng);
      return;
    }
  }

  enterWander(state.world, entity, rng);
}

function tickRegroup(state: GameState, entity: Entity, dt: number, rng: () => number): void {
  if (!hasArrived(entity)) {
    if (stepWalk(state, entity, dt)) {
      recoverFromStuck(state, entity, rng);
    }
    return;
  }

  resetStuck(entity);
  enterDance(entity, rng);
}

function tickReact(entity: Entity, dt: number): void {
  entity.stateTimer -= dt;
  if (entity.stateTimer > 0) {
    return;
  }
  entity.state = "WANDER";
  const dist = Math.hypot(entity.targetX - entity.x, entity.targetY - entity.y);
  entity.stateTimer = dist / RHYTHM.speed + 1.2;
  resetStuck(entity);
}

export function enterWander(world: World, entity: Entity, rng: () => number): void {
  const point = randomCrowdPoint(world, rng, entity.layer);
  entity.state = "WANDER";
  entity.targetX = point.x;
  entity.targetY = point.y;
  const dist = Math.hypot(point.x - entity.x, point.y - entity.y);
  entity.stateTimer = dist / RHYTHM.speed + 2;
  entity.regroupPoiId = null;
  entity.stuckRetries = 0;
  entity.stuckRecoverTtl = 0;
  resetStuck(entity);
}

export function enterPause(entity: Entity, rng: () => number): void {
  entity.state = "PAUSE";
  entity.stateTimer = randRange(rng, RHYTHM.pauseMin, RHYTHM.pauseMax);
  if (rng() < RHYTHM.lookAroundChance) {
    entity.lookAngle += randRange(rng, -1.1, 1.1);
  }
  resetStuck(entity);
}

function enterDance(entity: Entity, rng: () => number): void {
  entity.state = "DANCE";
  entity.stateTimer = randRange(rng, RHYTHM.danceMin, RHYTHM.danceMax);
  entity.stuckRecoverTtl = 0;
  resetStuck(entity);
}

function tickDance(state: GameState, entity: Entity, dt: number, rng: () => number): void {
  entity.stateTimer -= dt;
  applyIdleLook(entity);
  if (entity.stateTimer > 0) {
    return;
  }
  finishDance(state, entity, rng);
}

function finishDance(state: GameState, entity: Entity, rng: () => number): void {
  entity.state = "PAUSE";
  if (state.behaviorCheck) {
    const check = state.behaviorCheck;
    const atCheck =
      Math.hypot(entity.x - check.x, entity.y - check.y) <= check.radius + RHYTHM.wanderArriveSlack;
    if (atCheck) {
      entity.stateTimer = Math.max(0.4, check.ttl);
      applyIdleLook(entity);
      resetStuck(entity);
      return;
    }
    sendToCheck(state, entity, check, rng);
    return;
  }
  entity.regroupPoiId = null;
  enterPause(entity, rng);
}

export function enterReact(entity: Entity, shotX: number, shotY: number): void {
  entity.state = "REACT";
  entity.stateTimer = RHYTHM.reactLook;
  entity.lookAngle = angleTo(entity.x, entity.y, shotX, shotY);
  entity.angle = entity.lookAngle;
  const away = angleTo(shotX, shotY, entity.x, entity.y);
  entity.targetX = entity.x + Math.cos(away) * 36;
  entity.targetY = entity.y + Math.sin(away) * 36;
  resetStuck(entity);
}

function startRegroup(state: GameState, entity: Entity, poi: Poi, rng: () => number): void {
  if (entity.state === "DANCE") {
    return;
  }
  const offset = randRange(rng, 0, Math.PI * 2);
  const dist = randRange(rng, 16, RHYTHM.regroupScatterRadius);
  let targetX = poi.x + Math.cos(offset) * dist;
  let targetY = poi.y + Math.sin(offset) * dist;
  if (!isWalkable(state.world, targetX, targetY, "ground")) {
    targetX = poi.x;
    targetY = poi.y;
  }
  entity.state = "REGROUP";
  entity.regroupPoiId = poi.id;
  entity.stateTimer = RHYTHM.regroupHold;
  entity.targetX = targetX;
  entity.targetY = targetY;
  entity.stuckRetries = 0;
  entity.stuckRecoverTtl = 0;
  resetStuck(entity);
}

function stepWalk(state: GameState, entity: Entity, dt: number): boolean {
  if (hasArrived(entity)) {
    resetStuck(entity);
    return false;
  }
  const prevX = entity.x;
  const prevY = entity.y;
  const prevDist = Math.hypot(entity.targetX - prevX, entity.targetY - prevY);
  const moved = moveToward(
    state.world,
    readPose(entity),
    entity.targetX,
    entity.targetY,
    RHYTHM.speed,
    dt,
  );
  assignPose(entity, moved);
  entity.angle = angleTo(entity.x, entity.y, entity.targetX, entity.targetY);
  entity.lookAngle = entity.angle;
  return updateStuck(entity, dt, prevX, prevY, prevDist);
}

function recoverFromStuck(state: GameState, entity: Entity, rng: () => number): void {
  const keep = shouldKeepGoal(state, entity);
  if (stuckDebug) {
    const info = boliStuckInfo(entity, Boolean(state.behaviorCheck));
    console.info(
      `[boli-ai] stuck ${keep ? "retry" : "abandon"} ${info.id} ${info.state}` +
        ` useful=${info.useful.toFixed(1)} toward=${info.toward.toFixed(1)}` +
        ` speed=${info.speed.toFixed(1)} dist=${info.dist.toFixed(1)}`,
    );
  }
  entity.stuckRecoverTtl = randRange(rng, RHYTHM.stuckRecoverMin, RHYTHM.stuckRecoverMax);
  entity.stuckTimer = 0;
  entity.stuckUseful = 0;
  if (keep) {
    entity.stuckRetries += 1;
    return;
  }
  entity.stuckRetries = 0;
  entity.regroupPoiId = null;
}

function tickStuckRecover(
  state: GameState,
  entity: Entity,
  dt: number,
  rng: () => number,
): void {
  entity.stuckRecoverTtl = Math.max(0, entity.stuckRecoverTtl - dt);
  applyIdleLook(entity);
  if (entity.stuckRecoverTtl > 0) {
    return;
  }
  if (entity.regroupPoiId) {
    entity.state = "REGROUP";
    resetStuck(entity);
    return;
  }
  enterWander(state.world, entity, rng);
}

function shouldKeepGoal(state: GameState, entity: Entity): boolean {
  if (state.behaviorCheck) {
    return true;
  }
  const poi = entity.regroupPoiId;
  if (!poi || poi.startsWith("check-")) {
    return false;
  }
  return entity.stuckRetries < RHYTHM.stuckRetryMax;
}

function updateStuck(
  entity: Entity,
  dt: number,
  prevX: number,
  prevY: number,
  prevDist: number,
): boolean {
  if (hasArrived(entity)) {
    resetStuck(entity);
    return false;
  }
  const dtSafe = Math.max(dt, 1 / 240);
  const expected = RHYTHM.speed;
  const maxStep = expected * dtSafe;
  const mx = entity.x - prevX;
  const my = entity.y - prevY;
  const dist = Math.hypot(entity.targetX - entity.x, entity.targetY - entity.y);
  const tdx = entity.targetX - prevX;
  const tdy = entity.targetY - prevY;
  const tlen = Math.hypot(tdx, tdy) || 1;
  const ux = tdx / tlen;
  const uy = tdy / tlen;
  const approachStep = clamp(mx * ux + my * uy, -maxStep, maxStep);
  const closerStep = clamp(prevDist - dist, -maxStep, maxStep);
  const speedReal = Math.min(Math.hypot(mx, my) / dtSafe, expected * 1.15);
  const speedToward = approachStep / dtSafe;
  const closerRate = closerStep / dtSafe;
  const aligned = speedReal < 2 || speedToward >= speedReal * RHYTHM.stuckAlignMin;
  const towardTerm = aligned ? Math.max(0, speedToward) : 0;
  const usefulInstant = 0.55 * towardTerm + 0.45 * Math.max(0, closerRate);
  const alpha = 1 - Math.exp(-dtSafe / RHYTHM.stuckUsefulTau);
  entity.stuckSpeed = speedReal;
  entity.stuckToward = speedToward;
  entity.stuckUseful += alpha * (usefulInstant - entity.stuckUseful);

  if (entity.stuckUseful >= expected * RHYTHM.stuckApproachRatio) {
    entity.stuckTimer = 0;
    entity.stuckX = entity.x;
    entity.stuckY = entity.y;
    entity.stuckGoalDist = dist;
    return false;
  }
  entity.stuckTimer += dtSafe;
  return entity.stuckTimer >= RHYTHM.stuckSeconds;
}

function resetStuck(entity: Entity): void {
  entity.stuckTimer = 0;
  entity.stuckX = entity.x;
  entity.stuckY = entity.y;
  entity.stuckGoalDist = Math.hypot(entity.targetX - entity.x, entity.targetY - entity.y);
  entity.stuckUseful = 0;
  entity.stuckSpeed = 0;
  entity.stuckToward = 0;
}

function ensureStuckFields(entity: Entity): void {
  if (typeof entity.stuckTimer !== "number") {
    entity.stuckTimer = 0;
    entity.stuckX = entity.x;
    entity.stuckY = entity.y;
    entity.stuckGoalDist = Math.hypot(entity.targetX - entity.x, entity.targetY - entity.y);
  }
  if (typeof entity.stuckRecoverTtl !== "number") {
    entity.stuckRecoverTtl = 0;
    entity.stuckRetries = 0;
    entity.stuckSpeed = 0;
    entity.stuckToward = 0;
    entity.stuckUseful = 0;
  }
}

function hasArrived(entity: Entity): boolean {
  return Math.hypot(entity.targetX - entity.x, entity.targetY - entity.y) <= RHYTHM.wanderArriveSlack;
}

function applyIdleLook(entity: Entity): void {
  const look =
    Math.sin((entity.headPhase / RHYTHM.headTurnPeriod) * Math.PI * 2) * RHYTHM.headTurnAmp;
  entity.angle = entity.lookAngle + look;
}

function pickPoi(state: GameState, rng: () => number): Poi | undefined {
  if (state.regroup.poiId) {
    return poiById(state.world, state.regroup.poiId);
  }
  return state.world.pois[Math.floor(rng() * state.world.pois.length)];
}

function shuffleInPlace<T>(items: T[], rng: () => number): void {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = items[i];
    items[i] = items[j];
    items[j] = tmp;
  }
}
