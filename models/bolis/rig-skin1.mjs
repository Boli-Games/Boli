/**
 * Build a reusable humanoid rig + skinning for boly_normal.glb (Boli Skin 1).
 * Does not touch game code. Output: boli_skin1_rigged.glb
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SOURCE = process.argv[2] || "c:\\Users\\valle\\Downloads\\boly_normal.glb";
const OUT_DIR = __dirname;
const OUT_GLB = join(OUT_DIR, "boli_skin1_rigged.glb");
const OUT_CONTRACT = join(OUT_DIR, "skeleton-contract.json");
const OUT_REPORT = join(OUT_DIR, "rig-validation.json");

const BONE_NAMES = [
  "Root",
  "Hips",
  "Spine",
  "Chest",
  "Neck",
  "Head",
  "LeftShoulder",
  "LeftUpperArm",
  "LeftLowerArm",
  "LeftHand",
  "RightShoulder",
  "RightUpperArm",
  "RightLowerArm",
  "RightHand",
  "WeaponSocket",
  "LeftUpperLeg",
  "LeftLowerLeg",
  "LeftFoot",
  "RightUpperLeg",
  "RightLowerLeg",
  "RightFoot",
];

const PARENT = {
  Root: null,
  Hips: "Root",
  Spine: "Hips",
  Chest: "Spine",
  Neck: "Chest",
  Head: "Neck",
  LeftShoulder: "Chest",
  LeftUpperArm: "LeftShoulder",
  LeftLowerArm: "LeftUpperArm",
  LeftHand: "LeftLowerArm",
  RightShoulder: "Chest",
  RightUpperArm: "RightShoulder",
  RightLowerArm: "RightUpperArm",
  RightHand: "RightLowerArm",
  WeaponSocket: "RightHand",
  LeftUpperLeg: "Hips",
  LeftLowerLeg: "LeftUpperLeg",
  LeftFoot: "LeftLowerLeg",
  RightUpperLeg: "Hips",
  RightLowerLeg: "RightUpperLeg",
  RightFoot: "RightLowerLeg",
};

const CHILDREN = {};
for (const [child, parent] of Object.entries(PARENT)) {
  if (!parent) continue;
  (CHILDREN[parent] ??= []).push(child);
}

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
      else v = bin[p];
      row.push(v);
    }
    out.push(typeCount === 1 ? row[0] : row);
  }
  return out;
}

function vadd(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}
function vsub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function vscale(a, s) {
  return [a[0] * s, a[1] * s, a[2] * s];
}
function vdot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function vlen(a) {
  return Math.hypot(a[0], a[1], a[2]);
}
function vlerp(a, b, t) {
  return vadd(a, vscale(vsub(b, a), t));
}
function clamp(x, a, b) {
  return Math.max(a, Math.min(b, x));
}
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
  for (const p of pts) {
    x += p[0];
    y += p[1];
    z += p[2];
  }
  const n = pts.length;
  return [x / n, y / n, z / n];
}

function bounds(pts) {
  let min = [Infinity, Infinity, Infinity];
  let max = [-Infinity, -Infinity, -Infinity];
  for (const p of pts) {
    for (let i = 0; i < 3; i++) {
      if (p[i] < min[i]) min[i] = p[i];
      if (p[i] > max[i]) max[i] = p[i];
    }
  }
  return { min, max, size: vsub(max, min), center: vscale(vadd(min, max), 0.5) };
}

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

function quatConj(q) {
  return [-q[0], -q[1], -q[2], q[3]];
}

function quatRotate(q, v) {
  const qv = [v[0], v[1], v[2], 0];
  const r = quatMul(quatMul(q, qv), quatConj(q));
  return [r[0], r[1], r[2]];
}

function identityMat() {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

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
      const a = n[i * 4 + k];
      n[i * 4 + k] = n[pivot * 4 + k];
      n[pivot * 4 + k] = a;
      const b = inv[i * 4 + k];
      inv[i * 4 + k] = inv[pivot * 4 + k];
      inv[pivot * 4 + k] = b;
    }
    const d = n[i * 4 + i] || 1e-12;
    for (let k = 0; k < 4; k++) {
      n[i * 4 + k] /= d;
      inv[i * 4 + k] /= d;
    }
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

function pad4(n) {
  return (n + 3) & ~3;
}

function loadSource(path) {
  const { json, bin } = parseGlb(readFileSync(path));
  const positions = [];
  const normals = [];
  const uvs = [];
  const sources = [];
  const indices = [];
  json.meshes.forEach((mesh, mi) => {
    const prim = mesh.primitives[0];
    const pos = readAccessor(json, bin, prim.attributes.POSITION);
    const nrm = readAccessor(json, bin, prim.attributes.NORMAL);
    const uv = readAccessor(json, bin, prim.attributes.TEXCOORD_0);
    const idx = readAccessor(json, bin, prim.indices);
    const base = positions.length;
    for (let i = 0; i < pos.length; i++) {
      positions.push(pos[i]);
      normals.push(nrm[i]);
      uvs.push(uv[i]);
      sources.push(mi);
    }
    for (const i of idx) indices.push(base + i);
  });
  return { positions, normals, uvs, sources, indices, meshCount: json.meshes.length };
}

function weld(mesh, eps = 0.00035) {
  const key = (p) => `${Math.round(p[0] / eps)},${Math.round(p[1] / eps)},${Math.round(p[2] / eps)}`;
  const map = new Map();
  const positions = [];
  const normals = [];
  const uvs = [];
  const sources = [];
  const remap = new Array(mesh.positions.length);
  for (let i = 0; i < mesh.positions.length; i++) {
    const k = key(mesh.positions[i]);
    let id = map.get(k);
    if (id === undefined) {
      id = positions.length;
      map.set(k, id);
      positions.push(mesh.positions[i]);
      normals.push(mesh.normals[i].slice());
      uvs.push(mesh.uvs[i].slice());
      sources.push(mesh.sources[i]);
    } else {
      normals[id] = vadd(normals[id], mesh.normals[i]);
      if (mesh.sources[i] > sources[id] && mesh.sources[i] >= 5) sources[id] = mesh.sources[i];
    }
    remap[i] = id;
  }
  for (const n of normals) {
    const l = vlen(n) || 1;
    n[0] /= l;
    n[1] /= l;
    n[2] /= l;
  }
  const indices = mesh.indices.map((i) => remap[i]);
  return { positions, normals, uvs, sources, indices, meshCount: mesh.meshCount };
}

function fitBones(mesh) {
  const { positions, sources } = mesh;
  const by = (id) => positions.filter((_, i) => sources[i] === id);
  const all = bounds(positions);
  const head = by(2);
  const lower = by(0);
  const handR = by(5);
  const handL = by(6);
  const headB = bounds(head);
  const lowerB = bounds(lower);
  const hR = centroid(handR);
  const hL = centroid(handL);
  const height = all.size[1];
  const h = height;

  const world = {
    Root: [0, 0, 0],
    Hips: [0, h * 0.43, 0.01],
    Spine: [0, h * 0.56, 0.04],
    Chest: [0, h * 0.67, 0.02],
    Neck: [0, h * 0.78, 0.0],
    Head: [0, h * 0.88, headB.center[2]],
    LeftShoulder: [-h * 0.10, h * 0.58, 0.01],
    LeftUpperArm: [hL[0] * 0.50, h * 0.545, hL[2] * 0.45],
    LeftLowerArm: [hL[0] * 0.78, (h * 0.545 + hL[1]) * 0.5, hL[2] * 0.8],
    LeftHand: hL.slice(),
    RightShoulder: [h * 0.10, h * 0.58, 0.01],
    RightUpperArm: [hR[0] * 0.50, h * 0.545, hR[2] * 0.45],
    RightLowerArm: [hR[0] * 0.78, (h * 0.545 + hR[1]) * 0.5, hR[2] * 0.8],
    RightHand: hR.slice(),
    WeaponSocket: vadd(hR, [0.04, -0.02, 0.09]),
    LeftUpperLeg: [-lowerB.size[0] * 0.20, h * 0.41, 0.02],
    LeftLowerLeg: [-lowerB.size[0] * 0.22, h * 0.22, 0.05],
    LeftFoot: [-lowerB.size[0] * 0.23, 0.04, 0.10],
    RightUpperLeg: [lowerB.size[0] * 0.20, h * 0.41, 0.02],
    RightLowerLeg: [lowerB.size[0] * 0.22, h * 0.22, 0.05],
    RightFoot: [lowerB.size[0] * 0.23, 0.04, 0.10],
  };

  const local = {};
  for (const name of BONE_NAMES) {
    const parent = PARENT[name];
    local[name] = parent ? vsub(world[name], world[parent]) : world[name];
  }

  const tails = {
    Head: [0, all.max[1], world.Head[2]],
    LeftHand: vadd(world.LeftHand, [-0.10, 0, 0]),
    RightHand: vadd(world.RightHand, [0.10, 0, 0]),
    WeaponSocket: vadd(world.WeaponSocket, [0, 0, 0.12]),
    LeftFoot: vadd(world.LeftFoot, [0, 0, 0.14]),
    RightFoot: vadd(world.RightFoot, [0, 0, 0.14]),
  };

  return { world, local, tails, height, all, hR, hL };
}

function plantFeet(pose, bones, mesh, skin, ibm) {
  const live = posedWorld(bones, pose);
  let minY = Infinity;
  for (let i = 0; i < mesh.positions.length; i++) {
    if (mesh.positions[i][1] > 0.18) continue;
    const p = skinVertex(mesh.positions[i], skin.joints[i], skin.weights[i], ibm, live);
    if (p[1] < minY) minY = p[1];
  }
  if (minY < 0) {
    const hips = pose.Hips || {};
    const t = (hips.t || bones.local.Hips).slice();
    t[1] += -minY + 0.004;
    pose.Hips = { ...hips, t };
  }
}

function addWeight(map, name, w) {
  if (w <= 0) return;
  map[name] = (map[name] || 0) + w;
}

function heat(p, a, b, radius) {
  const d = distToSegment(p, a, b);
  if (d >= radius) return 0;
  const t = 1 - d / radius;
  return t * t;
}

function paintVertex(p, src, bones) {
  const { world, tails } = bones;
  const x = p[0], y = p[1];
  const ax = Math.abs(x);
  const left = x < 0;
  const w = {};

  const hip = world.Hips;
  const spine = world.Spine;
  const chest = world.Chest;
  const neck = world.Neck;
  const head = world.Head;

  addWeight(w, "Hips", heat(p, hip, spine, 0.28) * (y < 1.15 ? 1 : 0.2));
  addWeight(w, "Spine", heat(p, spine, chest, 0.30));
  addWeight(w, "Chest", heat(p, chest, neck, 0.32));
  addWeight(w, "Neck", heat(p, neck, head, 0.18));
  addWeight(w, "Head", heat(p, head, tails.Head, 0.34));

  const arm = (side) => {
    const S = world[`${side}Shoulder`];
    const U = world[`${side}UpperArm`];
    const L = world[`${side}LowerArm`];
    const H = world[`${side}Hand`];
    const tip = tails[`${side}Hand`];
    addWeight(w, `${side}Shoulder`, heat(p, S, U, 0.16));
    addWeight(w, `${side}UpperArm`, heat(p, U, L, 0.16));
    addWeight(w, `${side}LowerArm`, heat(p, L, H, 0.14));
    addWeight(w, `${side}Hand`, heat(p, H, tip, 0.13));
  };
  arm("Left");
  arm("Right");

  const leg = (side) => {
    const U = world[`${side}UpperLeg`];
    const L = world[`${side}LowerLeg`];
    const F = world[`${side}Foot`];
    const tip = tails[`${side}Foot`];
    addWeight(w, `${side}UpperLeg`, heat(p, world.Hips, U, 0.18) * 0.35);
    addWeight(w, `${side}UpperLeg`, heat(p, U, L, 0.22));
    addWeight(w, `${side}LowerLeg`, heat(p, L, F, 0.20));
    addWeight(w, `${side}Foot`, heat(p, F, tip, 0.16));
  };
  leg("Left");
  leg("Right");

  // Source-mesh priors: the 9 export pieces already segment the body.
  if (src === 2 || src === 8) {
    for (const k of Object.keys(w)) {
      if (k !== "Head" && k !== "Neck") w[k] *= 0.02;
    }
    const chin = y < neck[1] + 0.05;
    addWeight(w, "Head", chin ? 1.2 : 4.0);
    addWeight(w, "Neck", chin ? 1.4 : 0.12);
  } else if (src === 5) {
    for (const k of Object.keys(w)) {
      if (!k.startsWith("Right") || k.includes("Leg") || k.includes("Foot") || k === "WeaponSocket") w[k] *= 0.04;
    }
    addWeight(w, "RightHand", 3.2);
    addWeight(w, "RightLowerArm", 0.7);
  } else if (src === 6) {
    for (const k of Object.keys(w)) {
      if (!k.startsWith("Left") || k.includes("Leg") || k.includes("Foot")) w[k] *= 0.04;
    }
    addWeight(w, "LeftHand", 3.2);
    addWeight(w, "LeftLowerArm", 0.7);
  } else if (src === 7) {
    for (const k of Object.keys(w)) {
      if (k !== "Chest" && k !== "Spine") w[k] *= 0.08;
    }
    addWeight(w, "Chest", 2.2);
  } else if (src === 1) {
    for (const k of Object.keys(w)) {
      if (!["Spine", "Chest", "Neck", "Hips", "LeftShoulder", "RightShoulder"].includes(k)) w[k] *= 0.05;
    }
    w.Head = (w.Head || 0) * 0.05;
    addWeight(w, "Chest", 1.4 * smoothstep(1.10, 1.32, y));
    addWeight(w, "Spine", 1.2 * (1 - Math.abs(y - spine[1]) / 0.22));
    addWeight(w, "Hips", 0.8 * smoothstep(1.10, 0.92, y));
    addWeight(w, "Neck", 0.5 * smoothstep(1.32, 1.48, y));
  } else if (src === 0) {
    for (const k of Object.keys(w)) {
      if (!k.includes("Leg") && !k.includes("Foot") && k !== "Hips") w[k] *= 0.04;
    }
    if (ax < 0.09 && y > 0.50) {
      addWeight(w, "Hips", 2.4);
      addWeight(w, "Spine", 0.35);
      w.LeftUpperLeg = (w.LeftUpperLeg || 0) * 0.25;
      w.RightUpperLeg = (w.RightUpperLeg || 0) * 0.25;
    } else {
      addWeight(w, "Hips", 1.2 * smoothstep(0.55, 0.95, y) * (1 - smoothstep(0.18, 0.38, ax)));
      if (left) {
        addWeight(w, "LeftUpperLeg", 1.8 * smoothstep(0.35, 0.85, y));
        addWeight(w, "LeftLowerLeg", 1.8 * (1 - smoothstep(0.45, 0.80, y)) * smoothstep(0.08, 0.45, y));
        addWeight(w, "LeftFoot", 2.4 * smoothstep(0.22, 0.02, y));
      } else {
        addWeight(w, "RightUpperLeg", 1.8 * smoothstep(0.35, 0.85, y));
        addWeight(w, "RightLowerLeg", 1.8 * (1 - smoothstep(0.45, 0.80, y)) * smoothstep(0.08, 0.45, y));
        addWeight(w, "RightFoot", 2.4 * smoothstep(0.22, 0.02, y));
      }
    }
  } else if (src === 3 || src === 4) {
    if (ax < 0.16) {
      for (const k of Object.keys(w)) {
        if (!["Hips", "Spine", "Chest"].includes(k)) w[k] *= 0.05;
      }
      addWeight(w, "Hips", 1.6);
      addWeight(w, "Spine", 0.8);
    } else {
      const side = left ? "Left" : "Right";
      const other = left ? "Right" : "Left";
      for (const k of Object.keys(w)) {
        if (k.startsWith(other) || k.includes("Leg") || k.includes("Foot") || k === "Head" || k === "Neck") w[k] *= 0.03;
      }
      addWeight(w, `${side}Shoulder`, 0.6 * smoothstep(0.42, 0.22, ax));
      addWeight(w, `${side}UpperArm`, 1.4 * (1 - smoothstep(0.48, 0.62, ax)));
      addWeight(w, `${side}LowerArm`, 1.4 * smoothstep(0.36, 0.52, ax) * (1 - smoothstep(0.58, 0.70, ax)));
      addWeight(w, `${side}Hand`, 1.8 * smoothstep(0.52, 0.64, ax));
    }
  }

  // Hard limb isolation: a left vertex must not follow the right limb.
  if (x < -0.04) {
    for (const k of Object.keys(w)) if (k.startsWith("Right")) w[k] *= 0.01;
  } else if (x > 0.04) {
    for (const k of Object.keys(w)) if (k.startsWith("Left")) w[k] *= 0.01;
  }
  w.Root = 0;
  w.WeaponSocket = 0;

  let entries = Object.entries(w)
    .filter(([, v]) => v > 0.004)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4);
  if (!entries.length) {
    entries = [["Hips", 1]];
  }
  const sum = entries.reduce((s, [, v]) => s + v, 0);
  const joints = [0, 0, 0, 0];
  const weights = [0, 0, 0, 0];
  entries.forEach(([name, v], i) => {
    joints[i] = BONE_NAMES.indexOf(name);
    weights[i] = v / sum;
  });
  const wsum = weights.reduce((s, v) => s + v, 0);
  if (wsum <= 1e-8) {
    joints[0] = BONE_NAMES.indexOf("Hips");
    weights[0] = 1;
    weights[1] = 0;
    weights[2] = 0;
    weights[3] = 0;
  } else {
    for (let i = 0; i < 4; i++) weights[i] /= wsum;
    const leftover = 1 - (weights[0] + weights[1] + weights[2] + weights[3]);
    weights[0] += leftover;
  }
  return { joints, weights };
}

function paintAll(mesh, bones) {
  const joints = [];
  const weights = [];
  const influence = Object.fromEntries(BONE_NAMES.map((n) => [n, 0]));
  for (let i = 0; i < mesh.positions.length; i++) {
    const r = paintVertex(mesh.positions[i], mesh.sources[i], bones);
    if (r.weights.reduce((s, v) => s + v, 0) < 0.999) {
      r.joints = [BONE_NAMES.indexOf("Hips"), 0, 0, 0];
      r.weights = [1, 0, 0, 0];
    }
    joints.push(r.joints);
    weights.push(r.weights);
    r.joints.forEach((ji, k) => {
      if (r.weights[k] > 0.02) influence[BONE_NAMES[ji]] += 1;
    });
  }
  return { joints, weights, influence };
}

function bindWorld(bones) {
  const worldMat = {};
  function visit(name, parentMat) {
    const q = [0, 0, 0, 1];
    const m = mulMat(parentMat, composeMat(bones.local[name], q));
    worldMat[name] = m;
    for (const c of CHILDREN[name] || []) visit(c, m);
  }
  visit("Root", identityMat());
  return worldMat;
}

function posedWorld(bones, pose) {
  const worldMat = {};
  function visit(name, parentMat) {
    const p = pose[name] || {};
    const t = p.t || bones.local[name];
    const q = p.q || [0, 0, 0, 1];
    const m = mulMat(parentMat, composeMat(t, q));
    worldMat[name] = m;
    for (const c of CHILDREN[name] || []) visit(c, m);
  }
  visit("Root", identityMat());
  return worldMat;
}

function skinVertex(p, jointIdx, weight, ibm, live) {
  let x = 0, y = 0, z = 0;
  for (let i = 0; i < 4; i++) {
    const w = weight[i];
    if (w <= 0) continue;
    const name = BONE_NAMES[jointIdx[i]];
    const m = mulMat(live[name], ibm[name]);
    const q = transformPoint(m, p);
    x += q[0] * w;
    y += q[1] * w;
    z += q[2] * w;
  }
  return [x, y, z];
}

function makePoses(bones) {
  const deg = (d) => (d * Math.PI) / 180;
  const rz = (d) => quatFromAxisAngle([0, 0, 1], deg(d));
  const rx = (d) => quatFromAxisAngle([1, 0, 0], deg(d));
  const ry = (d) => quatFromAxisAngle([0, 1, 0], deg(d));
  const hipsBind = bones.local.Hips;
  return {
    TEST_Idle: { Root: { q: [0, 0, 0, 1] } },
    TEST_RightArmUp: { RightUpperArm: { q: rz(78) }, RightLowerArm: { q: rz(18) } },
    TEST_LeftArmUp: { LeftUpperArm: { q: rz(-78) }, LeftLowerArm: { q: rz(-18) } },
    TEST_BothArmsUp: {
      RightUpperArm: { q: rz(78) },
      RightLowerArm: { q: rz(18) },
      LeftUpperArm: { q: rz(-78) },
      LeftLowerArm: { q: rz(-18) },
    },
    TEST_LeftLegForward: { LeftUpperLeg: { q: rx(-38) } },
    TEST_KneesBent: {
      LeftUpperLeg: { q: rx(-42) },
      RightUpperLeg: { q: rx(-42) },
      LeftLowerLeg: { q: rx(78) },
      RightLowerLeg: { q: rx(78) },
    },
    TEST_Crouch: {
      Hips: { t: [hipsBind[0], hipsBind[1] * 0.58, hipsBind[2] + 0.04], q: rx(16) },
      Spine: { q: rx(12) },
      Chest: { q: rx(8) },
      LeftUpperLeg: { q: rx(-58) },
      RightUpperLeg: { q: rx(-58) },
      LeftLowerLeg: { q: rx(88) },
      RightLowerLeg: { q: rx(88) },
      LeftFoot: { q: rx(-24) },
      RightFoot: { q: rx(-24) },
    },
    TEST_HeadTurn: { Head: { q: ry(48) }, Neck: { q: ry(10) } },
    TEST_Shoot: {
      Chest: { q: ry(-12) },
      RightShoulder: { q: rx(-18) },
      RightUpperArm: { q: quatMul(rx(-55), rz(22)) },
      RightLowerArm: { q: rx(-18) },
      LeftUpperArm: { q: quatMul(rx(-35), rz(-28)) },
      Head: { q: ry(-8) },
    },
    TEST_Downed: { Root: { q: rx(90) } },
  };
}

function validate(mesh, skin, bones, ibm, poses) {
  const reports = {};
  const handR = [];
  const handL = [];
  const footL = [];
  const footR = [];
  const head = [];
  for (let i = 0; i < mesh.positions.length; i++) {
    if (mesh.sources[i] === 5) handR.push(i);
    if (mesh.sources[i] === 6) handL.push(i);
    if (mesh.sources[i] === 2) head.push(i);
    if (mesh.sources[i] === 0 && mesh.positions[i][1] < 0.12) {
      if (mesh.positions[i][0] < 0) footL.push(i);
      else footR.push(i);
    }
  }
  const bindLive = posedWorld(bones, {});
  function stats(indices, live) {
    const pts = indices.map((i) => skinVertex(mesh.positions[i], skin.joints[i], skin.weights[i], ibm, live));
    const b = bounds(pts);
    return { centroid: centroid(pts), bounds: b };
  }
  for (const [name, pose] of Object.entries(poses)) {
    const live = posedWorld(bones, pose);
    const allPts = mesh.positions.map((p, i) => skinVertex(p, skin.joints[i], skin.weights[i], ibm, live));
    const b = bounds(allPts);
    reports[name] = {
      bbox: b,
      height: b.size[1],
      handR: stats(handR, live),
      handL: stats(handL, live),
      head: stats(head, live),
      footL: stats(footL, live),
      footR: stats(footR, live),
    };
  }
  const idle = reports.TEST_Idle;
  const checks = {
    idleHeight: idle.height,
    rightArmLifts:
      reports.TEST_RightArmUp.handR.centroid[1] - idle.handR.centroid[1],
    rightArmDoesNotMoveLeft:
      Math.abs(reports.TEST_RightArmUp.handL.centroid[1] - idle.handL.centroid[1]),
    leftArmLifts: reports.TEST_LeftArmUp.handL.centroid[1] - idle.handL.centroid[1],
    leftArmDoesNotMoveRight:
      Math.abs(reports.TEST_LeftArmUp.handR.centroid[1] - idle.handR.centroid[1]),
    bothArmsLiftR: reports.TEST_BothArmsUp.handR.centroid[1] - idle.handR.centroid[1],
    bothArmsLiftL: reports.TEST_BothArmsUp.handL.centroid[1] - idle.handL.centroid[1],
    leftLegForwardZ: reports.TEST_LeftLegForward.footL.centroid[2] - idle.footL.centroid[2],
    leftLegDoesNotMoveRightZ: Math.abs(
      reports.TEST_LeftLegForward.footR.centroid[2] - idle.footR.centroid[2],
    ),
    crouchLowersHead: idle.head.centroid[1] - reports.TEST_Crouch.head.centroid[1],
    crouchFeetStayLow: reports.TEST_Crouch.footL.centroid[1],
    headTurnMovesX: reports.TEST_HeadTurn.head.centroid[0] - idle.head.centroid[0],
    headFaceYaw: (() => {
      const liveIdle = posedWorld(bones, {});
      const liveTurn = posedWorld(bones, poses.TEST_HeadTurn);
      let bestI = head[0];
      let bestZ = -Infinity;
      for (const i of head) {
        if (mesh.positions[i][2] > bestZ) {
          bestZ = mesh.positions[i][2];
          bestI = i;
        }
      }
      const a = skinVertex(mesh.positions[bestI], skin.joints[bestI], skin.weights[bestI], ibm, liveIdle);
      const b = skinVertex(mesh.positions[bestI], skin.joints[bestI], skin.weights[bestI], ibm, liveTurn);
      return b[0] - a[0];
    })(),
    shootRightHandForward: reports.TEST_Shoot.handR.centroid[2] - idle.handR.centroid[2],
    downedHeight: reports.TEST_Downed.height,
    downedExtendsZ: reports.TEST_Downed.bbox.size[2],
  };
  const pass = {
    rightArmIsolated: checks.rightArmLifts > 0.08 && checks.rightArmDoesNotMoveLeft < 0.05,
    leftArmIsolated: checks.leftArmLifts > 0.08 && checks.leftArmDoesNotMoveRight < 0.05,
    legsIsolated: checks.leftLegForwardZ > 0.04 && checks.leftLegDoesNotMoveRightZ < 0.05,
    crouchWorks: checks.crouchLowersHead > 0.08 && checks.crouchFeetStayLow > -0.015,
    downedWorks: checks.downedHeight < idle.height * 0.55,
    headTurns: Math.abs(checks.headFaceYaw) > 0.04,
  };
  return { checks, pass, reports: Object.fromEntries(Object.entries(reports).map(([k, v]) => [k, {
    height: v.height,
    bboxSize: v.bbox.size,
    handR: v.handR.centroid,
    handL: v.handL.centroid,
    head: v.head.centroid,
    footL: v.footL.centroid,
    footR: v.footR.centroid,
  }])) };
}

function buildAnimations(bones, poses, nodeIndex) {
  const animations = [];
  const accessors = [];
  const chunks = [];

  function pushAccessor(data, type, componentType, extras = {}) {
    const bytes = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    const index = accessors.length;
    accessors.push({
      bufferView: chunks.length,
      componentType,
      count: extras.count,
      type,
      min: extras.min,
      max: extras.max,
    });
    chunks.push(bytes);
    return index;
  }

  const time = new Float32Array([0, 1]);
  const timeAcc = pushAccessor(time, "SCALAR", 5126, { count: 2, min: [0], max: [1] });

  for (const [name, pose] of Object.entries(poses)) {
    const channels = [];
    const samplers = [];
    for (const boneName of Object.keys(pose)) {
      const p = pose[boneName];
      const node = nodeIndex[boneName];
      if (p.q) {
        const rot = new Float32Array([...p.q, ...p.q]);
        const acc = pushAccessor(rot, "VEC4", 5126, { count: 2 });
        samplers.push({ input: timeAcc, output: acc, interpolation: "STEP" });
        channels.push({ sampler: samplers.length - 1, target: { node, path: "rotation" } });
      }
      if (p.t) {
        const tr = new Float32Array([...p.t, ...p.t]);
        const acc = pushAccessor(tr, "VEC3", 5126, { count: 2 });
        samplers.push({ input: timeAcc, output: acc, interpolation: "STEP" });
        channels.push({ sampler: samplers.length - 1, target: { node, path: "translation" } });
      }
    }
    if (!channels.length) {
      const rot = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1]);
      const acc = pushAccessor(rot, "VEC4", 5126, { count: 2 });
      samplers.push({ input: timeAcc, output: acc, interpolation: "STEP" });
      channels.push({ sampler: 0, target: { node: nodeIndex.Root, path: "rotation" } });
    }
    animations.push({ name, samplers, channels });
  }
  return { animations, accessors, chunks };
}

function writeGlb(mesh, skin, bones, ibm, poses) {
  const nodeIndex = Object.fromEntries(BONE_NAMES.map((n, i) => [n, i]));
  const meshNode = BONE_NAMES.length;
  const nodes = BONE_NAMES.map((name) => {
    const node = {
      name,
      translation: bones.local[name],
      rotation: [0, 0, 0, 1],
      extras: { boliBone: name },
    };
    if (CHILDREN[name]?.length) node.children = CHILDREN[name].map((c) => nodeIndex[c]);
    return node;
  });
  nodes.push({
    name: "BoliBody",
    mesh: 0,
    skin: 0,
  });

  const pos = new Float32Array(mesh.positions.flat());
  const nrm = new Float32Array(mesh.normals.flat());
  const uv = new Float32Array(mesh.uvs.flat());
  const joints = new Uint16Array(skin.joints.flat());
  const weights = new Float32Array(skin.weights.flat());
  const indices = new Uint16Array(mesh.indices);
  const ibmArr = new Float32Array(BONE_NAMES.length * 16);
  BONE_NAMES.forEach((name, i) => {
    ibmArr.set(ibm[name], i * 16);
  });

  const posMin = [Infinity, Infinity, Infinity];
  const posMax = [-Infinity, -Infinity, -Infinity];
  for (const p of mesh.positions) {
    for (let k = 0; k < 3; k++) {
      if (p[k] < posMin[k]) posMin[k] = p[k];
      if (p[k] > posMax[k]) posMax[k] = p[k];
    }
  }

  const anim = buildAnimations(bones, poses, nodeIndex);

  const parts = [];
  function addPart(buf, align = 4) {
    const start = parts.reduce((s, p) => s + p.length, 0);
    const pad = (align - (buf.length % align)) % align;
    parts.push(buf);
    if (pad) parts.push(Buffer.alloc(pad));
    return { byteOffset: start, byteLength: buf.length };
  }

  const views = [];
  const accessors = [];
  function addBuffer(typed, type, componentType, extras = {}) {
    const buf = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength);
    const view = addPart(buf);
    views.push({ buffer: 0, byteOffset: view.byteOffset, byteLength: view.byteLength, target: extras.target });
    accessors.push({
      bufferView: views.length - 1,
      componentType,
      count: extras.count,
      type,
      min: extras.min,
      max: extras.max,
      normalized: extras.normalized,
    });
    return accessors.length - 1;
  }

  const accPos = addBuffer(pos, "VEC3", 5126, { count: mesh.positions.length, min: posMin, max: posMax, target: 34962 });
  const accNrm = addBuffer(nrm, "VEC3", 5126, { count: mesh.positions.length, target: 34962 });
  const accUv = addBuffer(uv, "VEC2", 5126, { count: mesh.positions.length, target: 34962 });
  const accJ = addBuffer(joints, "VEC4", 5123, { count: mesh.positions.length, target: 34962 });
  const accW = addBuffer(weights, "VEC4", 5126, { count: mesh.positions.length, target: 34962 });
  const accI = addBuffer(indices, "SCALAR", 5123, { count: mesh.indices.length, target: 34963 });
  const accIbm = addBuffer(ibmArr, "MAT4", 5126, { count: BONE_NAMES.length });

  const animAccOffset = accessors.length;
  for (const chunk of anim.chunks) {
    const view = addPart(chunk);
    views.push({ buffer: 0, byteOffset: view.byteOffset, byteLength: view.byteLength });
  }
  for (const acc of anim.accessors) {
    accessors.push({
      ...acc,
      bufferView: animAccOffset + acc.bufferView,
    });
  }
  const animations = anim.animations.map((a) => ({
    name: a.name,
    samplers: a.samplers.map((s) => ({
      input: s.input + animAccOffset,
      output: s.output + animAccOffset,
      interpolation: s.interpolation,
    })),
    channels: a.channels,
  }));

  const bin = Buffer.concat(parts);
  const json = {
    asset: {
      version: "2.0",
      generator: "Boli skin1 humanoid rig v1",
    },
    extras: {
      boli: {
        skinId: "skin1",
        skeletonContract: "boli-humanoid-v1",
        nativeHeight: bones.height,
        gameScale: 16 / bones.height,
        forward: "+Z",
        up: "+Y",
        pivot: "feet",
      },
    },
    scene: 0,
    scenes: [{ name: "BoliSkin1", nodes: [nodeIndex.Root, meshNode] }],
    nodes,
    meshes: [
      {
        name: "BoliBody",
        primitives: [
          {
            attributes: {
              POSITION: accPos,
              NORMAL: accNrm,
              TEXCOORD_0: accUv,
              JOINTS_0: accJ,
              WEIGHTS_0: accW,
            },
            indices: accI,
            material: 0,
          },
        ],
      },
    ],
    skins: [
      {
        name: "BoliHumanoid",
        skeleton: nodeIndex.Root,
        joints: BONE_NAMES.map((_, i) => i),
        inverseBindMatrices: accIbm,
      },
    ],
    animations,
    materials: [
      {
        name: "BoliLambertPreview",
        pbrMetallicRoughness: {
          baseColorFactor: [0.894, 0.824, 0.698, 1],
          metallicFactor: 0,
          roughnessFactor: 0.72,
        },
        extras: { note: "Temporary preview material. Final Lambert/skins later." },
      },
    ],
    accessors,
    bufferViews: views,
    buffers: [{ byteLength: bin.length }],
  };

  const jsonBuf = Buffer.from(JSON.stringify(json));
  const jsonPad = pad4(jsonBuf.length) - jsonBuf.length;
  const jsonChunk = Buffer.concat([jsonBuf, Buffer.alloc(jsonPad, 0x20)]);
  const binPad = pad4(bin.length) - bin.length;
  const binChunk = Buffer.concat([bin, Buffer.alloc(binPad)]);
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
  return {
    glb: Buffer.concat([header, jsonHead, jsonChunk, binHead, binChunk]),
    poses,
    jsonMeta: json.extras.boli,
  };
}

function contractDoc(bones, mesh, skin) {
  return {
    id: "boli-humanoid-v1",
    version: 1,
    purpose: "Shared skeleton contract for Boli skins 1–3",
    space: { up: "+Y", forward: "+Z", pivot: "feet at origin", units: "glTF meters" },
    nativeHeight: bones.height,
    recommendedGameScale: 16 / bones.height,
    bindPose: "identity rotations, translation-only rest offsets",
    boneCount: BONE_NAMES.length,
    hierarchy: PARENT,
    boneOrder: BONE_NAMES,
    requiredBones: BONE_NAMES.filter((n) => n !== "WeaponSocket"),
    sockets: {
      WeaponSocket: {
        parent: "RightHand",
        purpose: "Mount point for the shotgun. Do not skin mesh vertices to this bone.",
      },
    },
    meshRules: {
      maxTriangles: 8000,
      recommended: "single skinned mesh, humanoid proportions close to Skin 1",
      mustHave: ["feet on Y=0", "facing +Z", "similar height ~1.8–2.0 before scale"],
    },
    animationRules: {
      shareClipsByBoneName: true,
      rootMotionBone: "Root",
      crouch: "translate Hips down + bend legs",
      downed: "rotate Root ~90° on X (matches current makePerson downed)",
    },
    skin1: {
      source: "boly_normal.glb",
      triangles: mesh.indices.length / 3,
      vertices: mesh.positions.length,
      influenceCounts: skin.influence,
    },
  };
}

mkdirSync(OUT_DIR, { recursive: true });
const raw = loadSource(SOURCE);
const mesh = weld(raw);
const bones = fitBones(mesh);
const bind = bindWorld(bones);
const ibm = Object.fromEntries(BONE_NAMES.map((n) => [n, invertMat(bind[n])]));
const skin = paintAll(mesh, bones);
const poses = makePoses(bones);
plantFeet(poses.TEST_Crouch, bones, mesh, skin, ibm);
const { glb, jsonMeta } = writeGlb(mesh, skin, bones, ibm, poses);
writeFileSync(OUT_GLB, glb);
const validation = validate(mesh, skin, bones, ibm, poses);
const contract = contractDoc(bones, mesh, skin);
writeFileSync(OUT_CONTRACT, JSON.stringify(contract, null, 2));
writeFileSync(OUT_REPORT, JSON.stringify({
  jsonMeta,
  pass: validation.pass,
  checks: validation.checks,
  influence: skin.influence,
  world: bones.world,
  local: bones.local,
}, null, 2));

console.log(JSON.stringify({
  out: OUT_GLB,
  bytes: glb.length,
  verts: mesh.positions.length,
  tris: mesh.indices.length / 3,
  bones: BONE_NAMES.length,
  height: bones.height,
  gameScale: 16 / bones.height,
  influence: skin.influence,
  pass: validation.pass,
  checks: validation.checks,
}, null, 2));
