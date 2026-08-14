import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { mulberry32 } from "../sim/rng";
import type { House, Roof, World } from "../sim/types";
import { loadNatureAssets, type NatureAssets } from "./forest";
import { HORIZON_MARGIN } from "./horizon";

const GRASS_TILE = 14.5;
const DIRT_TILE = 12.8;
const COBBLE_TILE = 10.4;
const DIRT_Y = 0.016;
const COBBLE_Y = 0.028;
const PATH_FADE = 5.4;
const TUFT_SEED = 0x6ea55;
const STONE_SEED = 0xc0bb1e;
const NATURE_SEED = 0x51a11;

const GRASS_URL = "/textures/ground/grass.png";
const DIRT_URL = "/textures/ground/dirt.png";
const COBBLE_URL = "/textures/ground/cobble.png";

const PLAY_CLEARS = [
  { x: 372, y: 318, r: 16 },
  { x: 585, y: 78, r: 16 },
  { x: 388, y: 458, r: 16 },
];

type Capsule = { ax: number; ay: number; bx: number; by: number; r: number };
type Ring = { x: number; y: number; R: number; halfW: number };
type Disk = { x: number; y: number; r: number };
type RectBlob = { kind: "rect"; x: number; y: number; w: number; h: number; rad: number; fade: number; noise: number };
type CircleBlob = { kind: "circle"; x: number; y: number; r: number; fade: number; noise: number };
type DirtBlob = RectBlob | CircleBlob;
type PathNet = { capsules: Capsule[]; rings: Ring[]; disks: Disk[] };

type SurfaceFns = {
  dirt: (x: number, y: number) => number;
  path: (x: number, y: number) => number;
};

type Stamp = {
  x: number;
  z: number;
  yaw: number;
  sx: number;
  sy: number;
  sz: number;
  color?: number;
};

let buildId = 0;

export function addGroundSurfaces(root: THREE.Group, world: World): void {
  const id = ++buildId;
  const pad = HORIZON_MARGIN + 6;
  const planeW = world.width + pad * 2;
  const planeH = world.height + pad * 2;
  const surfaces = makeSurfaceFns(world);

  const grassMat = new THREE.MeshLambertMaterial({ color: 0x4f5c46, fog: true });
  const grass = new THREE.Mesh(new THREE.PlaneGeometry(planeW, planeH), grassMat);
  grass.name = "ground-grass";
  grass.rotation.x = -Math.PI / 2;
  grass.position.set(world.width * 0.5, 0, world.height * 0.5);
  grass.receiveShadow = true;
  root.add(grass);

  const dirtMat = makeOverlayMaterial(0xe4d2ae);
  const dirtGeo = buildCoverageGeometry(
    -8,
    -8,
    world.width + 8,
    world.height + 8,
    2.6,
    (x, z) => {
      const d = surfaces.dirt(x, z);
      const p = surfaces.path(x, z);
      return d * (1 - p * 0.78);
    },
    DIRT_Y,
    DIRT_TILE,
  );
  if (dirtGeo) {
    const dirt = new THREE.Mesh(dirtGeo, dirtMat);
    dirt.name = "ground-dirt";
    dirt.receiveShadow = true;
    root.add(dirt);
  }

  const cobbleMat = makeOverlayMaterial(0xd7e0b8);
  const cobbleGeo = buildCoverageGeometry(
    -8,
    -8,
    world.width + 8,
    world.height + 8,
    2,
    (x, z) => surfaces.path(x, z),
    COBBLE_Y,
    COBBLE_TILE,
  );
  if (cobbleGeo) {
    const cobble = new THREE.Mesh(cobbleGeo, cobbleMat);
    cobble.name = "ground-cobble";
    cobble.receiveShadow = true;
    root.add(cobble);
  }

  addGrassField(root, world, surfaces);
  addDirtPebbles(root, world, surfaces);
  addPathStones(root, world, surfaces);

  void loadGroundTextures()
    .then((maps) => {
      if (id !== buildId) {
        maps.grass.dispose();
        maps.dirt.dispose();
        maps.cobble.dispose();
        return;
      }
      maps.grass.repeat.set(planeW / GRASS_TILE, planeH / GRASS_TILE);
      grassMat.map = maps.grass;
      grassMat.color.setHex(0x7d9658);
      grassMat.needsUpdate = true;
      dirtMat.map = maps.dirt;
      dirtMat.needsUpdate = true;
      cobbleMat.map = maps.cobble;
      cobbleMat.needsUpdate = true;
    })
    .catch((err) => {
      console.warn("No se pudieron cargar las texturas del suelo:", err);
    });

  void loadNatureAssets()
    .then((assets) => {
      if (id !== buildId) {
        return;
      }
      addVillageNature(root, world, surfaces, assets);
    })
    .catch((err) => {
      console.warn("No se pudo cargar la vegetación del pueblo:", err);
    });
}

function makeSurfaceFns(world: World): SurfaceFns {
  const blobs = dirtBlobsFromWorld(world);
  const paths = pathNetworkFromWorld(world);
  return {
    dirt: (x, y) => dirtCoverage(x, y, blobs),
    path: (x, y) => pathCoverage(x, y, paths),
  };
}

function dirtBlobsFromWorld(world: World): DirtBlob[] {
  const blobs: DirtBlob[] = [];
  const rng = mulberry32(0x71e44a);

  for (const house of world.houses) {
    blobs.push({
      kind: "rect",
      x: house.x - 14,
      y: house.y - 12,
      w: house.w + 30,
      h: house.h + 32,
      rad: 28,
      fade: 14,
      noise: 11,
    });
    const door = doorAnchor(house);
    blobs.push({
      kind: "circle",
      x: door.x + door.nx * 11,
      y: door.y + door.ny * 11,
      r: 18,
      fade: 12,
      noise: 7,
    });
    for (let i = 0; i < 8; i++) {
      const edge = perimeterPoint(house.x - 10, house.y - 8, house.w + 20, house.h + 22, rng());
      blobs.push({
        kind: "circle",
        x: edge.x + (rng() - 0.5) * 16,
        y: edge.y + (rng() - 0.5) * 16,
        r: 7 + rng() * 12,
        fade: 9 + rng() * 6,
        noise: 7 + rng() * 5,
      });
    }
  }

  for (const roof of extraRoofs(world)) {
    blobs.push({
      kind: "rect",
      x: roof.x - 18,
      y: roof.y - 14,
      w: roof.w + 42,
      h: roof.h + 32,
      rad: 34,
      fade: 15,
      noise: 12,
    });
    for (let i = 0; i < 6; i++) {
      const edge = perimeterPoint(roof.x - 12, roof.y - 10, roof.w + 24, roof.h + 22, rng());
      blobs.push({
        kind: "circle",
        x: edge.x + (rng() - 0.5) * 14,
        y: edge.y + (rng() - 0.5) * 14,
        r: 10 + rng() * 14,
        fade: 11 + rng() * 5,
        noise: 8,
      });
    }
  }

  const hillRamp = world.ramps.find((ramp) => !world.houses.some((house) => house.ramp === ramp));
  if (hillRamp) {
    blobs.push({
      kind: "circle",
      x: hillRamp.x + 16,
      y: hillRamp.y + hillRamp.h * 0.5,
      r: 28,
      fade: 13,
      noise: 8,
    });
  }

  const statue = world.pois.find((poi) => poi.kind === "statue");
  if (statue) {
    blobs.push({
      kind: "circle",
      x: statue.x + 3,
      y: statue.y - 2,
      r: 22,
      fade: 12,
      noise: 7,
    });
    blobs.push({
      kind: "circle",
      x: statue.x + 14,
      y: statue.y + 11,
      r: 11,
      fade: 10,
      noise: 6,
    });
  }

  return blobs;
}

function pathNetworkFromWorld(world: World): PathNet {
  const capsules: Capsule[] = [];
  const rings: Ring[] = [];
  const disks: Disk[] = [];
  const hw = 6.8;

  const chain = (pts: { x: number; y: number }[], r = hw) => {
    for (let i = 0; i < pts.length - 1; i++) {
      capsules.push({
        ax: pts[i].x,
        ay: pts[i].y,
        bx: pts[i + 1].x,
        by: pts[i + 1].y,
        r: r * (0.9 + ((i * 17) % 7) * 0.025),
      });
    }
  };

  const fountain = world.pois.find((poi) => poi.kind === "fountain");
  const statue = world.pois.find((poi) => poi.kind === "statue");
  const plaza = world.pois.find((poi) => poi.kind === "plaza");
  const casita = world.houses.find((house) => house.id === "casita");
  const grande = world.houses.find((house) => house.id === "casa-grande");
  const hill = extraRoofs(world)[0];
  const hillRamp = world.ramps.find((ramp) => !world.houses.some((house) => house.ramp === ramp));

  if (fountain) {
    const ringR = fountain.radius + 6.2;
    rings.push({ x: fountain.x, y: fountain.y, R: ringR, halfW: 6.6 });

    if (casita) {
      const door = doorAnchor(casita);
      chain([
        { x: door.x + door.nx * 3, y: door.y + door.ny * 3 },
        { x: door.x + 8, y: door.y + 28 },
        { x: 210, y: 255 },
        { x: 268, y: 278 },
        { x: fountain.x - ringR, y: fountain.y + 2 },
      ]);
    }

    if (statue && grande) {
      const door = doorAnchor(grande);
      chain([
        { x: door.x + door.nx * 3, y: door.y + door.ny * 3 },
        { x: statue.x + 18, y: statue.y - 4 },
        { x: statue.x - 4, y: statue.y + 18 },
        { x: fountain.x + 8, y: fountain.y - ringR },
      ]);
      disks.push({ x: statue.x, y: statue.y, r: 12.5 });
    }

    if (plaza) {
      chain(
        [
          { x: fountain.x + 22, y: fountain.y + ringR * 0.72 },
          { x: 376, y: 332 },
          { x: 370, y: 392 },
          { x: plaza.x + 18, y: plaza.y - 22 },
          { x: plaza.x + 4, y: plaza.y },
        ],
        6.5,
      );
      disks.push({ x: plaza.x, y: plaza.y, r: 21 });
    }
  }

  if (plaza && hillRamp) {
    chain([
      { x: plaza.x + 10, y: plaza.y + 4 },
      { x: 358, y: 492 },
      { x: hillRamp.x + 8, y: hillRamp.y + hillRamp.h * 0.55 },
    ]);
  }

  if (grande && hill) {
    chain(
      [
        { x: grande.x + grande.w * 0.42, y: grande.y + grande.h + 5 },
        { x: 632, y: 308 },
        { x: 648, y: 366 },
        { x: hill.x + 36, y: hill.y - 6 },
      ],
      6.4,
    );
  }

  return { capsules, rings, disks };
}

function dirtCoverage(x: number, y: number, blobs: DirtBlob[]): number {
  let cover = 0;
  for (const blob of blobs) {
    let d: number;
    if (blob.kind === "rect") {
      d = sdRoundRect(x, y, blob.x, blob.y, blob.w, blob.h, blob.rad);
    } else {
      d = Math.hypot(x - blob.x, y - blob.y) - blob.r;
    }
    const n =
      (valueNoise(x * 0.038 + 8.1, y * 0.038 + 3.4) - 0.5) * blob.noise +
      (valueNoise(x * 0.09 + 2.2, y * 0.09) - 0.5) * blob.noise * 0.45;
    d -= n;
    cover = Math.max(cover, 1 - smoothstep(0, blob.fade, d));
  }
  return cover;
}

function pathCoverage(x: number, y: number, net: PathNet): number {
  let d = 1e9;
  for (const cap of net.capsules) {
    d = Math.min(d, sdCapsule(x, y, cap.ax, cap.ay, cap.bx, cap.by) - cap.r);
  }
  for (const ring of net.rings) {
    d = Math.min(d, Math.abs(Math.hypot(x - ring.x, y - ring.y) - ring.R) - ring.halfW);
  }
  for (const disk of net.disks) {
    d = Math.min(d, Math.hypot(x - disk.x, y - disk.y) - disk.r);
  }
  d -= (valueNoise(x * 0.07, y * 0.07) - 0.5) * 2.6 + (valueNoise(x * 0.16 + 9, y * 0.16) - 0.5) * 1.4;
  return 1 - smoothstep(0, PATH_FADE, d);
}

function extraRoofs(world: World): Roof[] {
  return world.roofs.filter((roof) => !world.houses.some((house) => Math.abs(house.roofZ - roof.z) < 0.5));
}

function doorAnchor(house: House): { x: number; y: number; nx: number; ny: number } {
  const t = house.wall;
  const inWall = (x: number, y: number) =>
    house.walls.some((wall) => x >= wall.x && y >= wall.y && x <= wall.x + wall.w && y <= wall.y + wall.h);

  const sides = [
    { nx: 0, ny: -1, pts: [] as { x: number; y: number }[] },
    { nx: 0, ny: 1, pts: [] as { x: number; y: number }[] },
    { nx: -1, ny: 0, pts: [] as { x: number; y: number }[] },
    { nx: 1, ny: 0, pts: [] as { x: number; y: number }[] },
  ];
  const step = 2;
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
  return { x: mid.x, y: mid.y, nx: best.nx, ny: best.ny };
}

function addGrassField(root: THREE.Group, world: World, surfaces: SurfaceFns): void {
  const rng = mulberry32(TUFT_SEED);
  const short: Stamp[] = [];
  const tall: Stamp[] = [];
  const leafy: Stamp[] = [];

  for (let z = 12; z < world.height - 12; z += 5.4) {
    for (let x = 12; x < world.width - 12; x += 5.4) {
      const px = x + (rng() - 0.5) * 4.6;
      const pz = z + (rng() - 0.5) * 4.6;
      if (blockedSolid(world, px, pz) || inKeepClear(px, pz, 10)) {
        continue;
      }
      const path = surfaces.path(px, pz);
      const dirt = surfaces.dirt(px, pz);
      if (path > 0.34 || dirt > 0.68) {
        continue;
      }
      const mix = grassMix(px, pz);
      const near = structProximity(world, px, pz);
      if (rng() < 0.9) {
        short.push(grassStamp(px, pz, rng, 0.82, 1.18, 0.78, 1.12));
      }
      if (mix.tall > 0.42 && near < 0.82 && path < 0.2 && dirt < 0.48 && rng() < mix.tall) {
        const tx = px + (rng() - 0.5) * 2.2;
        const tz = pz + (rng() - 0.5) * 2.2;
        if (!blockedSolid(world, tx, tz) && surfaces.path(tx, tz) < 0.2) {
          tall.push(grassStamp(tx, tz, rng, 0.78, 1.12, 0.88, 1.28));
        }
      }
      if (mix.leafy > 0.55 && near < 0.7 && path < 0.16 && dirt < 0.4 && rng() < mix.leafy * 0.7) {
        const lx = px + (rng() - 0.5) * 3.4;
        const lz = pz + (rng() - 0.5) * 3.4;
        if (!blockedSolid(world, lx, lz) && surfaces.path(lx, lz) < 0.16) {
          leafy.push(grassStamp(lx, lz, rng, 0.86, 1.22, 0.8, 1.16));
        }
      }
    }
  }

  const grassMat = new THREE.MeshLambertMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
    fog: true,
  });
  const worldSphere = new THREE.Sphere(
    new THREE.Vector3(world.width * 0.5, 0.7, world.height * 0.5),
    Math.hypot(world.width, world.height) * 0.55,
  );
  addStamped(root, "grass-short", makeShortClump(), grassMat, short, 0.02, worldSphere);
  addStamped(root, "grass-tall", makeTallClump(), grassMat, tall, 0.02, worldSphere);
  addStamped(root, "grass-leafy", makeLeafyClump(), grassMat, leafy, 0.02, worldSphere);
}

function grassMix(x: number, z: number): { tall: number; leafy: number } {
  const n = valueNoise(x * 0.01, z * 0.01);
  const n2 = valueNoise(x * 0.023 + 18, z * 0.023);
  return {
    tall: smoothstep(0.28, 0.72, n) * 0.85,
    leafy: smoothstep(0.48, 0.86, n2) * smoothstep(0.32, 0.7, n),
  };
}

function grassStamp(
  x: number,
  z: number,
  rng: () => number,
  sx0: number,
  sx1: number,
  sy0: number,
  sy1: number,
): Stamp {
  const sx = sx0 + rng() * (sx1 - sx0);
  return {
    x,
    z,
    yaw: rng() * Math.PI * 2,
    sx,
    sy: sy0 + rng() * (sy1 - sy0),
    sz: sx * (0.9 + rng() * 0.2),
  };
}

function makeShortClump(): THREE.BufferGeometry {
  const blades = [
    { yaw: 0.2, lean: 0.08, h: 0.46, w: 0.22, t: 0.09, ox: 0.04, oz: 0.02 },
    { yaw: 0.95, lean: 0.12, h: 0.38, w: 0.2, t: 0.08, ox: -0.08, oz: 0.07 },
    { yaw: 1.7, lean: 0.06, h: 0.5, w: 0.24, t: 0.1, ox: 0.1, oz: -0.05 },
    { yaw: 2.5, lean: 0.14, h: 0.34, w: 0.18, t: 0.08, ox: -0.02, oz: -0.1 },
    { yaw: 3.4, lean: 0.09, h: 0.42, w: 0.21, t: 0.09, ox: 0.08, oz: 0.09 },
    { yaw: 4.3, lean: 0.11, h: 0.36, w: 0.19, t: 0.08, ox: -0.11, oz: 0.01 },
  ];
  return mergeBlades(blades, 0x1a4c24, 0x6aae3a, 0.5);
}

function makeTallClump(): THREE.BufferGeometry {
  const blades = [
    { yaw: 0.1, lean: 0.16, h: 1.42, w: 0.1, t: 0.055, ox: 0.02, oz: 0.01 },
    { yaw: 1.35, lean: 0.22, h: 1.18, w: 0.08, t: 0.05, ox: -0.06, oz: 0.05 },
    { yaw: 2.6, lean: 0.12, h: 1.55, w: 0.11, t: 0.05, ox: 0.05, oz: -0.04 },
    { yaw: 4.1, lean: 0.28, h: 1.08, w: 0.09, t: 0.048, ox: -0.03, oz: -0.06 },
  ];
  return mergeBlades(blades, 0x163f1e, 0xb6e24c, 1.55);
}

function makeLeafyClump(): THREE.BufferGeometry {
  const blades = [
    { yaw: 0.05, lean: 0.42, h: 0.92, w: 0.34, t: 0.07, ox: 0.06, oz: 0.02 },
    { yaw: 0.9, lean: 0.55, h: 0.78, w: 0.3, t: 0.065, ox: -0.08, oz: 0.1 },
    { yaw: 1.85, lean: 0.38, h: 1.02, w: 0.38, t: 0.07, ox: 0.12, oz: -0.04 },
    { yaw: 2.7, lean: 0.6, h: 0.7, w: 0.28, t: 0.06, ox: -0.04, oz: -0.12 },
    { yaw: 3.6, lean: 0.48, h: 0.88, w: 0.32, t: 0.068, ox: 0.1, oz: 0.08 },
    { yaw: 4.7, lean: 0.33, h: 0.96, w: 0.36, t: 0.07, ox: -0.1, oz: 0.0 },
  ];
  return mergeBlades(blades, 0x1c5226, 0x8fd24a, 1.02);
}

function mergeBlades(
  blades: { yaw: number; lean: number; h: number; w: number; t: number; ox: number; oz: number }[],
  baseHex: number,
  tipHex: number,
  maxH: number,
): THREE.BufferGeometry {
  const geos: THREE.BufferGeometry[] = [];
  for (const blade of blades) {
    const box = new THREE.BoxGeometry(blade.w, blade.h, blade.t, 1, 3, 1);
    box.translate(0, blade.h * 0.5, 0);
    box.rotateZ(blade.lean);
    box.rotateY(blade.yaw);
    box.translate(blade.ox, 0, blade.oz);
    geos.push(box);
  }
  const merged = mergeGeometries(geos, false);
  for (const geo of geos) {
    geo.dispose();
  }
  if (!merged) {
    throw new Error("No se pudo crear el mechón de césped");
  }
  colorByHeight(merged, baseHex, tipHex, maxH);
  merged.computeVertexNormals();
  return merged;
}

function colorByHeight(geo: THREE.BufferGeometry, baseHex: number, tipHex: number, maxH: number): void {
  const pos = geo.getAttribute("position");
  const cols = new Float32Array(pos.count * 3);
  const base = new THREE.Color(baseHex);
  const tip = new THREE.Color(tipHex);
  const mix = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const t = clamp(pos.getY(i) / Math.max(0.001, maxH), 0, 1);
    mix.copy(base).lerp(tip, t * t);
    cols[i * 3] = mix.r;
    cols[i * 3 + 1] = mix.g;
    cols[i * 3 + 2] = mix.b;
  }
  geo.setAttribute("color", new THREE.Float32BufferAttribute(cols, 3));
}

function addDirtPebbles(root: THREE.Group, world: World, surfaces: SurfaceFns): void {
  const rng = mulberry32(STONE_SEED);
  const round: Stamp[] = [];
  const flat: Stamp[] = [];
  for (let z = 14; z < world.height - 14; z += 7.2) {
    for (let x = 14; x < world.width - 14; x += 7.2) {
      const px = x + (rng() - 0.5) * 6.4;
      const pz = z + (rng() - 0.5) * 6.4;
      const dirt = surfaces.dirt(px, pz);
      const path = surfaces.path(px, pz);
      if (dirt < 0.38 || path > 0.55 || blockedSolid(world, px, pz)) {
        continue;
      }
      if (rng() > 0.55) {
        continue;
      }
      const stamp: Stamp = {
        x: px,
        z: pz,
        yaw: rng() * Math.PI * 2,
        sx: 0.7 + rng() * 0.7,
        sy: 0.55 + rng() * 0.5,
        sz: 0.7 + rng() * 0.7,
        color: rng() < 0.35 ? 0x8a6a48 : 0x6e5640,
      };
      if (rng() < 0.55) {
        round.push(stamp);
      } else {
        flat.push(stamp);
      }
    }
  }
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, fog: true });
  const sphere = new THREE.Sphere(
    new THREE.Vector3(world.width * 0.5, 0.2, world.height * 0.5),
    Math.hypot(world.width, world.height) * 0.55,
  );
  addStamped(root, "dirt-pebble-round", new THREE.DodecahedronGeometry(0.42, 0), mat, round, 0.04, sphere, true);
  addStamped(
    root,
    "dirt-pebble-flat",
    new THREE.BoxGeometry(0.7, 0.22, 0.52),
    mat,
    flat,
    0.05,
    sphere,
    true,
  );
}

function addPathStones(root: THREE.Group, world: World, surfaces: SurfaceFns): void {
  const rng = mulberry32(STONE_SEED ^ 0x45);
  const pavers: Stamp[] = [];
  const cobbles: Stamp[] = [];
  const chips: Stamp[] = [];
  for (let z = 10; z < world.height - 10; z += 1.7) {
    for (let x = 10; x < world.width - 10; x += 1.7) {
      const px = x + (rng() - 0.5) * 1.35;
      const pz = z + (rng() - 0.5) * 1.35;
      const path = surfaces.path(px, pz);
      if (path < 0.1 || blockedSolid(world, px, pz)) {
        continue;
      }
      const edge = path < 0.42;
      if (edge && rng() > 0.38) {
        continue;
      }
      if (!edge && rng() > 0.72) {
        continue;
      }
      const mossy = rng() < 0.18;
      const stamp: Stamp = {
        x: px,
        z: pz,
        yaw: rng() * Math.PI * 2,
        sx: 0.82 + rng() * 0.45,
        sy: 0.7 + rng() * 0.55,
        sz: 0.78 + rng() * 0.5,
        color: mossy ? 0x6a7a48 : rng() < 0.5 ? 0x8a6d4c : 0x6d5640,
      };
      if (edge) {
        chips.push(stamp);
      } else if (rng() < 0.55) {
        pavers.push(stamp);
      } else {
        cobbles.push(stamp);
      }
    }
  }
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, fog: true });
  const sphere = new THREE.Sphere(
    new THREE.Vector3(world.width * 0.5, 0.15, world.height * 0.5),
    Math.hypot(world.width, world.height) * 0.55,
  );
  addStamped(root, "path-paver", new THREE.BoxGeometry(1.35, 0.2, 1.05), mat, pavers, COBBLE_Y + 0.06, sphere, true);
  addStamped(
    root,
    "path-cobble",
    new THREE.DodecahedronGeometry(0.58, 0),
    mat,
    cobbles,
    COBBLE_Y + 0.05,
    sphere,
    true,
  );
  addStamped(
    root,
    "path-chip",
    new THREE.IcosahedronGeometry(0.32, 0),
    mat,
    chips,
    COBBLE_Y + 0.04,
    sphere,
    true,
  );
}

function addVillageNature(root: THREE.Group, world: World, surfaces: SurfaceFns, assets: NatureAssets): void {
  const rng = mulberry32(NATURE_SEED);
  const treesA: Stamp[] = [];
  const treesB: Stamp[] = [];
  const bushes: Stamp[] = [];

  for (let z = 22; z < world.height - 22; z += 36) {
    for (let x = 22; x < world.width - 22; x += 36) {
      const px = x + (rng() - 0.5) * 22;
      const pz = z + (rng() - 0.5) * 22;
      if (!canPlaceNature(world, px, pz, surfaces, "tree")) {
        continue;
      }
      const dens = natureDensity(world, px, pz, surfaces);
      if (dens < 0.2 || rng() > dens * 0.14) {
        continue;
      }
      const kind = rng();
      const s = 0.22 + rng() * 0.12;
      const stamp: Stamp = {
        x: px,
        z: pz,
        yaw: rng() * Math.PI * 2,
        sx: s * (0.92 + rng() * 0.14),
        sy: s * (0.88 + rng() * 0.2),
        sz: s * (0.92 + rng() * 0.14),
      };
      if (kind < 0.62) {
        treesA.push(stamp);
      } else {
        treesB.push(stamp);
      }
    }
  }

  if (assets.bush) {
    for (let z = 16; z < world.height - 16; z += 16) {
      for (let x = 16; x < world.width - 16; x += 16) {
        const px = x + (rng() - 0.5) * 12;
        const pz = z + (rng() - 0.5) * 12;
        if (!canPlaceNature(world, px, pz, surfaces, "bush")) {
          continue;
        }
        const dens = natureDensity(world, px, pz, surfaces);
        const near = structProximity(world, px, pz);
        const chance = near > 0.75 ? dens * 0.08 : dens * 0.16;
        if (rng() > chance) {
          continue;
        }
        const s = 0.52 + rng() * 0.34;
        bushes.push({
          x: px,
          z: pz,
          yaw: rng() * Math.PI * 2,
          sx: s * (0.9 + rng() * 0.18),
          sy: s * (0.82 + rng() * 0.28),
          sz: s * (0.9 + rng() * 0.18),
        });
      }
    }
  }

  const sphere = new THREE.Sphere(
    new THREE.Vector3(world.width * 0.5, 8, world.height * 0.5),
    Math.hypot(world.width, world.height) * 0.55,
  );
  addNatureStamped(root, "village-tree-a", assets.trees.a, treesA, sphere, true);
  addNatureStamped(root, "village-tree-b", assets.trees.b, treesB, sphere, true);
  if (assets.bush) {
    addNatureStamped(root, "village-bush", assets.bush, bushes, sphere, false);
  }
}

function natureDensity(world: World, x: number, z: number, surfaces: SurfaceFns): number {
  if (surfaces.path(x, z) > 0.12 || surfaces.dirt(x, z) > 0.55) {
    return 0;
  }
  const near = structProximity(world, x, z);
  const edge = Math.min(x, z, world.width - x, world.height - z);
  let dens = 0.38;
  if (near > 0.78) {
    dens = 0.12;
  } else if (near > 0.55) {
    dens = 0.22;
  }
  if (edge < 64 && near < 0.62) {
    dens = Math.max(dens, 0.72);
  }
  if (surfaces.dirt(x, z) > 0.18 && surfaces.dirt(x, z) < 0.42) {
    dens = Math.max(dens * 0.5, 0.16);
  }
  return dens;
}

function canPlaceNature(
  world: World,
  x: number,
  z: number,
  surfaces: SurfaceFns,
  kind: "tree" | "bush",
): boolean {
  if (blockedSolid(world, x, z) || inKeepClear(x, z, kind === "tree" ? 20 : 14)) {
    return false;
  }
  if (surfaces.path(x, z) > (kind === "tree" ? 0.08 : 0.12)) {
    return false;
  }
  if (nearDoor(world, x, z, kind === "tree" ? 26 : 18)) {
    return false;
  }
  for (const poi of world.pois) {
    const clear = poi.kind === "fountain" ? poi.radius + 16 : poi.radius + 10;
    if (Math.hypot(x - poi.x, z - poi.y) < clear) {
      return false;
    }
  }
  const pad = kind === "tree" ? 10 : 6;
  for (const house of world.houses) {
    if (x > house.x - pad && z > house.y - pad && x < house.x + house.w + pad && z < house.y + house.h + pad) {
      return false;
    }
  }
  for (const roof of extraRoofs(world)) {
    if (x > roof.x - 6 && z > roof.y - 6 && x < roof.x + roof.w + 6 && z < roof.y + roof.h + 6) {
      return false;
    }
  }
  return true;
}

function addNatureStamped(
  root: THREE.Group,
  name: string,
  proto: { geometry: THREE.BufferGeometry; material: THREE.Material; height: number },
  stamps: Stamp[],
  sphere: THREE.Sphere,
  castShadow: boolean,
): void {
  if (stamps.length === 0) {
    return;
  }
  const geo = proto.geometry.clone();
  const mesh = new THREE.InstancedMesh(geo, proto.material, stamps.length);
  mesh.name = name;
  mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  mesh.castShadow = castShadow;
  mesh.receiveShadow = true;
  mesh.frustumCulled = true;
  mesh.boundingSphere = sphere;
  const dummy = new THREE.Object3D();
  const phases = new Float32Array(stamps.length);
  stamps.forEach((stamp, i) => {
    dummy.position.set(stamp.x, 0, stamp.z);
    dummy.rotation.set(0, stamp.yaw, 0);
    dummy.scale.set(stamp.sx, stamp.sy, stamp.sz);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    phases[i] = stamp.yaw;
  });
  if (proto.material.userData.wind) {
    geo.setAttribute("windPhase", new THREE.InstancedBufferAttribute(phases, 1));
  }
  mesh.instanceMatrix.needsUpdate = true;
  root.add(mesh);
}

function addStamped(
  root: THREE.Group,
  name: string,
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  stamps: Stamp[],
  y: number,
  sphere: THREE.Sphere,
  instanceColor = false,
): void {
  if (stamps.length === 0) {
    geo.dispose();
    return;
  }
  const mesh = new THREE.InstancedMesh(geo, mat, stamps.length);
  mesh.name = name;
  mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.frustumCulled = true;
  mesh.boundingSphere = sphere;
  const dummy = new THREE.Object3D();
  const tint = new THREE.Color();
  stamps.forEach((stamp, i) => {
    dummy.position.set(stamp.x, y, stamp.z);
    dummy.rotation.set(0, stamp.yaw, 0);
    dummy.scale.set(stamp.sx, stamp.sy, stamp.sz);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    if (instanceColor) {
      tint.setHex(stamp.color ?? 0xffffff);
      mesh.setColorAt(i, tint);
    }
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (instanceColor && mesh.instanceColor) {
    mesh.instanceColor.needsUpdate = true;
  }
  root.add(mesh);
}

function blockedSolid(world: World, x: number, z: number): boolean {
  for (const house of world.houses) {
    if (x > house.x && z > house.y && x < house.x + house.w && z < house.y + house.h) {
      return true;
    }
  }
  for (const roof of extraRoofs(world)) {
    if (x > roof.x && z > roof.y && x < roof.x + roof.w && z < roof.y + roof.h) {
      return true;
    }
  }
  for (const rect of world.cover) {
    if (x > rect.x - 1 && z > rect.y - 1 && x < rect.x + rect.w + 1 && z < rect.y + rect.h + 1) {
      return true;
    }
  }
  for (const poi of world.pois) {
    const extra = poi.kind === "fountain" ? 3 : 2;
    if (Math.hypot(x - poi.x, z - poi.y) < poi.radius + extra) {
      return true;
    }
  }
  return false;
}

function nearDoor(world: World, x: number, z: number, radius: number): boolean {
  for (const house of world.houses) {
    const door = doorAnchor(house);
    if (Math.hypot(x - door.x, z - door.y) < radius) {
      return true;
    }
  }
  return false;
}

function inKeepClear(x: number, z: number, extra = 0): boolean {
  for (const spot of PLAY_CLEARS) {
    if (Math.hypot(x - spot.x, z - spot.y) < spot.r + extra * 0.15) {
      return true;
    }
  }
  return false;
}

function structProximity(world: World, x: number, z: number): number {
  let best = 1;
  for (const house of world.houses) {
    const cx = clamp(x, house.x, house.x + house.w);
    const cz = clamp(z, house.y, house.y + house.h);
    const d = Math.hypot(x - cx, z - cz);
    best = Math.min(best, 1 - smoothstep(8, 48, d));
  }
  for (const roof of extraRoofs(world)) {
    const cx = clamp(x, roof.x, roof.x + roof.w);
    const cz = clamp(z, roof.y, roof.y + roof.h);
    const d = Math.hypot(x - cx, z - cz);
    best = Math.min(best, 1 - smoothstep(8, 40, d));
  }
  return best;
}

function perimeterPoint(x: number, y: number, w: number, h: number, t: number): { x: number; y: number } {
  const per = (w + h) * 2;
  let d = ((t % 1) + 1) % 1 * per;
  if (d < w) {
    return { x: x + d, y };
  }
  d -= w;
  if (d < h) {
    return { x: x + w, y: y + d };
  }
  d -= h;
  if (d < w) {
    return { x: x + w - d, y: y + h };
  }
  d -= w;
  return { x, y: y + h - d };
}

function buildCoverageGeometry(
  minX: number,
  minZ: number,
  maxX: number,
  maxZ: number,
  cell: number,
  sample: (x: number, z: number) => number,
  y: number,
  tile: number,
): THREE.BufferGeometry | null {
  const cols = Math.floor((maxX - minX) / cell) + 1;
  const rows = Math.floor((maxZ - minZ) / cell) + 1;
  const cov = new Float32Array(cols * rows);
  for (let j = 0; j < rows; j++) {
    const z = minZ + j * cell;
    for (let i = 0; i < cols; i++) {
      cov[j * cols + i] = sample(minX + i * cell, z);
    }
  }

  const positions: number[] = [];
  const uvs: number[] = [];
  const covers: number[] = [];
  const indices: number[] = [];
  const vertAt = new Int32Array(cols * rows).fill(-1);
  const eps = 0.018;

  const vert = (i: number, j: number): number => {
    const slot = j * cols + i;
    if (vertAt[slot] >= 0) {
      return vertAt[slot];
    }
    const x = minX + i * cell;
    const z = minZ + j * cell;
    const idx = positions.length / 3;
    positions.push(x, y, z);
    uvs.push(x / tile, z / tile);
    covers.push(cov[slot]);
    vertAt[slot] = idx;
    return idx;
  };

  for (let j = 0; j < rows - 1; j++) {
    for (let i = 0; i < cols - 1; i++) {
      const c00 = cov[j * cols + i];
      const c10 = cov[j * cols + i + 1];
      const c01 = cov[(j + 1) * cols + i];
      const c11 = cov[(j + 1) * cols + i + 1];
      if (c00 < eps && c10 < eps && c01 < eps && c11 < eps) {
        continue;
      }
      const a = vert(i, j);
      const b = vert(i + 1, j);
      const c = vert(i, j + 1);
      const d = vert(i + 1, j + 1);
      indices.push(a, c, b, b, c, d);
    }
  }
  if (indices.length === 0) {
    return null;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setAttribute("cover", new THREE.Float32BufferAttribute(covers, 1));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function makeOverlayMaterial(tint: number): THREE.MeshLambertMaterial {
  const mat = new THREE.MeshLambertMaterial({
    color: tint,
    transparent: true,
    opacity: 1,
    alphaTest: 0.05,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    fog: true,
  });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
attribute float cover;
varying float vCover;`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
vCover = cover;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
varying float vCover;`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
diffuseColor.a *= vCover;`,
      );
  };
  mat.customProgramCacheKey = () => "boli-ground-overlay";
  return mat;
}

function loadGroundTextures(): Promise<{ grass: THREE.Texture; dirt: THREE.Texture; cobble: THREE.Texture }> {
  const loader = new THREE.TextureLoader();
  const load = (url: string) =>
    new Promise<THREE.Texture>((resolve, reject) => {
      loader.load(
        url,
        (tex) => {
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.wrapS = THREE.RepeatWrapping;
          tex.wrapT = THREE.RepeatWrapping;
          tex.anisotropy = 4;
          tex.generateMipmaps = true;
          tex.minFilter = THREE.LinearMipmapLinearFilter;
          tex.magFilter = THREE.LinearFilter;
          tex.needsUpdate = true;
          resolve(tex);
        },
        undefined,
        reject,
      );
    });
  return Promise.all([load(GRASS_URL), load(DIRT_URL), load(COBBLE_URL)]).then(([grass, dirt, cobble]) => ({
    grass,
    dirt,
    cobble,
  }));
}

function sdRoundRect(px: number, py: number, x: number, y: number, w: number, h: number, rad: number): number {
  const cx = x + w * 0.5;
  const cy = y + h * 0.5;
  const hx = w * 0.5;
  const hy = h * 0.5;
  const r = Math.min(rad, hx, hy);
  const dx = Math.abs(px - cx) - (hx - r);
  const dy = Math.abs(py - cy) - (hy - r);
  const ox = Math.max(dx, 0);
  const oy = Math.max(dy, 0);
  return Math.hypot(ox, oy) + Math.min(Math.max(dx, dy), 0) - r;
}

function sdCapsule(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy || 1;
  const t = clamp(((px - ax) * dx + (py - ay) * dy) / len2, 0, 1);
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

function valueNoise(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy);
  const b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1);
  const d = hash2(ix + 1, iy + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function hash2(ix: number, iy: number): number {
  const n = Math.sin(ix * 127.1 + iy * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / Math.max(0.0001, e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
