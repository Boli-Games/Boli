import { angleTo, applyVertical, assignPose, moveByVelocity, moveToward, readPose, settle } from "./physics";
import { ROUND, RHYTHM, type GameState, type Hunter } from "./types";
import { randomWalkablePoint } from "./world";

export type HunterInput = {
  forward: number;
  strafe: number;
  yaw: number;
  pitch: number;
};

export function createHunter(
  stateLike: { world: GameState["world"] },
  rng: () => number,
  spawn?: { x: number; y: number; z: number; layer: Hunter["layer"] },
): Hunter {
  const point = spawn ?? randomWalkablePoint(stateLike.world, rng, "ground");
  const posed = settle(stateLike.world, point.x, point.y, spawn?.layer ?? point.layer);
  const target = randomWalkablePoint(stateLike.world, rng, posed.layer);
  return {
    x: posed.x,
    y: posed.y,
    z: posed.z,
    vz: 0,
    layer: posed.layer,
    angle: angleTo(posed.x, posed.y, target.x, target.y),
    pitch: 0,
    targetX: target.x,
    targetY: target.y,
    state: "WANDER",
    stateTimer: 0,
    walkTime: 0,
    lookAngle: 0,
    hp: ROUND.hunterHp,
    controllerId: null,
  };
}

export function tickHunterAi(hunter: Hunter, state: GameState, dt: number, rng: () => number): void {
  hunter.walkTime += dt;

  if (hunter.state === "PAUSE") {
    hunter.stateTimer -= dt;
    const nearest = nearestCrowd(state, hunter.x, hunter.y);
    if (nearest) {
      hunter.lookAngle = angleTo(hunter.x, hunter.y, nearest.x, nearest.y);
      hunter.angle = hunter.lookAngle;
    }
    hunter.pitch = 0;
    if (hunter.stateTimer <= 0) {
      const next = randomWalkablePoint(state.world, rng, hunter.layer);
      hunter.targetX = next.x;
      hunter.targetY = next.y;
      hunter.state = "WANDER";
    }
    applyPose(hunter, state, dt);
    return;
  }

  const moved = moveToward(
    state.world,
    readPose(hunter),
    hunter.targetX,
    hunter.targetY,
    RHYTHM.speed,
    dt,
  );
  assignPose(hunter, moved);
  hunter.angle = angleTo(hunter.x, hunter.y, hunter.targetX, hunter.targetY);
  hunter.lookAngle = hunter.angle;
  hunter.pitch = 0;

  if (moved.arrived) {
    hunter.state = "PAUSE";
    hunter.stateTimer = 1.4 + rng() * 1.2;
  }
}

export function tickHunterControlled(
  hunter: Hunter,
  state: GameState,
  input: HunterInput,
  dt: number,
): void {
  hunter.angle = input.yaw;
  hunter.lookAngle = input.yaw;
  hunter.pitch = input.pitch;

  const moving = input.forward !== 0 || input.strafe !== 0;
  if (!moving) {
    hunter.state = "PAUSE";
    hunter.walkTime = 0;
    applyPose(hunter, state, dt);
    return;
  }

  const vx = Math.cos(input.yaw) * input.forward + -Math.sin(input.yaw) * input.strafe;
  const vy = Math.sin(input.yaw) * input.forward + Math.cos(input.yaw) * input.strafe;
  const len = Math.hypot(vx, vy) || 1;
  const next = moveByVelocity(
    state.world,
    readPose(hunter),
    (vx / len) * RHYTHM.speed,
    (vy / len) * RHYTHM.speed,
    dt,
  );
  assignPose(hunter, next);
  hunter.state = "WANDER";
  hunter.walkTime += dt;
}

function applyPose(hunter: Hunter, state: GameState, dt: number): void {
  assignPose(hunter, applyVertical(state.world, readPose(hunter), dt));
}

function nearestCrowd(state: GameState, x: number, y: number) {
  let best = null as { x: number; y: number } | null;
  let bestDist = 90;
  for (const entity of state.entities) {
    if (entity.downed) {
      continue;
    }
    const dist = Math.hypot(entity.x - x, entity.y - y);
    if (dist < bestDist) {
      bestDist = dist;
      best = entity;
    }
  }
  return best;
}
