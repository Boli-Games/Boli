import type { AmmoCrate, House, Objective, Ramp, Rect, Roof, WalkLayer, World } from "./types";
import { RHYTHM } from "./types";

export function createWorld(): World {
  const width = 820;
  const height = 640;

  const houseA = makeHouse({
    id: "casita",
    x: 36,
    y: 36,
    w: 220,
    h: 180,
    wall: 8,
    roofZ: 36,
    door: { side: "s", offset: 88, width: 32 },
    ramp: { x: 52, y: 52, w: 24, h: 140, z0: 36, z1: 0, along: "y" },
    color: 0xc4a574,
  });

  const houseB = makeHouse({
    id: "casa-grande",
    x: 520,
    y: 44,
    w: 250,
    h: 200,
    wall: 8,
    roofZ: 40,
    door: { side: "w", offset: 78, width: 34 },
    ramp: { x: 560, y: 228, w: 100, h: 56, z0: 40, z1: 0, along: "y" },
    color: 0xb08968,
  });

  const hill: Roof = { x: 560, y: 400, w: 180, h: 150, z: 22 };
  const hillRamp: Ramp = { x: 400, y: 438, w: 160, h: 40, z0: 0, z1: 22, along: "x" };

  const pois = [
    { id: "fountain", x: 340, y: 280, radius: 28, kind: "fountain" as const },
    { id: "statue", x: 430, y: 150, radius: 20, kind: "statue" as const },
    { id: "plaza", x: 320, y: 470, radius: 34, kind: "plaza" as const },
  ];

  const cover: Rect[] = [
    { x: 280, y: 330, w: 70, h: 14 },
    { x: 150, y: 380, w: 16, h: 90 },
    { x: 430, y: 300, w: 16, h: 80 },
  ];

  const houses = [houseA, houseB];
  const obstacles = [...houseA.walls, ...houseB.walls, ...cover];
  const ramps = [houseA.ramp, houseB.ramp, hillRamp];
  const roofs: Roof[] = [
    { x: houseA.x - 1, y: houseA.y - 1, w: houseA.w + 2, h: houseA.h + 2, z: houseA.roofZ },
    { x: houseB.x - 1, y: houseB.y - 1, w: houseB.w + 2, h: houseB.h + 2, z: houseB.roofZ },
    hill,
  ];

  return { width, height, pois, obstacles, cover, ramps, roofs, houses };
}

export function createAmmoCrates(): AmmoCrate[] {
  return [
    { id: "plaza", x: 372, y: 318, z: 0, taken: false },
    { id: "casa-grande", x: 585, y: 78, z: 0, taken: false },
    { id: "loma-pie", x: 388, y: 458, z: 0, taken: false },
  ];
}

export function createObjectives(): Objective[] {
  return [
    {
      id: "techo",
      x: 146,
      y: 120,
      z: 36,
      radius: 18,
      label: "el techo de la casa chica",
      done: false,
      hold: 0,
    },
    {
      id: "mesa",
      x: 650,
      y: 140,
      z: 0,
      radius: 16,
      label: "la mesa de la casa grande",
      done: false,
      hold: 0,
    },
    {
      id: "loma",
      x: 650,
      y: 475,
      z: 22,
      radius: 18,
      label: "la loma",
      done: false,
      hold: 0,
    },
  ];
}

function makeHouse(opts: {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  wall: number;
  roofZ: number;
  door: { side: "n" | "s" | "e" | "w"; offset: number; width: number };
  ramp: Ramp;
  color: number;
}): House {
  return {
    id: opts.id,
    x: opts.x,
    y: opts.y,
    w: opts.w,
    h: opts.h,
    wall: opts.wall,
    roofZ: opts.roofZ,
    walls: wallsWithDoor(opts.x, opts.y, opts.w, opts.h, opts.wall, opts.door),
    ramp: opts.ramp,
    color: opts.color,
  };
}

function wallsWithDoor(
  x: number,
  y: number,
  w: number,
  h: number,
  t: number,
  door: { side: "n" | "s" | "e" | "w"; offset: number; width: number },
): Rect[] {
  const north: Rect = { x, y, w, h: t };
  const south: Rect = { x, y: y + h - t, w, h: t };
  const west: Rect = { x, y, w: t, h };
  const east: Rect = { x: x + w - t, y, w: t, h };

  const split = (wall: Rect, horizontal: boolean): Rect[] => {
    if (horizontal) {
      return [
        { x: wall.x, y: wall.y, w: door.offset, h: wall.h },
        {
          x: wall.x + door.offset + door.width,
          y: wall.y,
          w: wall.w - door.offset - door.width,
          h: wall.h,
        },
      ];
    }
    return [
      { x: wall.x, y: wall.y, w: wall.w, h: door.offset },
      {
        x: wall.x,
        y: wall.y + door.offset + door.width,
        w: wall.w,
        h: wall.h - door.offset - door.width,
      },
    ];
  };

  let walls: Rect[];
  if (door.side === "n") walls = [...split(north, true), south, west, east];
  else if (door.side === "s") walls = [north, ...split(south, true), west, east];
  else if (door.side === "w") walls = [north, south, ...split(west, false), east];
  else walls = [north, south, west, ...split(east, false)];
  return walls.filter((rect) => rect.w > 2 && rect.h > 2);
}

export function pointInRect(x: number, y: number, rect: Rect): boolean {
  return x >= rect.x && y >= rect.y && x <= rect.x + rect.w && y <= rect.y + rect.h;
}

export function rampAt(world: World, x: number, y: number): Ramp | undefined {
  return world.ramps.find((ramp) => pointInRect(x, y, ramp));
}

export function roofAt(world: World, x: number, y: number): Roof | undefined {
  return world.roofs.find((roof) => pointInRect(x, y, roof));
}

export function rampHeight(ramp: Ramp, x: number, y: number): number {
  const t =
    ramp.along === "x" ? (x - ramp.x) / Math.max(1, ramp.w) : (y - ramp.y) / Math.max(1, ramp.h);
  return ramp.z0 + (ramp.z1 - ramp.z0) * clamp(t, 0, 1);
}

export function supportHeight(world: World, x: number, y: number, z: number, layer: WalkLayer): number {
  const ramp = rampAt(world, x, y);
  if (ramp) {
    return rampHeight(ramp, x, y);
  }
  const roof = roofAt(world, x, y);
  if (roof && (layer === "roof" || z >= roof.z - 6)) {
    return roof.z;
  }
  return 0;
}

export function sampleHeight(world: World, x: number, y: number, layer: WalkLayer): number {
  return supportHeight(world, x, y, layer === "roof" ? 999 : 0, layer);
}

export function resolveLayer(world: World, x: number, y: number, z: number, layer: WalkLayer): WalkLayer {
  const ramp = rampAt(world, x, y);
  if (ramp) {
    const h = rampHeight(ramp, x, y);
    const mid = (ramp.z0 + ramp.z1) * 0.5;
    return h >= mid ? "roof" : "ground";
  }
  if ((layer === "roof" || z > 8) && roofAt(world, x, y)) {
    return "roof";
  }
  return "ground";
}

export function circleHitsRect(
  x: number,
  y: number,
  radius: number,
  rect: Rect,
): boolean {
  const nearestX = clamp(x, rect.x, rect.x + rect.w);
  const nearestY = clamp(y, rect.y, rect.y + rect.h);
  const dx = x - nearestX;
  const dy = y - nearestY;
  return dx * dx + dy * dy < radius * radius;
}

export function isWalkable(
  world: World,
  x: number,
  y: number,
  layer: WalkLayer,
  radius = RHYTHM.radius,
): boolean {
  const pad = radius + 2;
  if (x < pad || y < pad || x > world.width - pad || y > world.height - pad) {
    return false;
  }
  if (rampAt(world, x, y)) {
    return true;
  }
  if (layer === "roof") {
    return Boolean(roofAt(world, x, y));
  }
  for (const obstacle of world.obstacles) {
    if (circleHitsRect(x, y, radius, obstacle)) {
      return false;
    }
  }
  return true;
}

export function canStandAt(
  world: World,
  x: number,
  y: number,
  fromLayer: WalkLayer,
  fromZ: number,
  radius = RHYTHM.radius,
): boolean {
  const pad = radius + 2;
  if (x < pad || y < pad || x > world.width - pad || y > world.height - pad) {
    return false;
  }
  if (rampAt(world, x, y) || roofAt(world, x, y)) {
    return true;
  }
  if (fromLayer === "roof" || fromZ > 8) {
    return isWalkable(world, x, y, "ground", radius);
  }
  return isWalkable(world, x, y, "ground", radius);
}

export function randomCrowdPoint(
  world: World,
  rng: () => number,
  layer: WalkLayer = "ground",
  radius = RHYTHM.radius,
): { x: number; y: number; layer: WalkLayer } {
  if (layer === "roof") {
    return randomWalkablePoint(world, rng, layer, radius);
  }
  if (rng() < 0.7 && world.pois.length > 0) {
    const poi = world.pois[Math.floor(rng() * world.pois.length)];
    for (let i = 0; i < 24; i++) {
      const angle = rng() * Math.PI * 2;
      const dist = 18 + rng() * 70;
      const x = poi.x + Math.cos(angle) * dist;
      const y = poi.y + Math.sin(angle) * dist;
      if (isWalkable(world, x, y, "ground", radius)) {
        return { x, y, layer: "ground" };
      }
    }
  }
  for (let i = 0; i < 40; i++) {
    const x = world.width * 0.2 + rng() * world.width * 0.6;
    const y = world.height * 0.2 + rng() * world.height * 0.6;
    if (isWalkable(world, x, y, "ground", radius)) {
      return { x, y, layer: "ground" };
    }
  }
  return randomWalkablePoint(world, rng, "ground", radius);
}

export function randomWalkablePoint(
  world: World,
  rng: () => number,
  layer: WalkLayer = "ground",
  radius = RHYTHM.radius,
): { x: number; y: number; layer: WalkLayer } {
  if (layer === "roof") {
    const roof = world.roofs[Math.floor(rng() * world.roofs.length)];
    if (roof) {
      for (let i = 0; i < 40; i++) {
        const x = roof.x + 10 + rng() * Math.max(4, roof.w - 20);
        const y = roof.y + 10 + rng() * Math.max(4, roof.h - 20);
        if (isWalkable(world, x, y, "roof", radius)) {
          return { x, y, layer: "roof" };
        }
      }
    }
  }
  for (let i = 0; i < 80; i++) {
    const x = radius + 8 + rng() * (world.width - radius * 2 - 16);
    const y = radius + 8 + rng() * (world.height - radius * 2 - 16);
    if (isWalkable(world, x, y, "ground", radius)) {
      return { x, y, layer: "ground" };
    }
  }
  return { x: world.width * 0.5, y: world.height * 0.5, layer: "ground" };
}

export function poiById(world: World, id: string) {
  return world.pois.find((poi) => poi.id === id);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function randRange(rng: () => number, min: number, max: number): number {
  return min + rng() * (max - min);
}

export function randInt(rng: () => number, min: number, max: number): number {
  return Math.floor(randRange(rng, min, max + 1));
}
