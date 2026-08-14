/**
 * Rig Skin 2 and Skin 3 onto the shared boli-humanoid-v1 skeleton from Skin 1.
 * Does not rewrite Skin 1. Output: boli_skin2_rigged.glb, boli_skin3_rigged.glb
 */
import { inflateSync } from "node:zlib";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TARGET_HEIGHT = 1.8973909616470337;
const TRI_BUDGET = 7200;

const BONE_NAMES = [
  "Root", "Hips", "Spine", "Chest", "Neck", "Head",
  "LeftShoulder", "LeftUpperArm", "LeftLowerArm", "LeftHand",
  "RightShoulder", "RightUpperArm", "RightLowerArm", "RightHand",
  "WeaponSocket",
  "LeftUpperLeg", "LeftLowerLeg", "LeftFoot",
  "RightUpperLeg", "RightLowerLeg", "RightFoot",
];

const PARENT = {
  Root: null, Hips: "Root", Spine: "Hips", Chest: "Spine", Neck: "Chest", Head: "Neck",
  LeftShoulder: "Chest", LeftUpperArm: "LeftShoulder", LeftLowerArm: "LeftUpperArm", LeftHand: "LeftLowerArm",
  RightShoulder: "Chest", RightUpperArm: "RightShoulder", RightLowerArm: "RightUpperArm", RightHand: "RightLowerArm",
  WeaponSocket: "RightHand",
  LeftUpperLeg: "Hips", LeftLowerLeg: "LeftUpperLeg", LeftFoot: "LeftLowerLeg",
  RightUpperLeg: "Hips", RightLowerLeg: "RightUpperLeg", RightFoot: "RightLowerLeg",
};

const CHILDREN = {};
for (const [child, parent] of Object.entries(PARENT)) {
  if (parent) (CHILDREN[parent] ??= []).push(child);
}

const WORLD = JSON.parse(readFileSync(join(__dirname, "rig-validation.json"), "utf8")).world;
const LOCAL = {};
for (const name of BONE_NAMES) {
  const parent = PARENT[name];
  LOCAL[name] = parent
    ? [WORLD[name][0] - WORLD[parent][0], WORLD[name][1] - WORLD[parent][1], WORLD[name][2] - WORLD[parent][2]]
    : WORLD[name].slice();
}

const JOBS = [
  {
    skinId: "skin2",
    source: "c:\\Users\\valle\\Downloads\\banano_gay.glb",
    out: join(__dirname, "boli_skin2_rigged.glb"),
    roles: ["torso_head", "right_leg", "left_leg", "chest_front", "right_arm", "left_arm"],
  },
  {
    skinId: "skin3",
    source: "c:\\Users\\valle\\Downloads\\boli_granjero_pintao.glb",
    out: join(__dirname, "boli_skin3_rigged.glb"),
    roles: ["body", "head", "head_extra", "left_foot", "right_foot"],
  },
];

function parseGlb(buf) {
  const length = buf.readUInt32LE(8);
  let offset = 12;
  let json = null;
  let bin = null;
  while (offset < length) {
    const chunkLen = buf.readUInt32LE(offset);
    const type = buf.toString("ascii", offset + 4, offset + 8).replace(/\0/g, "");
    const start = offset + 8;
    const chunk = buf.subarray(start, start + chunkLen);
    if (type === "JSON") json = JSON.parse(chunk.toString("utf8"));
    if (type === "BIN") bin = chunk;
    offset = start + chunkLen;
  }
  return { json, bin };
}

function readAccessor(json, bin, index) {
  const acc = json.accessors[index];
  const view = json.bufferViews[acc.bufferView];
  const start = (view.byteOffset || 0) + (acc.byteOffset || 0);
  const typeCount = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[acc.type];
  const compBytes = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }[acc.componentType];
  const stride = view.byteStride || compBytes * typeCount;
  const out = [];
  for (let i = 0; i < acc.count; i++) {
    const o = start + i * stride;
    const row = [];
    for (let k = 0; k < typeCount; k++) {
      const p = o + k * compBytes;
      let v;
      if (acc.componentType === 5126) v = bin.readFloatLE(p);
      else if (acc.componentType === 5123) v = bin.readUInt16LE(p);
      else if (acc.componentType === 5125) v = bin.readUInt32LE(p);
      else if (acc.componentType === 5121) v = bin[p];
      else v = bin[p];
      row.push(v);
    }
    out.push(typeCount === 1 ? row[0] : row);
  }
  return out;
}

function decodePng(png) {
  if (png.toString("ascii", 1, 4) !== "PNG") throw new Error("not a png");
  let off = 8;
  let w = 0;
  let h = 0;
  let depth = 8;
  let ctype = 6;
  const idats = [];
  while (off + 12 <= png.length) {
    const len = png.readUInt32BE(off);
    const type = png.toString("ascii", off + 4, off + 8);
    const data = png.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      depth = data[8];
      ctype = data[9];
    } else if (type === "IDAT") {
      idats.push(data);
    } else if (type === "IEND") {
      break;
    }
    off += 12 + len;
  }
  if (depth !== 8) throw new Error(`png depth ${depth}`);
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[ctype];
  if (!channels) throw new Error(`png type ${ctype}`);
  const inflated = inflateSync(Buffer.concat(idats));
  const bpp = channels;
  const stride = w * bpp;
  const rgba = Buffer.alloc(w * h * 4);
  let src = 0;
  let prev = Buffer.alloc(stride);
  const paeth = (a, b, c) => {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  for (let y = 0; y < h; y++) {
    const filter = inflated[src++];
    const recon = Buffer.alloc(stride);
    for (let i = 0; i < stride; i++) {
      const raw = inflated[src + i];
      const left = i >= bpp ? recon[i - bpp] : 0;
      const up = prev[i];
      const upleft = i >= bpp ? prev[i - bpp] : 0;
      let v = raw;
      if (filter === 1) v = (raw + left) & 255;
      else if (filter === 2) v = (raw + up) & 255;
      else if (filter === 3) v = (raw + ((left + up) >> 1)) & 255;
      else if (filter === 4) v = (raw + paeth(left, up, upleft)) & 255;
      recon[i] = v;
    }
    src += stride;
    for (let x = 0; x < w; x++) {
      const di = (y * w + x) * 4;
      if (ctype === 2) {
        rgba[di] = recon[x * 3];
        rgba[di + 1] = recon[x * 3 + 1];
        rgba[di + 2] = recon[x * 3 + 2];
        rgba[di + 3] = 255;
      } else if (ctype === 6) {
        rgba[di] = recon[x * 4];
        rgba[di + 1] = recon[x * 4 + 1];
        rgba[di + 2] = recon[x * 4 + 2];
        rgba[di + 3] = recon[x * 4 + 3];
      } else if (ctype === 0) {
        rgba[di] = rgba[di + 1] = rgba[di + 2] = recon[x];
        rgba[di + 3] = 255;
      } else {
        rgba[di] = rgba[di + 1] = rgba[di + 2] = recon[x * 2];
        rgba[di + 3] = recon[x * 2 + 1];
      }
    }
    prev = recon;
  }
  return { w, h, rgba };
}

function samplePng(img, u, v) {
  const uu = ((u % 1) + 1) % 1;
  const vv = ((v % 1) + 1) % 1;
  const x = Math.min(img.w - 1, Math.max(0, Math.round(uu * (img.w - 1))));
  const y = Math.min(img.h - 1, Math.max(0, Math.round(vv * (img.h - 1))));
  const i = (y * img.w + x) * 4;
  return [img.rgba[i] / 255, img.rgba[i + 1] / 255, img.rgba[i + 2] / 255];
}

function flattenShade(rgb) {
  const l = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  const nl = l * 0.58 + 0.62 * 0.42;
  const scale = nl / Math.max(l, 0.06);
  const srgb = [
    Math.min(1, Math.max(0, rgb[0] * scale)),
    Math.min(1, Math.max(0, rgb[1] * scale)),
    Math.min(1, Math.max(0, rgb[2] * scale)),
  ];
  return srgb.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
}

function vadd(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function vsub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function vscale(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
function vdot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function vlen(a) { return Math.hypot(a[0], a[1], a[2]); }
function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
function smoothstep(e0, e1, x) {
  const t = clamp((x - e0) / Math.max(1e-8, e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}
function distToSegment(p, a, b) {
  const ab = vsub(b, a);
  const len2 = vdot(ab, ab) || 1e-8;
  const t = clamp(vdot(vsub(p, a), ab) / len2, 0, 1);
  return vlen(vsub(p, vadd(a, vscale(ab, t))));
}
function centroid(pts) {
  if (!pts.length) return [0, 0, 0];
  let x = 0, y = 0, z = 0;
  for (const p of pts) { x += p[0]; y += p[1]; z += p[2]; }
  return [x / pts.length, y / pts.length, z / pts.length];
}
function bounds(pts) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const p of pts) {
    for (let i = 0; i < 3; i++) {
      if (p[i] < min[i]) min[i] = p[i];
      if (p[i] > max[i]) max[i] = p[i];
    }
  }
  return { min, max, size: vsub(max, min), center: vscale(vadd(min, max), 0.5) };
}
function identityMat() { return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; }
function composeMat(t, q) {
  const [x, y, z, w] = q;
  const xx = x * x, yy = y * y, zz = z * z;
  const xy = x * y, xz = x * z, yz = y * z;
  const wx = w * x, wy = w * y, wz = w * z;
  return [
    1 - 2 * (yy + zz), 2 * (xy + wz), 2 * (xz - wy), 0,
    2 * (xy - wz), 1 - 2 * (xx + zz), 2 * (yz + wx), 0,
    2 * (xz + wy), 2 * (yz - wx), 1 - 2 * (xx + yy), 0,
    t[0], t[1], t[2], 1,
  ];
}
function mulMat(a, b) {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      o[c * 4 + r] =
        a[0 * 4 + r] * b[c * 4 + 0] +
        a[1 * 4 + r] * b[c * 4 + 1] +
        a[2 * 4 + r] * b[c * 4 + 2] +
        a[3 * 4 + r] * b[c * 4 + 3];
    }
  }
  return o;
}
function invertMat(m) {
  const n = m.slice();
  const inv = identityMat();
  for (let i = 0; i < 4; i++) {
    let pivot = i;
    for (let j = i + 1; j < 4; j++) {
      if (Math.abs(n[j * 4 + i]) > Math.abs(n[pivot * 4 + i])) pivot = j;
    }
    for (let k = 0; k < 4; k++) {
      const a = n[i * 4 + k]; n[i * 4 + k] = n[pivot * 4 + k]; n[pivot * 4 + k] = a;
      const b = inv[i * 4 + k]; inv[i * 4 + k] = inv[pivot * 4 + k]; inv[pivot * 4 + k] = b;
    }
    const d = n[i * 4 + i] || 1e-12;
    for (let k = 0; k < 4; k++) { n[i * 4 + k] /= d; inv[i * 4 + k] /= d; }
    for (let j = 0; j < 4; j++) {
      if (j === i) continue;
      const f = n[j * 4 + i];
      for (let k = 0; k < 4; k++) {
        n[j * 4 + k] -= f * n[i * 4 + k];
        inv[j * 4 + k] -= f * inv[i * 4 + k];
      }
    }
  }
  return inv;
}
function transformPoint(m, p) {
  const x = p[0], y = p[1], z = p[2];
  const w = m[3] * x + m[7] * y + m[11] * z + m[15] || 1;
  return [
    (m[0] * x + m[4] * y + m[8] * z + m[12]) / w,
    (m[1] * x + m[5] * y + m[9] * z + m[13]) / w,
    (m[2] * x + m[6] * y + m[10] * z + m[14]) / w,
  ];
}
function pad4(n) { return (n + 3) & ~3; }
function quatFromAxisAngle(axis, angle) {
  const n = vlen(axis) || 1;
  const s = Math.sin(angle / 2) / n;
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(angle / 2)];
}
function quatMul(a, b) {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

function loadTexturedMesh(path, roles) {
  const { json, bin } = parseGlb(readFileSync(path));
  const imgView = json.bufferViews[json.images[0].bufferView];
  const png = bin.subarray(imgView.byteOffset || 0, (imgView.byteOffset || 0) + imgView.byteLength);
  const img = decodePng(png);
  const positions = [];
  const normals = [];
  const colors = [];
  const sources = [];
  const rolesOut = [];
  const indices = [];
  json.meshes.forEach((mesh, mi) => {
    const prim = mesh.primitives[0];
    const pos = readAccessor(json, bin, prim.attributes.POSITION);
    const nrm = prim.attributes.NORMAL != null ? readAccessor(json, bin, prim.attributes.NORMAL) : pos.map(() => [0, 1, 0]);
    const uv = prim.attributes.TEXCOORD_0 != null ? readAccessor(json, bin, prim.attributes.TEXCOORD_0) : pos.map(() => [0, 0]);
    const idx = prim.indices != null ? readAccessor(json, bin, prim.indices) : [...Array(pos.length).keys()];
    const base = positions.length;
    const role = roles[mi] || "body";
    for (let i = 0; i < pos.length; i++) {
      positions.push(pos[i]);
      normals.push(nrm[i]);
      colors.push(flattenShade(samplePng(img, uv[i][0], uv[i][1])));
      sources.push(mi);
      rolesOut.push(role);
    }
    for (const i of idx) indices.push(base + i);
  });
  return { positions, normals, colors, sources, roles: rolesOut, indices, meshCount: json.meshes.length };
}

function transformMesh(mesh) {
  const b = bounds(mesh.positions);
  const height = b.size[1] || 1;
  const scale = TARGET_HEIGHT / height;
  const positions = mesh.positions.map((p) => [
    (p[0] - b.center[0]) * scale,
    (p[1] - b.min[1]) * scale,
    (p[2] - b.center[2]) * scale,
  ]);
  let headNz = 0;
  let headN = 0;
  for (let i = 0; i < positions.length; i++) {
    if (positions[i][1] > TARGET_HEIGHT * 0.78) {
      headNz += mesh.normals[i][2];
      headN += 1;
    }
  }
  if (headN > 0 && headNz / headN < -0.05) {
    for (let i = 0; i < positions.length; i++) {
      positions[i][0] *= -1;
      positions[i][2] *= -1;
      mesh.normals[i][0] *= -1;
      mesh.normals[i][2] *= -1;
    }
  }
  mesh.positions = positions;
  return mesh;
}

function clusterMesh(mesh, voxel) {
  const groups = new Map();
  const remap = new Array(mesh.positions.length);
  const cells = [];
  for (let i = 0; i < mesh.positions.length; i++) {
    const p = mesh.positions[i];
    const key = `${mesh.sources[i]}:${Math.round(p[0] / voxel)},${Math.round(p[1] / voxel)},${Math.round(p[2] / voxel)}`;
    let id = groups.get(key);
    if (id === undefined) {
      id = cells.length;
      groups.set(key, id);
      cells.push({
        p: p.slice(), n: mesh.normals[i].slice(), c: mesh.colors[i].slice(),
        src: mesh.sources[i], role: mesh.roles[i], count: 1,
      });
    } else {
      const cell = cells[id];
      cell.p = vadd(cell.p, p);
      cell.n = vadd(cell.n, mesh.normals[i]);
      cell.c = vadd(cell.c, mesh.colors[i]);
      cell.count += 1;
    }
    remap[i] = id;
  }
  const positions = [];
  const normals = [];
  const colors = [];
  const sources = [];
  const roles = [];
  for (const cell of cells) {
    const inv = 1 / cell.count;
    positions.push(vscale(cell.p, inv));
    const n = vscale(cell.n, inv);
    const nl = vlen(n) || 1;
    normals.push([n[0] / nl, n[1] / nl, n[2] / nl]);
    colors.push(vscale(cell.c, inv));
    sources.push(cell.src);
    roles.push(cell.role);
  }
  const indices = [];
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const a = remap[mesh.indices[t]];
    const b = remap[mesh.indices[t + 1]];
    const c = remap[mesh.indices[t + 2]];
    if (a === b || b === c || a === c) continue;
    indices.push(a, b, c);
  }
  return { positions, normals, colors, sources, roles, indices, meshCount: mesh.meshCount };
}

function decimate(mesh) {
  const start = mesh.indices.length / 3;
  let voxel = start > 40000 ? 0.042 : 0.024;
  let best = clusterMesh(mesh, voxel);
  for (let i = 0; i < 10; i++) {
    const tris = best.indices.length / 3;
    if (tris <= TRI_BUDGET && tris >= TRI_BUDGET * 0.55) break;
    voxel *= tris > TRI_BUDGET ? 1.18 : 0.86;
    best = clusterMesh(mesh, voxel);
  }
  console.log(`  decimate ${Math.round(start)} -> ${Math.round(best.indices.length / 3)} tris, verts ${best.positions.length}, voxel ${voxel.toFixed(3)}`);
  return smoothVertexNormals(best);
}

function smoothVertexNormals(mesh) {
  const { positions, indices } = mesh;
  const acc = positions.map(() => [0, 0, 0]);
  const eps = 0.0018;
  const buckets = new Map();
  for (let i = 0; i < positions.length; i++) {
    const p = positions[i];
    const key = `${Math.round(p[0] / eps)},${Math.round(p[1] / eps)},${Math.round(p[2] / eps)}`;
    let group = buckets.get(key);
    if (!group) {
      group = [];
      buckets.set(key, group);
    }
    group.push(i);
  }
  for (let t = 0; t < indices.length; t += 3) {
    const ia = indices[t];
    const ib = indices[t + 1];
    const ic = indices[t + 2];
    const a = positions[ia];
    const b = positions[ib];
    const c = positions[ic];
    const abx = b[0] - a[0];
    const aby = b[1] - a[1];
    const abz = b[2] - a[2];
    const acx = c[0] - a[0];
    const acy = c[1] - a[1];
    const acz = c[2] - a[2];
    const n = [aby * acz - abz * acy, abz * acx - abx * acz, abx * acy - aby * acx];
    for (const i of [ia, ib, ic]) {
      const p = positions[i];
      const key = `${Math.round(p[0] / eps)},${Math.round(p[1] / eps)},${Math.round(p[2] / eps)}`;
      for (const j of buckets.get(key)) {
        acc[j][0] += n[0];
        acc[j][1] += n[1];
        acc[j][2] += n[2];
      }
    }
  }
  mesh.normals = acc.map((n) => {
    const l = Math.hypot(n[0], n[1], n[2]) || 1;
    return [n[0] / l, n[1] / l, n[2] / l];
  });
  return mesh;
}

function heat(p, a, b, radius) {
  const d = distToSegment(p, a, b);
  if (d >= radius) return 0;
  const t = 1 - d / radius;
  return t * t;
}
function addWeight(map, name, w) {
  if (w > 0) map[name] = (map[name] || 0) + w;
}

function paintVertex(p, role, bones) {
  const w = {};
  const { world, tails } = bones;
  const x = p[0], y = p[1];
  const ax = Math.abs(x);
  const left = x < 0;
  addWeight(w, "Hips", heat(p, world.Hips, world.Spine, 0.28) * (y < 1.15 ? 1 : 0.2));
  addWeight(w, "Spine", heat(p, world.Spine, world.Chest, 0.30));
  addWeight(w, "Chest", heat(p, world.Chest, world.Neck, 0.32));
  addWeight(w, "Neck", heat(p, world.Neck, world.Head, 0.18));
  addWeight(w, "Head", heat(p, world.Head, tails.Head, 0.36));
  for (const side of ["Left", "Right"]) {
    addWeight(w, `${side}Shoulder`, heat(p, world[`${side}Shoulder`], world[`${side}UpperArm`], 0.16));
    addWeight(w, `${side}UpperArm`, heat(p, world[`${side}UpperArm`], world[`${side}LowerArm`], 0.16));
    addWeight(w, `${side}LowerArm`, heat(p, world[`${side}LowerArm`], world[`${side}Hand`], 0.14));
    addWeight(w, `${side}Hand`, heat(p, world[`${side}Hand`], tails[`${side}Hand`], 0.13));
    addWeight(w, `${side}UpperLeg`, heat(p, world.Hips, world[`${side}UpperLeg`], 0.18) * 0.35);
    addWeight(w, `${side}UpperLeg`, heat(p, world[`${side}UpperLeg`], world[`${side}LowerLeg`], 0.22));
    addWeight(w, `${side}LowerLeg`, heat(p, world[`${side}LowerLeg`], world[`${side}Foot`], 0.20));
    addWeight(w, `${side}Foot`, heat(p, world[`${side}Foot`], tails[`${side}Foot`], 0.16));
  }

  const keep = (pred) => {
    for (const k of Object.keys(w)) {
      if (!pred(k)) w[k] *= 0.03;
    }
  };

  if (role === "head" || role === "head_extra") {
    keep((k) => k === "Head" || k === "Neck");
    addWeight(w, "Head", y > 1.55 ? 4.2 : 1.6);
    addWeight(w, "Neck", y < 1.52 ? 1.8 : 0.2);
  } else if (role === "left_foot") {
    keep((k) => k === "LeftFoot" || k === "LeftLowerLeg");
    addWeight(w, "LeftFoot", 3.4);
    addWeight(w, "LeftLowerLeg", 0.6);
  } else if (role === "right_foot") {
    keep((k) => k === "RightFoot" || k === "RightLowerLeg");
    addWeight(w, "RightFoot", 3.4);
    addWeight(w, "RightLowerLeg", 0.6);
  } else if (role === "left_leg") {
    keep((k) => k.startsWith("Left") && (k.includes("Leg") || k.includes("Foot")) || k === "Hips");
    addWeight(w, "LeftUpperLeg", 1.6 * smoothstep(0.35, 0.85, y));
    addWeight(w, "LeftLowerLeg", 1.8 * (1 - smoothstep(0.45, 0.80, y)) * smoothstep(0.08, 0.45, y));
    addWeight(w, "LeftFoot", 2.6 * smoothstep(0.22, 0.02, y));
    addWeight(w, "Hips", 0.7 * smoothstep(0.55, 0.95, y));
  } else if (role === "right_leg") {
    keep((k) => k.startsWith("Right") && (k.includes("Leg") || k.includes("Foot")) || k === "Hips");
    addWeight(w, "RightUpperLeg", 1.6 * smoothstep(0.35, 0.85, y));
    addWeight(w, "RightLowerLeg", 1.8 * (1 - smoothstep(0.45, 0.80, y)) * smoothstep(0.08, 0.45, y));
    addWeight(w, "RightFoot", 2.6 * smoothstep(0.22, 0.02, y));
    addWeight(w, "Hips", 0.7 * smoothstep(0.55, 0.95, y));
  } else if (role === "left_arm") {
    keep((k) => k.startsWith("Left") && !k.includes("Leg") && !k.includes("Foot") || k === "Chest");
    addWeight(w, "LeftUpperArm", 1.4);
    addWeight(w, "LeftLowerArm", 1.4 * smoothstep(0.36, 0.55, ax));
    addWeight(w, "LeftHand", 2.0 * smoothstep(0.50, 0.64, ax));
  } else if (role === "right_arm") {
    keep((k) => k.startsWith("Right") && !k.includes("Leg") && !k.includes("Foot") || k === "Chest");
    addWeight(w, "RightUpperArm", 1.4);
    addWeight(w, "RightLowerArm", 1.4 * smoothstep(0.36, 0.55, ax));
    addWeight(w, "RightHand", 2.0 * smoothstep(0.50, 0.64, ax));
  } else if (role === "chest_front") {
    keep((k) => ["Chest", "Spine", "Neck", "Head"].includes(k));
    addWeight(w, "Chest", 2.0);
    addWeight(w, "Spine", 0.7);
    addWeight(w, "Neck", 0.5 * smoothstep(1.22, 1.38, y));
  } else if (role === "torso_head") {
    if (y > 1.48) {
      keep((k) => k === "Head" || k === "Neck");
      addWeight(w, "Head", 3.6);
      addWeight(w, "Neck", 0.8);
    } else {
      keep((k) => ["Hips", "Spine", "Chest", "Neck", "LeftShoulder", "RightShoulder"].includes(k));
      addWeight(w, "Chest", 1.4 * smoothstep(1.10, 1.32, y));
      addWeight(w, "Spine", 1.2);
      addWeight(w, "Hips", 0.9 * smoothstep(1.10, 0.92, y));
    }
  } else {
    if (ax > 0.28 && y > 0.7 && y < 1.25) {
      const side = left ? "Left" : "Right";
      keep((k) => k.startsWith(side) && !k.includes("Leg") && !k.includes("Foot") || k === "Chest");
      addWeight(w, `${side}UpperArm`, 1.5);
      addWeight(w, `${side}LowerArm`, 1.3 * smoothstep(0.36, 0.52, ax));
      addWeight(w, `${side}Hand`, 1.8 * smoothstep(0.50, 0.64, ax));
    } else if (y < 0.55) {
      const side = left ? "Left" : "Right";
      keep((k) => k.startsWith(side) && (k.includes("Leg") || k.includes("Foot")) || k === "Hips");
      addWeight(w, `${side}Foot`, 2.2 * smoothstep(0.22, 0.02, y));
      addWeight(w, `${side}LowerLeg`, 1.4);
    }
  }

  if (x < -0.04) {
    for (const k of Object.keys(w)) if (k.startsWith("Right")) w[k] *= 0.01;
  } else if (x > 0.04) {
    for (const k of Object.keys(w)) if (k.startsWith("Left")) w[k] *= 0.01;
  }
  w.Root = 0;
  w.WeaponSocket = 0;

  let entries = Object.entries(w).filter(([, v]) => v > 0.004).sort((a, b) => b[1] - a[1]).slice(0, 4);
  if (!entries.length) entries = [["Hips", 1]];
  const sum = entries.reduce((s, [, v]) => s + v, 0);
  const joints = [0, 0, 0, 0];
  const weights = [0, 0, 0, 0];
  entries.forEach(([name, v], i) => {
    joints[i] = BONE_NAMES.indexOf(name);
    weights[i] = v / sum;
  });
  const wsum = weights.reduce((s, v) => s + v, 0) || 1;
  for (let i = 0; i < 4; i++) weights[i] /= wsum;
  weights[0] += 1 - (weights[0] + weights[1] + weights[2] + weights[3]);
  return { joints, weights };
}

function paintAll(mesh, bones) {
  const joints = [];
  const weights = [];
  const influence = Object.fromEntries(BONE_NAMES.map((n) => [n, 0]));
  for (let i = 0; i < mesh.positions.length; i++) {
    const r = paintVertex(mesh.positions[i], mesh.roles[i], bones);
    joints.push(r.joints);
    weights.push(r.weights);
    r.joints.forEach((ji, k) => {
      if (r.weights[k] > 0.02) influence[BONE_NAMES[ji]] += 1;
    });
  }
  return { joints, weights, influence };
}

function bindWorld() {
  const worldMat = {};
  function visit(name, parentMat) {
    worldMat[name] = mulMat(parentMat, composeMat(LOCAL[name], [0, 0, 0, 1]));
    for (const c of CHILDREN[name] || []) visit(c, worldMat[name]);
  }
  visit("Root", identityMat());
  return worldMat;
}

function posedWorld(pose) {
  const worldMat = {};
  function visit(name, parentMat) {
    const p = pose[name] || {};
    const t = p.t || LOCAL[name];
    const q = p.q || [0, 0, 0, 1];
    worldMat[name] = mulMat(parentMat, composeMat(t, q));
    for (const c of CHILDREN[name] || []) visit(c, worldMat[name]);
  }
  visit("Root", identityMat());
  return worldMat;
}

function skinVertex(p, jointIdx, weight, ibm, live) {
  let x = 0, y = 0, z = 0;
  for (let i = 0; i < 4; i++) {
    const ww = weight[i];
    if (ww <= 0) continue;
    const name = BONE_NAMES[jointIdx[i]];
    const q = transformPoint(mulMat(live[name], ibm[name]), p);
    x += q[0] * ww; y += q[1] * ww; z += q[2] * ww;
  }
  return [x, y, z];
}

function makeBones() {
  const tails = {
    Head: [0, TARGET_HEIGHT, WORLD.Head[2]],
    LeftHand: vadd(WORLD.LeftHand, [-0.10, 0, 0]),
    RightHand: vadd(WORLD.RightHand, [0.10, 0, 0]),
    WeaponSocket: vadd(WORLD.WeaponSocket, [0, 0, 0.12]),
    LeftFoot: vadd(WORLD.LeftFoot, [0, 0, 0.14]),
    RightFoot: vadd(WORLD.RightFoot, [0, 0, 0.14]),
  };
  return { world: WORLD, local: LOCAL, tails, height: TARGET_HEIGHT };
}

function makePoses() {
  const deg = (d) => (d * Math.PI) / 180;
  const rz = (d) => quatFromAxisAngle([0, 0, 1], deg(d));
  const rx = (d) => quatFromAxisAngle([1, 0, 0], deg(d));
  const hipsBind = LOCAL.Hips;
  return {
    TEST_Idle: {},
    TEST_RightArmUp: { RightUpperArm: { q: rz(78) }, RightLowerArm: { q: rz(18) } },
    TEST_LeftArmUp: { LeftUpperArm: { q: rz(-78) }, LeftLowerArm: { q: rz(-18) } },
    TEST_LeftLegForward: { LeftUpperLeg: { q: rx(-38) } },
    TEST_Crouch: {
      Hips: { t: [hipsBind[0], hipsBind[1] * 0.58, hipsBind[2] + 0.04], q: rx(16) },
      LeftUpperLeg: { q: rx(-58) }, RightUpperLeg: { q: rx(-58) },
      LeftLowerLeg: { q: rx(88) }, RightLowerLeg: { q: rx(88) },
    },
    TEST_Downed: { Root: { q: rx(90) } },
  };
}

function validate(mesh, skin, ibm, poses) {
  const byRole = (role, pred) => {
    const idx = [];
    for (let i = 0; i < mesh.positions.length; i++) {
      if (mesh.roles[i] === role && (!pred || pred(mesh.positions[i]))) idx.push(i);
    }
    return idx;
  };
  const handR = byRole("right_arm", (p) => p[0] > 0.45).concat(
    mesh.positions.map((p, i) => (skin.joints[i][0] === BONE_NAMES.indexOf("RightHand") && skin.weights[i][0] > 0.28 ? i : -1)).filter((i) => i >= 0),
  );
  const handL = byRole("left_arm", (p) => p[0] < -0.45).concat(
    mesh.positions.map((p, i) => (skin.joints[i][0] === BONE_NAMES.indexOf("LeftHand") && skin.weights[i][0] > 0.28 ? i : -1)).filter((i) => i >= 0),
  );
  const footL = mesh.positions.map((p, i) => (p[1] < 0.12 && p[0] < 0 ? i : -1)).filter((i) => i >= 0);
  const footR = mesh.positions.map((p, i) => (p[1] < 0.12 && p[0] > 0 ? i : -1)).filter((i) => i >= 0);
  const head = mesh.positions.map((p, i) => (p[1] > 1.55 ? i : -1)).filter((i) => i >= 0);
  function stats(indices, live) {
    if (!indices.length) return { centroid: [0, 0, 0] };
    const pts = indices.map((i) => skinVertex(mesh.positions[i], skin.joints[i], skin.weights[i], ibm, live));
    return { centroid: centroid(pts) };
  }
  const idle = posedWorld({});
  const idleH = stats(handR, idle).centroid;
  const idleL = stats(handL, idle).centroid;
  const idleFL = stats(footL, idle).centroid;
  const idleFR = stats(footR, idle).centroid;
  const idleHead = stats(head, idle).centroid;
  const rightUp = posedWorld(poses.TEST_RightArmUp);
  const leftUp = posedWorld(poses.TEST_LeftArmUp);
  const leftLeg = posedWorld(poses.TEST_LeftLegForward);
  const crouch = posedWorld(poses.TEST_Crouch);
  const downed = posedWorld(poses.TEST_Downed);
  const allDown = mesh.positions.map((p, i) => skinVertex(p, skin.joints[i], skin.weights[i], ibm, downed));
  const allIdle = mesh.positions.map((p, i) => skinVertex(p, skin.joints[i], skin.weights[i], ibm, idle));
  const checks = {
    rightArmLifts: stats(handR, rightUp).centroid[1] - idleH[1],
    leftArmLifts: stats(handL, leftUp).centroid[1] - idleL[1],
    leftLegForwardZ: stats(footL, leftLeg).centroid[2] - idleFL[2],
    rightFootStay: Math.abs(stats(footR, leftLeg).centroid[2] - idleFR[2]),
    crouchLowersHead: idleHead[1] - stats(head, crouch).centroid[1],
    downedHeight: bounds(allDown).size[1],
    idleHeight: bounds(allIdle).size[1],
  };
  return {
    checks,
    pass: {
      rightArmIsolated: checks.rightArmLifts > 0.06,
      leftArmIsolated: checks.leftArmLifts > 0.06,
      legsIsolated: checks.leftLegForwardZ > 0.03 && checks.rightFootStay < 0.08,
      crouchWorks: checks.crouchLowersHead > 0.05,
      downedWorks: checks.downedHeight < checks.idleHeight * 0.62,
    },
  };
}

function writeGlb(mesh, skin, ibm, skinId) {
  const nodeIndex = Object.fromEntries(BONE_NAMES.map((n, i) => [n, i]));
  const meshNode = BONE_NAMES.length;
  const nodes = BONE_NAMES.map((name) => {
    const node = { name, translation: LOCAL[name], rotation: [0, 0, 0, 1], extras: { boliBone: name } };
    if (CHILDREN[name]?.length) node.children = CHILDREN[name].map((c) => nodeIndex[c]);
    return node;
  });
  nodes.push({ name: "BoliBody", mesh: 0, skin: 0 });

  const pos = new Float32Array(mesh.positions.flat());
  const nrm = new Float32Array(mesh.normals.flat());
  const col = new Float32Array(mesh.colors.flat());
  const joints = new Uint16Array(skin.joints.flat());
  const weights = new Float32Array(skin.weights.flat());
  const indices = mesh.indices.length > 65535 ? new Uint32Array(mesh.indices) : new Uint16Array(mesh.indices);
  const ibmArr = new Float32Array(BONE_NAMES.length * 16);
  BONE_NAMES.forEach((name, i) => ibmArr.set(ibm[name], i * 16));
  const posMin = [Infinity, Infinity, Infinity];
  const posMax = [-Infinity, -Infinity, -Infinity];
  for (const p of mesh.positions) {
    for (let k = 0; k < 3; k++) {
      if (p[k] < posMin[k]) posMin[k] = p[k];
      if (p[k] > posMax[k]) posMax[k] = p[k];
    }
  }

  const parts = [];
  const views = [];
  const accessors = [];
  function addBuffer(typed, type, componentType, extras = {}) {
    const buf = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength);
    const start = parts.reduce((s, p) => s + p.length, 0);
    parts.push(buf);
    const pad = (4 - (buf.length % 4)) % 4;
    if (pad) parts.push(Buffer.alloc(pad));
    views.push({ buffer: 0, byteOffset: start, byteLength: buf.length, target: extras.target });
    accessors.push({
      bufferView: views.length - 1, componentType, count: extras.count, type,
      min: extras.min, max: extras.max,
    });
    return accessors.length - 1;
  }

  const accPos = addBuffer(pos, "VEC3", 5126, { count: mesh.positions.length, min: posMin, max: posMax, target: 34962 });
  const accNrm = addBuffer(nrm, "VEC3", 5126, { count: mesh.positions.length, target: 34962 });
  const accCol = addBuffer(col, "VEC3", 5126, { count: mesh.positions.length, target: 34962 });
  const accJ = addBuffer(joints, "VEC4", 5123, { count: mesh.positions.length, target: 34962 });
  const accW = addBuffer(weights, "VEC4", 5126, { count: mesh.positions.length, target: 34962 });
  const accI = addBuffer(indices, "SCALAR", indices instanceof Uint32Array ? 5125 : 5123, { count: mesh.indices.length, target: 34963 });
  const accIbm = addBuffer(ibmArr, "MAT4", 5126, { count: BONE_NAMES.length });
  const bin = Buffer.concat(parts);
  const json = {
    asset: { version: "2.0", generator: `Boli ${skinId} humanoid rig v1` },
    extras: {
      boli: {
        skinId,
        skeletonContract: "boli-humanoid-v1",
        nativeHeight: TARGET_HEIGHT,
        gameScale: 16 / TARGET_HEIGHT,
        forward: "+Z",
        up: "+Y",
        pivot: "feet",
        vertexColors: "albedo",
      },
    },
    scene: 0,
    scenes: [{ name: `Boli${skinId}`, nodes: [nodeIndex.Root, meshNode] }],
    nodes,
    meshes: [{
      name: "BoliBody",
      primitives: [{
        attributes: { POSITION: accPos, NORMAL: accNrm, COLOR_0: accCol, JOINTS_0: accJ, WEIGHTS_0: accW },
        indices: accI,
        material: 0,
      }],
    }],
    skins: [{ name: "BoliHumanoid", skeleton: nodeIndex.Root, joints: BONE_NAMES.map((_, i) => i), inverseBindMatrices: accIbm }],
    materials: [{
      name: "BoliPaintedLambert",
      pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 0.78 },
      extras: { vertexColorAlbedo: true },
    }],
    accessors,
    bufferViews: views,
    buffers: [{ byteLength: bin.length }],
  };
  const jsonBuf = Buffer.from(JSON.stringify(json));
  const jsonChunk = Buffer.concat([jsonBuf, Buffer.alloc(pad4(jsonBuf.length) - jsonBuf.length, 0x20)]);
  const binChunk = Buffer.concat([bin, Buffer.alloc(pad4(bin.length) - bin.length)]);
  const total = 12 + 8 + jsonChunk.length + 8 + binChunk.length;
  const header = Buffer.alloc(12);
  header.write("glTF", 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(total, 8);
  const jsonHead = Buffer.alloc(8);
  jsonHead.writeUInt32LE(jsonChunk.length, 0);
  jsonHead.write("JSON", 4);
  const binHead = Buffer.alloc(8);
  binHead.writeUInt32LE(binChunk.length, 0);
  binHead.write("BIN\0", 4);
  return Buffer.concat([header, jsonHead, jsonChunk, binHead, binChunk]);
}

mkdirSync(__dirname, { recursive: true });
const bones = makeBones();
const bind = bindWorld();
const ibm = Object.fromEntries(BONE_NAMES.map((n) => [n, invertMat(bind[n])]));
const poses = makePoses();
const reports = {};

for (const job of JOBS) {
  console.log(`\n=== ${job.skinId} ===`);
  const raw = loadTexturedMesh(job.source, job.roles);
  console.log(`  loaded verts ${raw.positions.length} tris ${Math.round(raw.indices.length / 3)}`);
  const fitted = transformMesh(raw);
  const mesh = decimate(fitted);
  const skin = paintAll(mesh, bones);
  const glb = writeGlb(mesh, skin, ibm, job.skinId);
  writeFileSync(job.out, glb);
  const validation = validate(mesh, skin, ibm, poses);
  reports[job.skinId] = {
    out: job.out,
    bytes: glb.length,
    verts: mesh.positions.length,
    tris: mesh.indices.length / 3,
    influence: skin.influence,
    ...validation,
  };
  console.log(JSON.stringify({
    skinId: job.skinId,
    bytes: glb.length,
    verts: mesh.positions.length,
    tris: mesh.indices.length / 3,
    pass: validation.pass,
    checks: validation.checks,
    influence: skin.influence,
  }, null, 2));
}

writeFileSync(join(__dirname, "rig-skins-23-report.json"), JSON.stringify(reports, null, 2));
