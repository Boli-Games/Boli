import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { mulberry32 } from "../sim/rng";
import { VIEW, type World } from "../sim/types";

/** Reference oak fence: post is 1 module tall, half a Boli. */
const POST_H = VIEW.bodyHeight * 0.5;
const UNIT = POST_H;
const POST_W = UNIT * (4 / 16);
const RAIL_H = UNIT * (3 / 16);
const RAIL_D = UNIT * (2 / 16);
const RAIL_Y0 = UNIT * (7.5 / 16);
const RAIL_Y1 = UNIT * (13.5 / 16);
const SPACING = UNIT;
const SINK = 0.06;
const FENCE_SEED = 0xfe4ce;

type Stamp = { x: number; z: number; yaw: number; sy: number };

export function addBoundaryFence(root: THREE.Group, world: World): void {
  /** Sit just inside the map, where the player's body meets the invisible wall. */
  const inset = 1.7;
  const x0 = inset;
  const z0 = inset;
  const x1 = world.width - inset;
  const z1 = world.height - inset;
  const rng = mulberry32(FENCE_SEED);
  const posts: Stamp[] = [];
  const rails: Stamp[] = [];

  const sides: { ax: number; az: number; bx: number; bz: number; yaw: number }[] = [
    { ax: x0, az: z0, bx: x1, bz: z0, yaw: 0 },
    { ax: x1, az: z0, bx: x1, bz: z1, yaw: Math.PI / 2 },
    { ax: x1, az: z1, bx: x0, bz: z1, yaw: Math.PI },
    { ax: x0, az: z1, bx: x0, bz: z0, yaw: -Math.PI / 2 },
  ];

  sides.forEach((side, sideIndex) => {
    const dx = side.bx - side.ax;
    const dz = side.bz - side.az;
    const len = Math.hypot(dx, dz);
    const n = Math.max(1, Math.round(len / SPACING));
    const ux = dx / len;
    const uz = dz / len;
    for (let i = 0; i <= n; i++) {
      const isStart = i === 0;
      const isEnd = i === n;
      const skipCorner = (isStart && sideIndex > 0) || (isEnd && sideIndex === sides.length - 1);
      if (!skipCorner) {
        posts.push({
          x: side.ax + ux * len * (i / n) + (rng() - 0.5) * 0.1,
          z: side.az + uz * len * (i / n) + (rng() - 0.5) * 0.1,
          yaw: side.yaw + (rng() - 0.5) * 0.04,
          sy: 0.97 + rng() * 0.06,
        });
      }
      if (i === n) {
        continue;
      }
      if (!isStart && i !== n - 1 && rng() < 0.1) {
        continue;
      }
      rails.push({
        x: side.ax + ux * len * ((i + 0.5) / n),
        z: side.az + uz * len * ((i + 0.5) / n),
        yaw: side.yaw + (rng() - 0.5) * 0.012,
        sy: 1,
      });
    }
  });

  const mat = new THREE.MeshLambertMaterial({
    map: makeOakTexture(),
    color: 0xffffff,
    fog: true,
  });
  const sphere = new THREE.Sphere(
    new THREE.Vector3(world.width * 0.5, POST_H * 0.5, world.height * 0.5),
    Math.hypot(world.width, world.height) * 0.5 + 24,
  );
  const railLen = SPACING - POST_W * 0.72;
  addInstanced(root, "boundary-fence-post", makePostGeometry(), mat, posts, sphere);
  addInstanced(root, "boundary-fence-rail", makeRailGeometry(railLen), mat, rails, sphere);
}

function makePostGeometry(): THREE.BufferGeometry {
  const geo = new THREE.BoxGeometry(POST_W, POST_H, POST_W);
  geo.translate(0, POST_H * 0.5 - SINK, 0);
  return geo;
}

function makeRailGeometry(length: number): THREE.BufferGeometry {
  const lower = new THREE.BoxGeometry(length, RAIL_H, RAIL_D);
  lower.translate(0, RAIL_Y0 - SINK, 0);
  const upper = new THREE.BoxGeometry(length, RAIL_H, RAIL_D);
  upper.translate(0, RAIL_Y1 - SINK, 0);
  const merged = mergeGeometries([lower, upper], false);
  lower.dispose();
  upper.dispose();
  if (!merged) {
    throw new Error("No se pudo crear la barandilla");
  }
  return merged;
}

function addInstanced(
  root: THREE.Group,
  name: string,
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  stamps: Stamp[],
  sphere: THREE.Sphere,
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
  stamps.forEach((stamp, i) => {
    dummy.position.set(stamp.x, 0, stamp.z);
    dummy.rotation.set(0, stamp.yaw, 0);
    dummy.scale.set(1, stamp.sy, 1);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  root.add(mesh);
}

function makeOakTexture(): THREE.CanvasTexture {
  const n = 16;
  const canvas = document.createElement("canvas");
  canvas.width = n;
  canvas.height = n;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return new THREE.CanvasTexture(canvas);
  }
  const colors = ["#c4a05c", "#b38a48", "#d4b06c", "#9a7034", "#c9a862", "#8d632c", "#e0c07a", "#a57b3c"];
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const grain = hash2(x, y * 3);
      const strip = hash2(Math.floor(x * 0.55), y);
      ctx.fillStyle = colors[(grain + strip) % colors.length];
      ctx.fillRect(x, y, 1, 1);
    }
  }
  for (let x = 2; x < n; x += 4) {
    ctx.fillStyle = "rgba(80, 48, 18, 0.28)";
    ctx.fillRect(x, 0, 1, n);
  }
  ctx.fillStyle = "rgba(255, 230, 170, 0.16)";
  ctx.fillRect(0, 0, n, 1);
  ctx.fillStyle = "rgba(60, 32, 10, 0.22)";
  ctx.fillRect(n - 1, 0, 1, n);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

function hash2(x: number, y: number): number {
  const n = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
  return ((n ^ (n >>> 13)) >>> 0) % 8;
}
