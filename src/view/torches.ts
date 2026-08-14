import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { getQuality } from "../quality";
import { mulberry32 } from "../sim/rng";
import { houseDoor, pointInHouseInterior } from "../sim/approach";
import { circleHitsRect } from "../sim/world";
import { worldHour } from "../sim/worldClock";
import type { House, World } from "../sim/types";
import { dayAmountFromHour } from "./sky";

const TORCH_URL = "/models/props/ANTORCHA.glb";
const TORCH_SEED = 0xa701;
/** Native GLB height is ~1.89. Scale so a standing torch reaches ~60% of a Boli. */
const TARGET_HEIGHT = 9.6;
const LIGHT_COLOR = 0xffc48a;
const LIGHT_INTENSITY = 12;
const LIGHT_DISTANCE = 38;
const LIGHT_DECAY = 2;
const LIGHT_HEIGHT = TARGET_HEIGHT * 0.82;
const MIN_SPACING = 24;
const ASSIGN_INTERVAL = 0.32;

export type TorchRig = {
  layout: (world: World) => void;
  tick: (camera: THREE.Vector3, worldMinute: number, dt: number, paused: boolean) => void;
};

type TorchKind = "path" | "house" | "fountain" | "plaza" | "statue" | "cover";

type TorchPlace = {
  x: number;
  z: number;
  yaw: number;
  scale: number;
  phase: number;
  kind: TorchKind;
};

type TorchProto = {
  geometry: THREE.BufferGeometry;
  material: THREE.MeshLambertMaterial;
  height: number;
};

type PoolLight = {
  light: THREE.PointLight;
  torchIndex: number;
  mix: number;
};

const LANDMARK_PULL: Record<TorchKind, number> = {
  fountain: 70,
  plaza: 62,
  house: 46,
  statue: 28,
  cover: 10,
  path: 0,
};

let protoPromise: Promise<TorchProto> | null = null;

export function createTorches(scene: THREE.Scene): TorchRig {
  const root = new THREE.Group();
  root.name = "torches";
  scene.add(root);

  const lightsRoot = new THREE.Group();
  lightsRoot.name = "torch-lights";
  scene.add(lightsRoot);

  const pool: PoolLight[] = [];
  const maxLights = maxTorchLights();
  for (let i = 0; i < maxLights; i++) {
    const light = new THREE.PointLight(LIGHT_COLOR, 0, LIGHT_DISTANCE, LIGHT_DECAY);
    light.castShadow = false;
    light.visible = false;
    lightsRoot.add(light);
    pool.push({ light, torchIndex: -1, mix: 0 });
  }

  let proto: TorchProto | null = null;
  let mesh: THREE.InstancedMesh | null = null;
  let places: TorchPlace[] = [];
  let pending: World | null = null;
  let loadStarted = false;
  let animTime = 0;
  let assignAge = ASSIGN_INTERVAL;

  function layout(world: World): void {
    pending = world;
    if (!loadStarted) {
      loadStarted = true;
      void loadTorchPrototype()
        .then((loaded) => {
          proto = loaded;
          if (pending) {
            rebuild(pending);
          }
        })
        .catch((err) => {
          console.warn("No se pudo cargar la antorcha:", err);
        });
    } else if (proto) {
      rebuild(world);
    }
  }

  function rebuild(world: World): void {
    if (!proto) {
      return;
    }
    clearMesh();
    places = placeTorches(world);
    if (places.length === 0) {
      return;
    }
    mesh = makeInstanced(proto, places);
    root.add(mesh);
    console.info(`[torches] ${places.length} colocadas, máx. ${maxLights} PointLights`);
    for (const slot of pool) {
      slot.torchIndex = -1;
      slot.mix = 0;
      slot.light.intensity = 0;
      slot.light.visible = false;
    }
    assignAge = ASSIGN_INTERVAL;
  }

  function clearMesh(): void {
    if (!mesh) {
      return;
    }
    root.remove(mesh);
    mesh.geometry.dispose();
    mesh.dispose();
    mesh = null;
  }

  function tick(camera: THREE.Vector3, worldMinute: number, dt: number, paused: boolean): void {
    if (!paused) {
      animTime += dt;
    }
    if (proto) {
      const uniforms = proto.material.userData.flame as { time: { value: number } } | undefined;
      if (uniforms) {
        uniforms.time.value = animTime;
      }
    }
    const hour = worldHour(worldMinute);
    const amount = torchAmount(hour);
    if (places.length === 0 || amount < 0.02) {
      for (const slot of pool) {
        slot.mix = 0;
        slot.light.intensity = 0;
        slot.light.visible = false;
      }
      return;
    }
    assignAge += dt;
    if (assignAge >= ASSIGN_INTERVAL) {
      assignAge = 0;
      reassignPool(camera);
    }
    for (const slot of pool) {
      const place = slot.torchIndex >= 0 ? places[slot.torchIndex] : undefined;
      const want = place ? 1 : 0;
      slot.mix += (want - slot.mix) * Math.min(1, dt * 6);
      if (slot.mix < 0.02 || !place) {
        slot.light.intensity = 0;
        slot.light.visible = false;
        continue;
      }
      const flicker =
        0.9 +
        0.06 * Math.sin(animTime * 6.4 + place.phase) +
        0.04 * Math.sin(animTime * 11.7 + place.phase * 1.83);
      slot.light.position.set(place.x, LIGHT_HEIGHT, place.z);
      slot.light.intensity = LIGHT_INTENSITY * amount * slot.mix * flicker;
      slot.light.visible = true;
    }
  }

  function reassignPool(camera: THREE.Vector3): void {
    const ranked = places
      .map((place, index) => ({
        index,
        score: Math.hypot(place.x - camera.x, place.z - camera.z) - LANDMARK_PULL[place.kind],
      }))
      .sort((a, b) => a.score - b.score);
    const desired = ranked.slice(0, maxLights).map((item) => item.index);
    const desiredSet = new Set(desired);
    const used = new Set<number>();
    for (const slot of pool) {
      if (slot.torchIndex >= 0 && desiredSet.has(slot.torchIndex)) {
        used.add(slot.torchIndex);
      } else {
        slot.torchIndex = -1;
      }
    }
    for (const slot of pool) {
      if (slot.torchIndex >= 0) {
        continue;
      }
      const next = desired.find((index) => !used.has(index));
      if (next == null) {
        break;
      }
      slot.torchIndex = next;
      slot.mix = 0;
      used.add(next);
    }
  }

  return { layout, tick };
}

function maxTorchLights(): number {
  const tier = getQuality().tier;
  if (tier === "mobile-low") {
    return 3;
  }
  if (tier === "mobile") {
    return 5;
  }
  return 8;
}

/** Inverse of sky day amount, so dusk/dawn share the same windows as the sky. */
function torchAmount(hour: number): number {
  return clamp01(1 - dayAmountFromHour(hour));
}

function loadTorchPrototype(): Promise<TorchProto> {
  if (!protoPromise) {
    protoPromise = bakeTorch();
  }
  return protoPromise;
}

async function bakeTorch(): Promise<TorchProto> {
  const gltf = await new GLTFLoader().loadAsync(TORCH_URL);
  const mesh = findMesh(gltf.scene);
  if (!mesh) {
    throw new Error("El GLB de la antorcha no tiene malla");
  }
  gltf.scene.updateWorldMatrix(true, true);
  const geometry = mesh.geometry.clone();
  geometry.applyMatrix4(mesh.matrixWorld);
  geometry.deleteAttribute("tangent");
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  if (!box) {
    throw new Error("La antorcha no tiene bounding box");
  }
  const size = new THREE.Vector3();
  box.getSize(size);
  const midX = (box.min.x + box.max.x) * 0.5;
  const midZ = (box.min.z + box.max.z) * 0.5;
  const scale = TARGET_HEIGHT / Math.max(size.y, 0.001);
  geometry.applyMatrix4(
    new THREE.Matrix4()
      .makeScale(scale, scale, scale)
      .multiply(new THREE.Matrix4().makeTranslation(-midX, -box.min.y, -midZ)),
  );
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.computeVertexNormals();

  const src = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  return {
    geometry,
    material: toTorchLambert(src),
    height: TARGET_HEIGHT,
  };
}

function findMesh(root: THREE.Object3D): THREE.Mesh | null {
  let found: THREE.Mesh | null = null;
  root.traverse((obj) => {
    const candidate = obj as THREE.Mesh;
    if (!found && candidate.isMesh && candidate.geometry) {
      found = candidate;
    }
  });
  return found;
}

function toTorchLambert(src: THREE.Material): THREE.MeshLambertMaterial {
  const std = src as THREE.MeshStandardMaterial;
  const emissiveMap = std.emissiveMap ?? std.map ?? null;
  if (emissiveMap) {
    emissiveMap.colorSpace = THREE.SRGBColorSpace;
    emissiveMap.needsUpdate = true;
  }
  const material = new THREE.MeshLambertMaterial({
    color: 0x000000,
    emissive: 0xffffff,
    emissiveMap,
    emissiveIntensity: 1,
    fog: true,
    side: THREE.DoubleSide,
  });
  applyFlameWobble(material);
  return material;
}

function applyFlameWobble(material: THREE.MeshLambertMaterial): void {
  const uniforms = { time: { value: 0 } };
  material.userData.flame = uniforms;
  const flameY = (TARGET_HEIGHT * 0.58).toFixed(3);
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uFlameTime = uniforms.time;
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
attribute float flamePhase;
uniform float uFlameTime;`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
float flame = smoothstep(${flameY}, ${flameY} + 1.35, transformed.y);
float ft = uFlameTime * 5.1 + flamePhase;
float wobble = sin(ft) * 0.045 + sin(ft * 1.73 + 1.1) * 0.028;
transformed.x += wobble * flame * transformed.x;
transformed.z += (cos(ft * 0.91) * 0.04 + sin(ft * 2.2) * 0.02) * flame * transformed.z;
transformed.y += sin(ft * 2.05) * 0.11 * flame;`,
      );
  };
  material.customProgramCacheKey = () => "boli-torch-flame";
}

function makeInstanced(proto: TorchProto, list: TorchPlace[]): THREE.InstancedMesh {
  const geo = proto.geometry.clone();
  const phases = new Float32Array(list.length);
  const dummy = new THREE.Object3D();
  const mesh = new THREE.InstancedMesh(geo, proto.material, list.length);
  mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  mesh.name = "torch-instances";
  list.forEach((place, i) => {
    dummy.position.set(place.x, 0, place.z);
    dummy.rotation.set(0, place.yaw, 0);
    dummy.scale.setScalar(place.scale);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    phases[i] = place.phase;
  });
  geo.setAttribute("flamePhase", new THREE.InstancedBufferAttribute(phases, 1));
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}

function placeTorches(world: World): TorchPlace[] {
  const rng = mulberry32(TORCH_SEED);
  const list: TorchPlace[] = [];
  const fountain = world.pois.find((poi) => poi.kind === "fountain");
  const statue = world.pois.find((poi) => poi.kind === "statue");
  const plaza = world.pois.find((poi) => poi.kind === "plaza");
  const casita = world.houses.find((house) => house.id === "casita");
  const grande = world.houses.find((house) => house.id === "casa-grande");

  const add = (x: number, z: number, kind: TorchKind, yaw?: number) => {
    if (!canPlant(world, x, z, list, fountain)) {
      return;
    }
    list.push({
      x,
      z,
      yaw: yaw ?? rng() * Math.PI * 2,
      scale: 0.96 + rng() * 0.08,
      phase: rng() * Math.PI * 2,
      kind,
    });
  };

  if (casita) {
    plantHouseTorches(casita, add, rng);
  }
  if (grande) {
    plantHouseTorches(grande, add, rng);
  }

  if (fountain) {
    const ring = fountain.radius + 13.5;
    const angles = [0.38, 1.72, 3.55, 5.12];
    for (const angle of angles) {
      const jitter = (rng() - 0.5) * 0.18;
      const r = ring + (rng() - 0.5) * 2.4;
      add(fountain.x + Math.cos(angle + jitter) * r, fountain.y + Math.sin(angle + jitter) * r, "fountain", angle + Math.PI);
    }
  }

  if (plaza) {
    const ring = plaza.radius + 12.5;
    const angles = [0.22, 1.35, 2.55, 3.9, 5.35];
    for (const angle of angles) {
      const jitter = (rng() - 0.5) * 0.16;
      const r = ring + (rng() - 0.5) * 3.2;
      add(plaza.x + Math.cos(angle + jitter) * r, plaza.y + Math.sin(angle + jitter) * r, "plaza", angle + Math.PI);
    }
  }

  if (statue) {
    add(statue.x + 16 + rng() * 3, statue.y + 8 + rng() * 2, "statue", -0.4);
    add(statue.x - 14 - rng() * 2, statue.y + 11 + rng() * 2, "statue", 0.9);
  }

  for (const rect of world.cover) {
    add(rect.x - 8 + rng() * 2, rect.y + rect.h * 0.35 + rng() * 4, "cover");
    add(rect.x + rect.w + 7 + rng() * 2, rect.y + rect.h * 0.62 + rng() * 3, "cover");
  }

  const paths: { pts: { x: number; y: number }[]; spacing: number }[] = [];
  if (casita && fountain) {
    const door = houseDoor(casita);
    paths.push({
      pts: [
        { x: door.x + door.nx * 4, y: door.y + door.ny * 4 },
        { x: door.x + 8, y: door.y + 28 },
        { x: 210, y: 255 },
        { x: 268, y: 278 },
        { x: fountain.x - fountain.radius - 8, y: fountain.y + 2 },
      ],
      spacing: 58,
    });
  }
  if (grande && statue && fountain) {
    const door = houseDoor(grande);
    paths.push({
      pts: [
        { x: door.x + door.nx * 4, y: door.y + door.ny * 4 },
        { x: statue.x + 18, y: statue.y - 4 },
        { x: statue.x - 4, y: statue.y + 18 },
        { x: fountain.x + 8, y: fountain.y - fountain.radius - 8 },
      ],
      spacing: 62,
    });
  }
  if (fountain && plaza) {
    paths.push({
      pts: [
        { x: fountain.x + 22, y: fountain.y + fountain.radius * 0.72 },
        { x: 376, y: 332 },
        { x: 370, y: 392 },
        { x: plaza.x + 18, y: plaza.y - 22 },
        { x: plaza.x + 4, y: plaza.y },
      ],
      spacing: 60,
    });
  }
  if (plaza) {
    const hillRamp = world.ramps.find((ramp) => !world.houses.some((house) => house.ramp === ramp));
    if (hillRamp) {
      paths.push({
        pts: [
          { x: plaza.x + 10, y: plaza.y + 4 },
          { x: 358, y: 492 },
          { x: hillRamp.x + 8, y: hillRamp.y + hillRamp.h * 0.55 },
        ],
        spacing: 64,
      });
    }
  }
  if (grande) {
    const hill = world.roofs.find((roof) => !world.houses.some((house) => Math.abs(house.roofZ - roof.z) < 0.5));
    if (hill) {
      paths.push({
        pts: [
          { x: grande.x + grande.w * 0.42, y: grande.y + grande.h + 5 },
          { x: 632, y: 308 },
          { x: 648, y: 366 },
          { x: hill.x + 36, y: hill.y - 6 },
        ],
        spacing: 66,
      });
    }
  }

  for (const path of paths) {
    plantPathTorches(path.pts, path.spacing, add, rng);
  }

  add(382 + rng() * 4, 502 + rng() * 3, "path", 0.4);
  add(430 + rng() * 3, 456 + rng() * 4, "path", -0.2);

  return list;
}

function plantHouseTorches(
  house: House,
  add: (x: number, z: number, kind: TorchKind, yaw?: number) => void,
  rng: () => number,
): void {
  const door = houseDoor(house);
  const tx = -door.ny;
  const tz = door.nx;
  const out = 9.5 + rng() * 1.6;
  const flank = 18 + rng() * 3.5;
  add(door.x + door.nx * out - tx * flank, door.y + door.ny * out - tz * flank, "house", Math.atan2(door.nx, door.ny));
  add(
    door.x + door.nx * (out + 1.2) + tx * (flank + 1.5),
    door.y + door.ny * (out + 1.2) + tz * (flank + 1.5),
    "house",
    Math.atan2(door.nx, door.ny) + 0.08,
  );

  const pad = 8.5;
  const corners = [
    { x: house.x - pad + rng() * 2, z: house.y - pad + rng() * 2 },
    { x: house.x + house.w + pad + rng(), z: house.y - pad + rng() * 2 },
    { x: house.x - pad + rng() * 2, z: house.y + house.h + pad + rng() },
    { x: house.x + house.w + pad + rng(), z: house.y + house.h + pad + rng() },
  ];
  for (const corner of corners) {
    const dx = house.x + house.w * 0.5 - corner.x;
    const dz = house.y + house.h * 0.5 - corner.z;
    add(corner.x, corner.z, "house", Math.atan2(dx, dz));
  }
}

function plantPathTorches(
  pts: { x: number; y: number }[],
  spacing: number,
  add: (x: number, z: number, kind: TorchKind, yaw?: number) => void,
  rng: () => number,
): void {
  let leftover = 14 + rng() * 16;
  let side = rng() < 0.5 ? 1 : -1;
  for (let i = 0; i < pts.length - 1; i++) {
    const ax = pts[i].x;
    const az = pts[i].y;
    const bx = pts[i + 1].x;
    const bz = pts[i + 1].y;
    const dx = bx - ax;
    const dz = bz - az;
    const len = Math.hypot(dx, dz);
    if (len < 8) {
      leftover += len;
      continue;
    }
    const ux = dx / len;
    const uz = dz / len;
    const px = -uz;
    const pz = ux;
    let d = leftover;
    while (d < len - 10) {
      const along = d + (rng() - 0.5) * 5;
      const offset = (9.2 + rng() * 2.8) * side;
      const x = ax + ux * along + px * offset;
      const z = az + uz * along + pz * offset;
      add(x, z, "path", Math.atan2(ux, uz) + (rng() - 0.5) * 0.35);
      side = -side;
      d += spacing * (0.78 + rng() * 0.38);
    }
    leftover = d - len;
    if (leftover < 0) {
      leftover = 0;
    }
  }
}

function canPlant(
  world: World,
  x: number,
  z: number,
  list: TorchPlace[],
  fountain: { x: number; y: number; radius: number } | undefined,
): boolean {
  if (x < 14 || z < 14 || x > world.width - 14 || z > world.height - 14) {
    return false;
  }
  if (world.houses.some((house) => pointInHouseInterior(x, z, house))) {
    return false;
  }
  if (world.obstacles.some((rect) => circleHitsRect(x, z, 5.5, rect))) {
    return false;
  }
  if (fountain && Math.hypot(x - fountain.x, z - fountain.y) < fountain.radius + 5) {
    return false;
  }
  for (const other of list) {
    if (Math.hypot(x - other.x, z - other.z) < MIN_SPACING) {
      return false;
    }
  }
  return true;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
