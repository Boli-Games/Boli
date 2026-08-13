import { angleTo, applyVertical, assignPose, moveToward, readPose } from "./physics";
import { RHYTHM, type BehaviorCheck, type Entity, type GameState, type Poi, type World } from "./types";
import { isWalkable, poiById, randInt, randRange, randomCrowdPoint } from "./world";

export function tickBolis(state: GameState, dt: number, rng: () => number): void {
  tickCrowdEvents(state, dt, rng);

  for (const entity of state.entities) {
    if (entity.isPlayer || entity.downed) {
      continue;
    }
    entity.walkTime = state.clock;
    entity.headPhase = state.clock;
    tickBoli(state, entity, dt, rng);
    assignPose(entity, applyVertical(state.world, readPose(entity), dt));
  }
}

export function startleCrowd(state: GameState, x: number, y: number): void {
  for (const entity of state.entities) {
    if (entity.isPlayer || entity.downed) {
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
  const check = pickBehaviorCheck(state, rng);
  state.behaviorCheck = check;
  for (const entity of state.entities) {
    if (entity.isPlayer || entity.downed) {
      continue;
    }
    sendToCheck(state, entity, check, rng);
  }
}

function pickBehaviorCheck(state: GameState, rng: () => number): BehaviorCheck {
  const roll = rng();
  const ttl = RHYTHM.behaviorCheckDuration;
  if (roll < 0.34) {
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
  if (roll < 0.67) {
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
  if (state.behaviorCheck && entity.state !== "REACT") {
    tickCheckFollow(state, entity, dt);
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

function tickCheckFollow(state: GameState, entity: Entity, dt: number): void {
  if (!hasArrived(entity)) {
    entity.state = "REGROUP";
    stepWalk(state, entity, dt);
    return;
  }
  entity.state = "PAUSE";
  entity.stateTimer = state.behaviorCheck?.ttl ?? 1;
  applyIdleLook(entity);
}

function tickWander(state: GameState, entity: Entity, dt: number, rng: () => number): void {
  entity.stateTimer -= dt;
  stepWalk(state, entity, dt);
  if (hasArrived(entity) || entity.stateTimer <= 0) {
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
    stepWalk(state, entity, dt);
    return;
  }

  entity.stateTimer -= dt;
  applyIdleLook(entity);

  if (entity.stateTimer <= 0) {
    entity.regroupPoiId = null;
    enterPause(entity, rng);
  }
}

function tickReact(entity: Entity, dt: number): void {
  entity.stateTimer -= dt;
  if (entity.stateTimer > 0) {
    return;
  }
  entity.state = "WANDER";
  const dist = Math.hypot(entity.targetX - entity.x, entity.targetY - entity.y);
  entity.stateTimer = dist / RHYTHM.speed + 1.2;
}

export function enterWander(world: World, entity: Entity, rng: () => number): void {
  const point = randomCrowdPoint(world, rng, entity.layer);
  entity.state = "WANDER";
  entity.targetX = point.x;
  entity.targetY = point.y;
  const dist = Math.hypot(point.x - entity.x, point.y - entity.y);
  entity.stateTimer = dist / RHYTHM.speed + 2;
  entity.regroupPoiId = null;
}

export function enterPause(entity: Entity, rng: () => number): void {
  entity.state = "PAUSE";
  entity.stateTimer = randRange(rng, RHYTHM.pauseMin, RHYTHM.pauseMax);
  if (rng() < RHYTHM.lookAroundChance) {
    entity.lookAngle += randRange(rng, -1.1, 1.1);
  }
}

export function enterReact(entity: Entity, shotX: number, shotY: number): void {
  entity.state = "REACT";
  entity.stateTimer = RHYTHM.reactLook;
  entity.lookAngle = angleTo(entity.x, entity.y, shotX, shotY);
  entity.angle = entity.lookAngle;
  const away = angleTo(shotX, shotY, entity.x, entity.y);
  entity.targetX = entity.x + Math.cos(away) * 36;
  entity.targetY = entity.y + Math.sin(away) * 36;
}

function startRegroup(state: GameState, entity: Entity, poi: Poi, rng: () => number): void {
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
}

function stepWalk(state: GameState, entity: Entity, dt: number): void {
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
