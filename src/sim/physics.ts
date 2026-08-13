import {
  circleHitsRect,
  clamp,
  resolveLayer,
  supportHeight,
} from "./world";
import { RHYTHM, type WalkLayer, type World } from "./types";

export type Pose = {
  x: number;
  y: number;
  z: number;
  vz: number;
  layer: WalkLayer;
};

export function moveToward(
  world: World,
  pose: Pose,
  targetX: number,
  targetY: number,
  speed: number,
  dt: number,
): Pose & { arrived: boolean } {
  const dx = targetX - pose.x;
  const dy = targetY - pose.y;
  const dist = Math.hypot(dx, dy);
  if (dist <= RHYTHM.wanderArriveSlack) {
    const settled = applyVertical(world, { ...pose, x: targetX, y: targetY }, dt);
    return { ...settled, arrived: true };
  }

  const step = Math.min(speed * dt, dist);
  const nx = pose.x + (dx / dist) * step;
  const ny = pose.y + (dy / dist) * step;
  const resolved = resolveSolid(world, pose, nx, ny, dt);
  const after = Math.hypot(targetX - resolved.x, targetY - resolved.y);
  return { ...resolved, arrived: after <= RHYTHM.wanderArriveSlack };
}

export function moveByVelocity(
  world: World,
  pose: Pose,
  vx: number,
  vy: number,
  dt: number,
  maxSpeed: number = RHYTHM.speed,
): Pose {
  const airborne = pose.z > supportHeight(world, pose.x, pose.y, pose.z, pose.layer) + 1;
  const control = airborne ? RHYTHM.fallControl : 1;
  const len = Math.hypot(vx, vy);
  if (len < 0.001) {
    return applyVertical(world, pose, dt);
  }
  const cap = maxSpeed * control;
  const scale = len > cap ? cap / len : 1;
  const nx = pose.x + vx * scale * dt;
  const ny = pose.y + vy * scale * dt;
  return resolveSolid(world, pose, nx, ny, dt);
}

function resolveSolid(world: World, from: Pose, toX: number, toY: number, dt: number): Pose {
  const r = RHYTHM.radius;
  let x = toX;
  let y = toY;
  const pad = r + 1;
  x = clamp(x, pad, world.width - pad);
  y = clamp(y, pad, world.height - pad);

  const airborne = from.z > 6;
  if (!airborne) {
    for (const obstacle of world.obstacles) {
      if (!circleHitsRect(x, y, r, obstacle)) {
        continue;
      }
      const expanded = {
        x: obstacle.x - r,
        y: obstacle.y - r,
        w: obstacle.w + r * 2,
        h: obstacle.h + r * 2,
      };
      const overlapLeft = x - expanded.x;
      const overlapRight = expanded.x + expanded.w - x;
      const overlapTop = y - expanded.y;
      const overlapBottom = expanded.y + expanded.h - y;
      const minX = Math.min(overlapLeft, overlapRight);
      const minY = Math.min(overlapTop, overlapBottom);
      if (minX < minY) {
        x = overlapLeft < overlapRight ? expanded.x : expanded.x + expanded.w;
      } else {
        y = overlapTop < overlapBottom ? expanded.y : expanded.y + expanded.h;
      }
    }
    x = clamp(x, pad, world.width - pad);
    y = clamp(y, pad, world.height - pad);
  }

  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return applyVertical(world, from, dt);
  }
  return applyVertical(world, { ...from, x, y }, dt);
}

export function applyVertical(world: World, pose: Pose, dt: number): Pose {
  const support = supportHeight(world, pose.x, pose.y, pose.z, pose.layer);
  if (pose.z > support + 0.6) {
    const vz = pose.vz - RHYTHM.gravity * dt;
    let z = pose.z + vz * dt;
    if (z <= support) {
      return {
        ...pose,
        z: support,
        vz: 0,
        layer: resolveLayer(world, pose.x, pose.y, support, "ground"),
      };
    }
    return {
      ...pose,
      z,
      vz,
      layer: z > 8 ? pose.layer : "ground",
    };
  }
  const layer = resolveLayer(world, pose.x, pose.y, support, pose.layer);
  return {
    ...pose,
    z: supportHeight(world, pose.x, pose.y, support, layer),
    vz: 0,
    layer,
  };
}

export function assignPose(
  target: { x: number; y: number; z: number; vz: number; layer: WalkLayer },
  pose: Pose,
): void {
  target.x = pose.x;
  target.y = pose.y;
  target.z = pose.z;
  target.vz = pose.vz;
  target.layer = pose.layer;
}

export function readPose(source: {
  x: number;
  y: number;
  z: number;
  vz: number;
  layer: WalkLayer;
}): Pose {
  return { x: source.x, y: source.y, z: source.z, vz: source.vz, layer: source.layer };
}

export function settle(world: World, x: number, y: number, layer: WalkLayer, z = 0, vz = 0): Pose {
  return applyVertical(world, { x, y, z, vz, layer }, 1 / 60);
}

export function angleTo(fromX: number, fromY: number, toX: number, toY: number): number {
  return Math.atan2(toY - fromY, toX - fromX);
}

export function shortestAngleDiff(from: number, to: number): number {
  let diff = to - from;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return diff;
}
