import { RHYTHM, type House, type World } from "./types";
import { isWalkable } from "./world";

export type RouteStop = { id: string; x: number; y: number };

export type HouseDoor = {
  x: number;
  y: number;
  nx: number;
  ny: number;
  width: number;
};

export function houseInterior(house: House): { x: number; y: number; w: number; h: number } {
  const t = house.wall;
  return { x: house.x + t, y: house.y + t, w: house.w - t * 2, h: house.h - t * 2 };
}

export function pointInHouseInterior(x: number, y: number, house: House): boolean {
  const inner = houseInterior(house);
  return x >= inner.x && y >= inner.y && x <= inner.x + inner.w && y <= inner.y + inner.h;
}

export function houseContaining(world: World, x: number, y: number): House | undefined {
  return world.houses.find((house) => pointInHouseInterior(x, y, house));
}

/** Outward-facing door center inferred from the wall gap. */
export function houseDoor(house: House): HouseDoor {
  const t = house.wall;
  const inWall = (px: number, py: number) =>
    house.walls.some((wall) => px >= wall.x && py >= wall.y && px <= wall.x + wall.w && py <= wall.y + wall.h);

  const sides: Array<{ nx: number; ny: number; pts: Array<{ x: number; y: number }> }> = [
    { nx: 0, ny: -1, pts: [] },
    { nx: 0, ny: 1, pts: [] },
    { nx: -1, ny: 0, pts: [] },
    { nx: 1, ny: 0, pts: [] },
  ];
  const step = 4;
  for (let x = house.x + t; x < house.x + house.w - t; x += step) {
    if (!inWall(x, house.y + t * 0.5)) {
      sides[0].pts.push({ x, y: house.y });
    }
    if (!inWall(x, house.y + house.h - t * 0.5)) {
      sides[1].pts.push({ x, y: house.y + house.h });
    }
  }
  for (let y = house.y + t; y < house.y + house.h - t; y += step) {
    if (!inWall(house.x + t * 0.5, y)) {
      sides[2].pts.push({ x: house.x, y });
    }
    if (!inWall(house.x + house.w - t * 0.5, y)) {
      sides[3].pts.push({ x: house.x + house.w, y });
    }
  }
  const best = sides.reduce((a, b) => (b.pts.length > a.pts.length ? b : a));
  const mid = best.pts[Math.floor(best.pts.length * 0.5)] ?? {
    x: house.x + house.w * 0.5,
    y: house.y + house.h,
  };
  return { x: mid.x, y: mid.y, nx: best.nx, ny: best.ny, width: Math.max(16, best.pts.length * step) };
}

function aroundHouse(house: House, fromX: number, fromY: number): RouteStop[] {
  const pad = 22;
  const corners = [
    { id: `${house.id}.nw`, x: house.x - pad, y: house.y - pad },
    { id: `${house.id}.ne`, x: house.x + house.w + pad, y: house.y - pad },
    { id: `${house.id}.sw`, x: house.x - pad, y: house.y + house.h + pad },
    { id: `${house.id}.se`, x: house.x + house.w + pad, y: house.y + house.h + pad },
  ];
  const door = houseDoor(house);
  const alongDoor = (stop: RouteStop) => stop.x * door.nx + stop.y * door.ny;
  const fromAlong = fromX * door.nx + fromY * door.ny;
  const doorAlong = door.x * door.nx + door.y * door.ny;
  if (fromAlong >= doorAlong - 8) {
    return [];
  }
  return corners.sort((a, b) => alongDoor(b) - alongDoor(a)).slice(0, 1);
}

export function planApproach(
  world: World,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  rng: () => number,
): RouteStop[] {
  const house = houseContaining(world, toX, toY);
  if (!house || pointInHouseInterior(fromX, fromY, house)) {
    return [];
  }
  const door = houseDoor(house);
  const doorOut: RouteStop = {
    id: `${house.id}.door-out`,
    x: door.x + door.nx * 18 + (rng() - 0.5) * 8,
    y: door.y + door.ny * 18 + (rng() - 0.5) * 8,
  };
  const doorIn: RouteStop = {
    id: `${house.id}.door-in`,
    x: door.x - door.nx * (house.wall + 10),
    y: door.y - door.ny * (house.wall + 10),
  };
  const flanks = aroundHouse(house, fromX, fromY).map((stop) => ({
    ...stop,
    x: stop.x + (rng() - 0.5) * 12,
    y: stop.y + (rng() - 0.5) * 12,
  }));
  const stops = [...flanks, doorOut, doorIn].filter(
    (stop, index, list) =>
      Math.hypot(stop.x - fromX, stop.y - fromY) > RHYTHM.wanderArriveSlack * 1.5 &&
      (index === 0 || Math.hypot(stop.x - list[index - 1].x, stop.y - list[index - 1].y) > 8),
  );
  return stops.filter((stop) => isWalkable(world, stop.x, stop.y, "ground") || stop.id.endsWith("door-in"));
}
