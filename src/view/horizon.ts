import * as THREE from "three";
import { FOREST_EXTENT } from "./forest";

/** Visual backdrop sits just behind the last trees, outside the playable wall. */
export const HORIZON_MARGIN = FOREST_EXTENT + 28;

/**
 * Top stays at y=80 (72 + previous lift of 8). The wall was floating at y=8,
 * which left a sky gap under the bricks at the ground horizon. It now starts
 * slightly below the floor so that seam is sealed.
 */
const WALL_HEIGHT = 90;
const WALL_BASE_Y = -10;
const BATTLEMENT = 7;
const MERLON_SPAN = 16;
const MERLON_GAP = 10;
const BRICK_W = 9;
const BRICK_H = 4.5;
const CORNER_RADIUS = 110;
const CORNER_SEGS = 10;

export type HorizonRig = {
  layout: (width: number, height: number) => void;
  sync: (fog: THREE.Color, horizon: THREE.Color) => void;
};

export function createHorizonBackdrop(scene: THREE.Scene): HorizonRig {
  const map = makeBrickTexture();
  const material = new THREE.MeshLambertMaterial({
    map,
    color: 0xf2d2c0,
    fog: true,
    side: THREE.DoubleSide,
  });

  const root = new THREE.Group();
  root.name = "horizon-backdrop";
  root.position.y = WALL_BASE_Y;
  scene.add(root);

  let mesh: THREE.Mesh | null = null;

  function layout(width: number, height: number): void {
    if (mesh) {
      root.remove(mesh);
      mesh.geometry.dispose();
      mesh = null;
    }
    mesh = new THREE.Mesh(makeRoundedWall(width, height, HORIZON_MARGIN, WALL_HEIGHT), material);
    mesh.frustumCulled = false;
    root.add(mesh);
  }

  function sync(_fog: THREE.Color, _horizon: THREE.Color): void {
    /* Brick albedo stays put; scene fog handles distance. */
  }

  return { layout, sync };
}

function makeRoundedWall(width: number, height: number, margin: number, wallH: number): THREE.BufferGeometry {
  const ring = roundedRectRing(width, height, margin, CORNER_RADIUS, CORNER_SEGS);
  const n = ring.length;
  const positions = new Float32Array(n * 2 * 3);
  const uvs = new Float32Array(n * 2 * 2);
  const indices: number[] = [];
  const dist = ringDistances(ring);

  for (let i = 0; i < n; i++) {
    const p = ring[i];
    const merlon = dist[i] % (MERLON_SPAN + MERLON_GAP) < MERLON_SPAN ? BATTLEMENT : 0;
    const i0 = i * 2;
    positions[i0 * 3] = p.x;
    positions[i0 * 3 + 1] = 0;
    positions[i0 * 3 + 2] = p.y;
    positions[(i0 + 1) * 3] = p.x;
    positions[(i0 + 1) * 3 + 1] = wallH + merlon;
    positions[(i0 + 1) * 3 + 2] = p.y;
    const u = dist[i] / BRICK_W;
    uvs[i0 * 2] = u;
    uvs[i0 * 2 + 1] = 0;
    uvs[(i0 + 1) * 2] = u;
    uvs[(i0 + 1) * 2 + 1] = (wallH + merlon) / BRICK_H;
  }

  for (let i = 0; i < n - 1; i++) {
    const a = i * 2;
    const b = a + 1;
    const c = a + 2;
    const d = a + 3;
    indices.push(a, b, c, b, d, c);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function ringDistances(ring: THREE.Vector2[]): number[] {
  const dist = new Array<number>(ring.length);
  dist[0] = 0;
  for (let i = 1; i < ring.length; i++) {
    dist[i] = dist[i - 1] + ring[i].distanceTo(ring[i - 1]);
  }
  return dist;
}

function roundedRectRing(
  width: number,
  height: number,
  margin: number,
  radius: number,
  cornerSegs: number,
): THREE.Vector2[] {
  const x0 = -margin;
  const z0 = -margin;
  const x1 = width + margin;
  const z1 = height + margin;
  const r = Math.min(radius, (x1 - x0) * 0.22, (z1 - z0) * 0.22);
  const pts: THREE.Vector2[] = [];

  const line = (ax: number, az: number, bx: number, bz: number, n: number) => {
    for (let i = 0; i < n; i++) {
      const t = i / n;
      pts.push(new THREE.Vector2(ax + (bx - ax) * t, az + (bz - az) * t));
    }
  };
  const arc = (cx: number, cz: number, a0: number, a1: number) => {
    for (let i = 0; i <= cornerSegs; i++) {
      const a = a0 + (a1 - a0) * (i / cornerSegs);
      pts.push(new THREE.Vector2(cx + Math.cos(a) * r, cz + Math.sin(a) * r));
    }
  };

  line(x0 + r, z0, x1 - r, z0, 14);
  arc(x1 - r, z0 + r, -Math.PI / 2, 0);
  line(x1, z0 + r, x1, z1 - r, 12);
  arc(x1 - r, z1 - r, 0, Math.PI / 2);
  line(x1 - r, z1, x0 + r, z1, 14);
  arc(x0 + r, z1 - r, Math.PI / 2, Math.PI);
  line(x0, z1 - r, x0, z0 + r, 12);
  arc(x0 + r, z0 + r, Math.PI, Math.PI * 1.5);
  pts.push(pts[0].clone());
  return pts;
}

function makeBrickTexture(): THREE.CanvasTexture {
  const w = 256;
  const h = 128;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return new THREE.CanvasTexture(canvas);
  }

  const mortar = "#4a342c";
  const bricks = ["#c57a58", "#d08a66", "#b86c4c", "#c9866a", "#be7454", "#db9674"];
  const joint = 3;
  const brickW = 32;
  const brickH = 16;

  ctx.fillStyle = mortar;
  ctx.fillRect(0, 0, w, h);

  let row = 0;
  for (let y = 0; y < h; y += brickH) {
    const offset = row % 2 === 0 ? 0 : brickW * 0.5;
    for (let x = -brickW; x < w + brickW; x += brickW) {
      const px = Math.floor(x + offset);
      const py = y;
      const bw = brickW - joint;
      const bh = brickH - joint;
      const seed = hash2(px, py);
      ctx.fillStyle = bricks[seed % bricks.length];
      ctx.fillRect(px, py, bw, bh);
      ctx.fillStyle = "rgba(255, 230, 210, 0.18)";
      ctx.fillRect(px, py, bw, 2);
      ctx.fillStyle = "rgba(70, 32, 24, 0.22)";
      ctx.fillRect(px, py + bh - 2, bw, 2);
      ctx.fillRect(px + bw - 2, py, 2, bh);
      if (seed % 7 === 0) {
        ctx.fillStyle = "rgba(90, 40, 30, 0.16)";
        ctx.fillRect(px + 4, py + 5, 6, 3);
      }
    }
    row += 1;
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

function hash2(x: number, y: number): number {
  const n = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
  return (n ^ (n >>> 13)) >>> 0;
}
