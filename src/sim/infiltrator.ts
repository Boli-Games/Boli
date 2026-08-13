import { applyVertical, assignPose, moveByVelocity, readPose } from "./physics";
import { RHYTHM, type Entity, type GameState } from "./types";

export type InfiltratorInput = {
  forward: number;
  strafe: number;
  yaw: number;
  boliMode: boolean;
};

export function tickInfiltrator(
  state: GameState,
  player: Entity,
  input: InfiltratorInput,
  dt: number,
): void {
  if (player.downed || state.phase !== "PLAYING") {
    return;
  }

  player.headPhase += dt;
  player.stumbleTtl = Math.max(0, player.stumbleTtl - dt);

  if (input.boliMode) {
    applyBoliMode(state, player, input, dt);
    assignPose(player, applyVertical(state.world, readPose(player), dt));
    applyStumble(player, state.clock);
    return;
  }

  const moving = input.forward !== 0 || input.strafe !== 0;
  player.angle = input.yaw;
  player.lookAngle = input.yaw;

  if (moving) {
    const vx = Math.cos(input.yaw) * input.forward + -Math.sin(input.yaw) * input.strafe;
    const vy = Math.sin(input.yaw) * input.forward + Math.cos(input.yaw) * input.strafe;
    const len = Math.hypot(vx, vy) || 1;
    const next = moveByVelocity(
      state.world,
      readPose(player),
      (vx / len) * RHYTHM.speed,
      (vy / len) * RHYTHM.speed,
      dt,
    );
    assignPose(player, next);
    player.state = "WANDER";
    player.walkTime += dt;
  } else {
    player.state = "PAUSE";
    player.walkTime = 0;
    assignPose(player, applyVertical(state.world, readPose(player), dt));
  }

  applyStumble(player, state.clock);
}

function applyStumble(player: Entity, clock: number): void {
  if (player.stumbleTtl <= 0) {
    return;
  }
  const wobble = Math.sin(clock * 18) * 0.14;
  player.angle += wobble;
  player.lookAngle += wobble * 0.6;
}

function applyBoliMode(
  state: GameState,
  player: Entity,
  input: InfiltratorInput,
  dt: number,
): void {
  const mentor = nearestBoli(state, player);
  if (!mentor) {
    return;
  }

  if (mentor.state === "REACT") {
    player.state = "REACT";
    player.walkTime = 0;
    player.angle = mentor.angle;
    player.lookAngle = mentor.lookAngle;
    return;
  }

  player.state = mentor.state === "PAUSE" ? "PAUSE" : "WANDER";

  if (mentor.state === "PAUSE" || hasArrivedLike(mentor)) {
    player.walkTime = 0;
    player.headPhase = mentor.headPhase;
    const look =
      Math.sin((player.headPhase / RHYTHM.headTurnPeriod) * Math.PI * 2) * RHYTHM.headTurnAmp;
    player.angle = mentor.lookAngle + look;
    player.lookAngle = player.angle;
    return;
  }

  let yaw = input.yaw;
  let forward = input.forward;
  let strafe = input.strafe;
  if (forward === 0 && strafe === 0) {
    yaw = mentor.angle;
    forward = 1;
    strafe = 0;
  }
  const vx = Math.cos(yaw) * forward + -Math.sin(yaw) * strafe;
  const vy = Math.sin(yaw) * forward + Math.cos(yaw) * strafe;
  const len = Math.hypot(vx, vy) || 1;
  const next = moveByVelocity(
    state.world,
    readPose(player),
    (vx / len) * RHYTHM.speed,
    (vy / len) * RHYTHM.speed,
    dt,
  );
  assignPose(player, next);
  player.angle = yaw;
  player.lookAngle = yaw;
  player.walkTime = mentor.walkTime;
}

function nearestBoli(state: GameState, player: Entity): Entity | null {
  let best: Entity | null = null;
  let bestDist = Infinity;
  for (const entity of state.entities) {
    if (entity.isPlayer || entity.downed) {
      continue;
    }
    const dist = Math.hypot(entity.x - player.x, entity.y - player.y);
    if (dist < bestDist) {
      bestDist = dist;
      best = entity;
    }
  }
  return best;
}

function hasArrivedLike(entity: Entity): boolean {
  if (entity.state !== "REGROUP") {
    return false;
  }
  return Math.hypot(entity.targetX - entity.x, entity.targetY - entity.y) <= RHYTHM.wanderArriveSlack;
}
