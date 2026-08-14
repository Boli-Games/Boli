import * as THREE from "three";
import { mulberry32 } from "../sim/rng";
import type { House, Roof, World } from "../sim/types";
import { HORIZON_MARGIN } from "./horizon";

const GRASS_TILE = 8.2;
const DIRT_TILE = 9.4;
const COBBLE_TILE = 7.6;
const DIRT_Y = 0.016;
const COBBLE_Y = 0.03;
const PATH_FADE = 3.4;
const TUFT_SEED = 0x6ea55;

const GRASS_URL = "/textures/ground/grass.png";
const DIRT_URL = "/textures/ground/dirt.png";
const COBBLE_URL = "/textures/ground/cobble.png";

type Capsule = { ax: number; ay: number; bx: number; by: number; r: number };
type Ring = { x: number; y: number; R: number; halfW: number };
type Disk = { x: number; y: number; r: number };
type RectBlob = { kind: "rect"; x: number; y: number; w: number; h: number; rad: number; fade: number; noise: number };
type CircleBlob = { kind: "circle"; x: number; y: number; r: number; fade: number; noise: number };
type DirtBlob = RectBlob | CircleBlob;

type SurfaceFns = {
  dirt: (x: number, y: number) => number;
  path: (x: number, y: number) => number;
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

  const dirtMat = makeOverlayMaterial(0xe8d7b0);
  const dirtGeo = buildCoverageGeometry(
    -6,
    -6,
    world.width + 6,
    world.height + 6,
    3,
    (x, z) => {
      const d = surfaces.dirt(x, z);
      const p = surfaces.path(x, z);
      return d * (1 - p * 0.82);
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

  const cobbleMat = makeOverlayMaterial(0xf2efe4);
  const cobbleGeo = buildCoverageGeometry(
    -6,
    -6,
    world.width + 6,
    world.height + 6,
    2.2,
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

  const tufts = makeGrassTufts(world, surfaces);
  if (tufts) {
    root.add(tufts);
  }

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
      grassMat.color.setHex(0xffffff);
      grassMat.needsUpdate = true;
      dirtMat.map = maps.dirt;
      dirtMat.needsUpdate = true;
      cobbleMat.map = maps.cobble;
      cobbleMat.needsUpdate = true;
    })
    .catch((err) => {
      console.warn("No se pudieron cargar las texturas del suelo:", err);
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
      x: house.x - 16,
      y: house.y - 14,
      w: house.w + 34,
      h: house.h + 36,
      rad: 24,
      fade: 11,
      noise: 7.5,
    });
    const door = doorAnchor(house);
    blobs.push({
      kind: "circle",
      x: door.x + door.nx * 10,
      y: door.y + door.ny * 10,
      r: 20,
      fade: 9,
      noise: 5,
    });
    const corners = [
      { x: house.x - 6, y: house.y - 4 },
      { x: house.x + house.w + 8, y: house.y - 2 },
      { x: house.x - 8, y: house.y + house.h + 8 },
      { x: house.x + house.w + 10, y: house.y + house.h + 5 },
    ];
    for (const corner of corners) {
      blobs.push({
        kind: "circle",
        x: corner.x + (rng() - 0.5) * 12,
        y: corner.y + (rng() - 0.5) * 12,
        r: 16 + rng() * 9,
        fade: 8 + rng() * 3,
        noise: 5 + rng() * 2.5,
      });
    }
  }

  for (const roof of extraRoofs(world)) {
    blobs.push({
      kind: "rect",
      x: roof.x - 20,
      y: roof.y - 16,
      w: roof.w + 46,
      h: roof.h + 34,
      rad: 30,
      fade: 12,
      noise: 9,
    });
    blobs.push({
      kind: "circle",
      x: roof.x + roof.w * 0.2,
      y: roof.y + roof.h * 0.55,
      r: 36,
      fade: 11,
      noise: 7,
    });
  }

  const hillRamp = world.ramps.find((ramp) => !world.houses.some((house) => house.ramp === ramp));
  if (hillRamp) {
    blobs.push({
      kind: "circle",
      x: hillRamp.x + 18,
      y: hillRamp.y + hillRamp.h * 0.5,
      r: 30,
      fade: 10,
      noise: 6,
    });
  }

  const statue = world.pois.find((poi) => poi.kind === "statue");
  if (statue) {
    blobs.push({
      kind: "circle",
      x: statue.x + 2,
      y: statue.y - 1,
      r: 24,
      fade: 9,
      noise: 5.5,
    });
  }

  return blobs;
}

function pathNetworkFromWorld(world: World): { capsules: Capsule[]; rings: Ring[]; disks: Disk[] } {
  const capsules: Capsule[] = [];
  const rings: Ring[] = [];
  const disks: Disk[] = [];
  const hw = 6.7;

  const chain = (pts: { x: number; y: number }[], r = hw) => {
    for (let i = 0; i < pts.length - 1; i++) {
      capsules.push({ ax: pts[i].x, ay: pts[i].y, bx: pts[i + 1].x, by: pts[i + 1].y, r });
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
    rings.push({ x: fountain.x, y: fountain.y, R: ringR, halfW: 6.5 });

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
        6.4,
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
      6.3,
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
    d -= (valueNoise(x * 0.045 + 8.1, y * 0.045 + 3.4) - 0.5) * blob.noise;
    cover = Math.max(cover, 1 - smoothstep(0, blob.fade, d));
  }
  return cover;
}

function pathCoverage(
  x: number,
  y: number,
  net: { capsules: Capsule[]; rings: Ring[]; disks: Disk[] },
): number {
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
  d -= (valueNoise(x * 0.08, y * 0.08) - 0.5) * 1.55;
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

function makeGrassTufts(world: World, surfaces: SurfaceFns): THREE.InstancedMesh | null {
  const placements = scatterTufts(world, surfaces, mulberry32(TUFT_SEED));
  if (placements.length === 0) {
    return null;
  }
  const geo = makeTuftGeometry();
  const mat = new THREE.MeshLambertMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
    fog: true,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, placements.length);
  mesh.name = "ground-grass-tufts";
  mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.frustumCulled = true;
  mesh.boundingSphere = new THREE.Sphere(
    new THREE.Vector3(world.width * 0.5, 0.6, world.height * 0.5),
    Math.hypot(world.width, world.height) * 0.55,
  );
  const dummy = new THREE.Object3D();
  placements.forEach((place, i) => {
    dummy.position.set(place.x, 0.02, place.z);
    dummy.rotation.set(0, place.yaw, 0);
    dummy.scale.setScalar(place.scale);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}

function scatterTufts(
  world: World,
  surfaces: SurfaceFns,
  rng: () => number,
): { x: number; z: number; yaw: number; scale: number }[] {
  const placed: { x: number; z: number; yaw: number; scale: number }[] = [];
  const step = 28;
  for (let z = 16; z < world.height - 16; z += step) {
    for (let x = 16; x < world.width - 16; x += step) {
      if (rng() > 0.58) {
        continue;
      }
      const cx = x + (rng() - 0.5) * step * 0.65;
      const cz = z + (rng() - 0.5) * step * 0.65;
      if (blockedForTuft(world, cx, cz, surfaces)) {
        continue;
      }
      const count = 3 + Math.floor(rng() * 4);
      for (let i = 0; i < count; i++) {
        const ang = rng() * Math.PI * 2;
        const dist = rng() * 4.8;
        const tx = cx + Math.cos(ang) * dist;
        const tz = cz + Math.sin(ang) * dist;
        if (blockedForTuft(world, tx, tz, surfaces)) {
          continue;
        }
        placed.push({
          x: tx,
          z: tz,
          yaw: rng() * Math.PI * 2,
          scale: 0.72 + rng() * 0.78,
        });
      }
    }
  }
  return placed;
}

function blockedForTuft(world: World, x: number, z: number, surfaces: SurfaceFns): boolean {
  if (x < 10 || z < 10 || x > world.width - 10 || z > world.height - 10) {
    return true;
  }
  if (surfaces.path(x, z) > 0.2 || surfaces.dirt(x, z) > 0.4) {
    return true;
  }
  for (const house of world.houses) {
    if (x > house.x - 3 && z > house.y - 3 && x < house.x + house.w + 3 && z < house.y + house.h + 3) {
      return true;
    }
  }
  for (const roof of extraRoofs(world)) {
    if (x > roof.x && z > roof.y && x < roof.x + roof.w && z < roof.y + roof.h) {
      return true;
    }
  }
  return false;
}

function makeTuftGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  const normals: number[] = [];
  const tip = new THREE.Color(0xb4e24c);
  const mid = new THREE.Color(0x4c9a34);
  const base = new THREE.Color(0x1d5726);

  const blade = (yaw: number, lean: number, h: number, w: number) => {
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const hx = c * w * 0.5;
    const hz = s * w * 0.5;
    const topX = c * lean * h;
    const topZ = s * lean * h;
    const b1x = -hx;
    const b1z = -hz;
    const b2x = hx;
    const b2z = hz;
    const t1x = topX - hx * 0.12;
    const t1z = topZ - hz * 0.12;
    const t2x = topX + hx * 0.12;
    const t2z = topZ + hz * 0.12;
    pushTri(positions, colors, normals, b1x, 0, b1z, b2x, 0, b2z, t2x, h, t2z, base, base, tip);
    pushTri(positions, colors, normals, b1x, 0, b1z, t2x, h, t2z, t1x, h, t1z, base, tip, mid);
  };

  blade(0.15, 0.18, 1.05, 0.24);
  blade(1.05, 0.26, 0.7, 0.18);
  blade(2.2, 0.12, 1.22, 0.22);
  blade(3.4, 0.3, 0.58, 0.16);
  blade(4.55, 0.2, 0.92, 0.2);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geo.computeVertexNormals();
  return geo;
}

function pushTri(
  pos: number[],
  col: number[],
  _nor: number[],
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  cx: number,
  cy: number,
  cz: number,
  ca: THREE.Color,
  cb: THREE.Color,
  cc: THREE.Color,
): void {
  pos.push(ax, ay, az, bx, by, bz, cx, cy, cz);
  col.push(ca.r, ca.g, ca.b, cb.r, cb.g, cb.b, cc.r, cc.g, cc.b);
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
