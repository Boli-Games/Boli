import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { mulberry32 } from "../sim/rng";

/** How far the forest floor and trees extend past the playable map. */
export const FOREST_EXTENT = 168;

const HEIGHT_A = 32;
const HEIGHT_B = 38;
const HEIGHT_PINE = 62;
const HEIGHT_BUSH = 9;
const LOG_LENGTH = 26;

const FOREST_SEED = 0xb011;
const MAX_SWAY = 0.012;

const FOREST_A_URL = "/models/trees/vibrant-forest.glb";
const PINE_URL = "/models/trees/cartoon-tree.glb";
const LOG_URL = "/models/trees/cartoon-fallen-tree.glb";
const LOG_PARTS = ["log_main_99", "log_inside.001_19", "log_inside_01_21", "moss_72"];

type Kind = "a" | "b" | "pine";

type Prototype = {
  geometry: THREE.BufferGeometry;
  material: THREE.MeshLambertMaterial;
  height: number;
};

type Placement = {
  kind: Kind;
  x: number;
  z: number;
  yaw: number;
  scale: number;
  phase: number;
};

export type ForestRig = {
  layout: (width: number, height: number) => void;
  tick: (paused: boolean) => void;
};

type ForestAssets = {
  trees: Record<Kind, Prototype>;
  bush: Prototype | null;
  logParts: Prototype[];
};

export function createForest(scene: THREE.Scene): ForestRig {
  const root = new THREE.Group();
  root.name = "forest";
  scene.add(root);

  let loadStarted = false;
  let assets: ForestAssets | null = null;
  let pending: { width: number; height: number } | null = null;
  let windTime = 0;
  let lastTick = performance.now();
  const meshes: Partial<Record<Kind, THREE.InstancedMesh>> = {};
  let bushMesh: THREE.InstancedMesh | null = null;
  const logMeshes: THREE.InstancedMesh[] = [];

  function layout(width: number, height: number): void {
    pending = { width, height };
    if (!loadStarted) {
      loadStarted = true;
      void loadPrototypes()
        .then((loaded) => {
          assets = loaded;
          if (pending) {
            rebuild(pending.width, pending.height);
          }
        })
        .catch((err) => {
          console.warn("No se pudieron cargar los árboles del borde:", err);
        });
    } else if (assets) {
      rebuild(width, height);
    }
  }

  function rebuild(width: number, height: number): void {
    if (!assets) {
      return;
    }
    clearMeshes();
    const rng = mulberry32(FOREST_SEED);
    const placements = scatterForest(width, height, rng);
    const byKind: Record<Kind, Placement[]> = { a: [], b: [], pine: [] };
    for (const place of placements) {
      byKind[place.kind].push(place);
    }
    (Object.keys(byKind) as Kind[]).forEach((kind) => {
      const list = byKind[kind];
      if (list.length === 0) {
        return;
      }
      meshes[kind] = makeInstanced(assets!.trees[kind], list);
      root.add(meshes[kind]!);
    });

    try {
      const bushes = assets.bush ? scatterBushes(width, height, placements, rng) : [];
      if (assets.bush && bushes.length > 0) {
        bushMesh = makeInstancedProp(assets.bush, bushes);
        root.add(bushMesh);
      }
    } catch (err) {
      console.warn("No se pudieron colocar los arbustos:", err);
    }
    try {
      const logs = assets.logParts.length > 0 ? scatterLogs(width, height, placements, rng) : [];
      if (logs.length > 0) {
        for (const part of assets.logParts) {
          const mesh = makeInstancedProp(part, logs);
          logMeshes.push(mesh);
          root.add(mesh);
        }
      }
    } catch (err) {
      console.warn("No se pudieron colocar los troncos:", err);
    }
  }

  function clearMeshes(): void {
    for (const kind of Object.keys(meshes) as Kind[]) {
      const mesh = meshes[kind];
      if (!mesh) {
        continue;
      }
      root.remove(mesh);
      mesh.geometry.dispose();
      mesh.dispose();
      meshes[kind] = undefined;
    }
    if (bushMesh) {
      root.remove(bushMesh);
      bushMesh.geometry.dispose();
      bushMesh.dispose();
      bushMesh = null;
    }
    for (const mesh of logMeshes) {
      root.remove(mesh);
      mesh.geometry.dispose();
      mesh.dispose();
    }
    logMeshes.length = 0;
  }

  function tick(paused: boolean): void {
    const now = performance.now();
    const dt = Math.min(0.05, (now - lastTick) / 1000);
    lastTick = now;
    if (!paused) {
      windTime += dt;
    }
    for (const kind of Object.keys(meshes) as Kind[]) {
      const mesh = meshes[kind];
      const proto = assets?.trees[kind];
      if (!mesh || !proto) {
        continue;
      }
      const wind = proto.material.userData.wind as { time: { value: number } } | undefined;
      if (wind) {
        wind.time.value = windTime;
      }
    }
  }

  return { layout, tick };
}

async function loadPrototypes(): Promise<ForestAssets> {
  const loader = new GLTFLoader();
  const [forestGltf, pineGltf] = await Promise.all([
    loader.loadAsync(FOREST_A_URL),
    loader.loadAsync(PINE_URL),
  ]);

  const treeA = extractNamed(forestGltf.scene, "polySurface7", HEIGHT_A);
  const treeB = extractNamed(forestGltf.scene, "polySurface11", HEIGHT_B);
  const pine = extractRoot(pineGltf.scene, HEIGHT_PINE);

  let bush: Prototype | null = null;
  try {
    bush = extractNamed(forestGltf.scene, "pCube17", HEIGHT_BUSH, false);
  } catch (err) {
    console.warn("No se pudo extraer el arbusto del bosque:", err);
  }

  disposeScene(
    forestGltf.scene,
    keepTextures(treeA.material, treeB.material, ...(bush ? [bush.material] : [])),
  );
  disposeScene(pineGltf.scene, keepTextures(pine.material));

  let logParts: Prototype[] = [];
  try {
    const logGltf = await loader.loadAsync(LOG_URL);
    logParts = bakeNamedParts(logGltf.scene, LOG_PARTS, LOG_LENGTH);
    disposeScene(logGltf.scene, keepTextures(...logParts.map((part) => part.material)));
  } catch (err) {
    console.warn("No se pudieron cargar los troncos caídos:", err);
  }

  return { trees: { a: treeA, b: treeB, pine }, bush, logParts };
}

function extractNamed(scene: THREE.Object3D, name: string, height: number, wind = true): Prototype {
  const node = findNode(scene, name);
  if (!node) {
    throw new Error(`No se encontró el prototipo ${name}`);
  }
  return bakePrototype(node, height, wind);
}

function extractRoot(scene: THREE.Object3D, height: number): Prototype {
  return bakePrototype(scene, height);
}

function bakePrototype(node: THREE.Object3D, height: number, wind = true): Prototype {
  node.updateWorldMatrix(true, true);
  const geos: THREE.BufferGeometry[] = [];
  let sourceMat: THREE.Material | null = null;
  node.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) {
      return;
    }
    const geo = mesh.geometry.clone();
    geo.applyMatrix4(mesh.matrixWorld);
    geos.push(geo);
    if (!sourceMat) {
      sourceMat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    }
  });
  if (geos.length === 0 || !sourceMat) {
    throw new Error("El prototipo no tiene mallas");
  }
  const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
  if (!merged) {
    throw new Error("No se pudo combinar la geometría del árbol");
  }
  merged.deleteAttribute("tangent");
  merged.computeBoundingBox();
  const box = merged.boundingBox;
  if (!box) {
    throw new Error("El árbol no tiene bounding box");
  }
  const midX = (box.min.x + box.max.x) * 0.5;
  const midZ = (box.min.z + box.max.z) * 0.5;
  merged.translate(-midX, -box.min.y, -midZ);
  const nativeH = Math.max(0.001, box.max.y - box.min.y);
  const scale = height / nativeH;
  merged.scale(scale, scale, scale);
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  if (geos.length > 1) {
    for (const geo of geos) {
      geo.dispose();
    }
  }
  const material = toLambert(sourceMat);
  if (wind) {
    applyWind(material, height);
  }
  return { geometry: merged, material, height };
}

function toLambert(src: THREE.Material): THREE.MeshLambertMaterial {
  const std = src as THREE.MeshStandardMaterial;
  const map = std.map ?? null;
  if (map) {
    map.colorSpace = THREE.SRGBColorSpace;
    map.needsUpdate = true;
  }
  return new THREE.MeshLambertMaterial({
    map,
    color: map ? 0xffffff : std.color?.getHex() ?? 0xffffff,
    fog: true,
  });
}

function applyWind(material: THREE.MeshLambertMaterial, height: number): void {
  const uniforms = {
    time: { value: 0 },
    height: { value: height },
  };
  material.userData.wind = uniforms;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uWindTime = uniforms.time;
    shader.uniforms.uTreeHeight = uniforms.height;
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
attribute float windPhase;
uniform float uWindTime;
uniform float uTreeHeight;`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
float tip = clamp(position.y / max(uTreeHeight, 0.001), 0.0, 1.0);
tip = tip * tip;
float t = uWindTime;
float sway = sin(t * 0.58 + windPhase) * ${MAX_SWAY.toFixed(4)}
  + sin(t * 0.31 + windPhase * 1.73) * 0.006;
transformed.x += sway * tip * uTreeHeight;
transformed.z += cos(t * 0.44 + windPhase * 0.91) * 0.008 * tip * uTreeHeight;`,
      );
  };
  material.customProgramCacheKey = () => "boli-tree-wind";
}

function makeInstanced(proto: Prototype, list: Placement[]): THREE.InstancedMesh {
  const geo = proto.geometry.clone();
  const phases = new Float32Array(list.length);
  const dummy = new THREE.Object3D();
  const mesh = new THREE.InstancedMesh(geo, proto.material, list.length);
  mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  list.forEach((place, i) => {
    dummy.position.set(place.x, 0, place.z);
    dummy.rotation.set(0, place.yaw, 0);
    dummy.scale.setScalar(place.scale);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    phases[i] = place.phase;
  });
  geo.setAttribute("windPhase", new THREE.InstancedBufferAttribute(phases, 1));
  mesh.instanceMatrix.needsUpdate = true;
  mesh.frustumCulled = false;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function makeInstancedProp(proto: Prototype, list: Placement[]): THREE.InstancedMesh {
  const geo = proto.geometry.clone();
  const dummy = new THREE.Object3D();
  const mesh = new THREE.InstancedMesh(geo, proto.material, list.length);
  mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  list.forEach((place, i) => {
    dummy.position.set(place.x, 0, place.z);
    dummy.rotation.set(0, place.yaw, 0);
    dummy.scale.setScalar(place.scale);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.frustumCulled = false;
  return mesh;
}

function bakeNamedParts(scene: THREE.Object3D, names: string[], targetSpan: number): Prototype[] {
  scene.updateWorldMatrix(true, true);
  const items: { geo: THREE.BufferGeometry; src: THREE.Material }[] = [];
  for (const name of names) {
    const node = findNode(scene, name);
    if (!node) {
      console.warn(`No se encontró la parte del tronco: ${name}`);
      continue;
    }
    node.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh || !mesh.geometry) {
        return;
      }
      const geo = mesh.geometry.clone();
      geo.applyMatrix4(mesh.matrixWorld);
      geo.deleteAttribute("tangent");
      const src = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      items.push({ geo, src });
    });
  }
  if (items.length === 0) {
    throw new Error("El tronco no tiene mallas");
  }
  const box = new THREE.Box3();
  for (const item of items) {
    item.geo.computeBoundingBox();
    if (item.geo.boundingBox) {
      box.union(item.geo.boundingBox);
    }
  }
  if (box.isEmpty()) {
    throw new Error("El tronco no tiene bounding box");
  }
  const size = new THREE.Vector3();
  box.getSize(size);
  const midX = (box.min.x + box.max.x) * 0.5;
  const midZ = (box.min.z + box.max.z) * 0.5;
  const span = Math.max(size.x, size.z, 0.001);
  const scale = targetSpan / span;
  const offset = new THREE.Matrix4()
    .makeScale(scale, scale, scale)
    .multiply(new THREE.Matrix4().makeTranslation(-midX, -box.min.y, -midZ));
  for (const item of items) {
    item.geo.applyMatrix4(offset);
    item.geo.computeBoundingBox();
    item.geo.computeBoundingSphere();
  }

  const parts: Prototype[] = [];
  for (const item of items) {
    parts.push({ geometry: item.geo, material: toLambert(item.src), height: size.y * scale });
  }
  return parts;
}

function findNode(root: THREE.Object3D, name: string): THREE.Object3D | undefined {
  const exact = root.getObjectByName(name);
  if (exact) {
    return exact;
  }
  let found: THREE.Object3D | undefined;
  root.traverse((obj) => {
    if (!found && obj.name === name) {
      found = obj;
    }
  });
  return found;
}

function scatterBushes(width: number, height: number, trees: Placement[], rng: () => number): Placement[] {
  const bushes: Placement[] = [];
  const scale: [number, number] = [0.78, 1.14];
  for (const tree of trees) {
    if (rng() > 0.28) {
      continue;
    }
    const extra = rng() < 0.2 ? 2 : 1;
    for (let i = 0; i < extra; i++) {
      const ang = rng() * Math.PI * 2;
      const dist = 5.2 + rng() * 7.5;
      const x = tree.x + Math.cos(ang) * dist;
      const z = tree.z + Math.sin(ang) * dist;
      if (!inForestBelt(x, z, width, height) || tooClose(x, z, 4.2, trees) || tooClose(x, z, 4.8, bushes)) {
        continue;
      }
      bushes.push(makePropPlace(x, z, scale, rng));
    }
  }
  forEachSidePoint(width, height, 14, FOREST_EXTENT - 12, 46, rng, (x, z) => {
    if (rng() < 0.58) {
      return;
    }
    if (!inForestBelt(x, z, width, height) || tooClose(x, z, 6.5, trees) || tooClose(x, z, 6.2, bushes)) {
      return;
    }
    bushes.push(makePropPlace(x, z, scale, rng));
    if (rng() < 0.18) {
      const ang = rng() * Math.PI * 2;
      const dist = 4.5 + rng() * 5;
      const gx = x + Math.cos(ang) * dist;
      const gz = z + Math.sin(ang) * dist;
      if (inForestBelt(gx, gz, width, height) && !tooClose(gx, gz, 4.5, trees) && !tooClose(gx, gz, 4.8, bushes)) {
        bushes.push(makePropPlace(gx, gz, scale, rng));
      }
    }
  });
  return bushes;
}

function scatterLogs(width: number, height: number, trees: Placement[], rng: () => number): Placement[] {
  const logs: Placement[] = [];
  const scale: [number, number] = [0.9, 1.16];
  forEachSidePoint(width, height, 26, 92, 88, rng, (x, z) => {
    if (logs.length >= 11 || rng() < 0.38) {
      return;
    }
    if (!inForestBelt(x, z, width, height) || tooClose(x, z, 12, trees) || tooClose(x, z, 70, logs)) {
      return;
    }
    logs.push(makePropPlace(x, z, scale, rng));
  });
  return logs;
}

function makePropPlace(x: number, z: number, scale: readonly [number, number], rng: () => number): Placement {
  return {
    kind: "a",
    x,
    z,
    yaw: rng() * Math.PI * 2,
    scale: scale[0] + rng() * (scale[1] - scale[0]),
    phase: 0,
  };
}

function inForestBelt(x: number, z: number, width: number, height: number): boolean {
  if (insideMap(x, z, width, height, 4)) {
    return false;
  }
  return x > -FOREST_EXTENT + 6 && z > -FOREST_EXTENT + 6 && x < width + FOREST_EXTENT - 6 && z < height + FOREST_EXTENT - 6;
}

function scatterForest(width: number, height: number, rng: () => number): Placement[] {
  const placed: Placement[] = [];

  const rings = [
    { inner: 9, outer: 28, step: 78, skip: 0.22, pine: 0.16, minDist: 16, scale: [0.9, 1.12] as const },
    { inner: 28, outer: 74, step: 36, skip: 0.1, pine: 0.07, minDist: 12, scale: [0.84, 1.18] as const },
    { inner: 74, outer: FOREST_EXTENT - 6, step: 22, skip: 0.05, pine: 0.03, minDist: 10, scale: [0.92, 1.26] as const },
  ];

  for (const ring of rings) {
    forEachSidePoint(width, height, ring.inner, ring.outer, ring.step, rng, (x, z) => {
      if (rng() < ring.skip) {
        return;
      }
      if (tooClose(x, z, ring.minDist, placed)) {
        return;
      }
      const kind: Kind = rng() < ring.pine ? "pine" : rng() < 0.48 ? "a" : "b";
      placed.push(makePlace(kind, x, z, ring.scale, rng));
      if (ring.inner > 20 && rng() < 0.18) {
        const ang = rng() * Math.PI * 2;
        const dist = 7 + rng() * 9;
        const cx = x + Math.cos(ang) * dist;
        const cz = z + Math.sin(ang) * dist;
        if (!insideMap(cx, cz, width, height, 4) && !tooClose(cx, cz, ring.minDist * 0.85, placed)) {
          const other: Kind = kind === "a" ? "b" : "a";
          placed.push(makePlace(other, cx, cz, ring.scale, rng));
        }
      }
    });
  }
  return placed;
}

function makePlace(
  kind: Kind,
  x: number,
  z: number,
  scale: readonly [number, number],
  rng: () => number,
): Placement {
  const pineScale = kind === "pine" ? 0.92 + rng() * 0.16 : scale[0] + rng() * (scale[1] - scale[0]);
  return {
    kind,
    x,
    z,
    yaw: rng() * Math.PI * 2,
    scale: pineScale,
    phase: rng() * Math.PI * 2,
  };
}

function forEachSidePoint(
  width: number,
  height: number,
  inner: number,
  outer: number,
  step: number,
  rng: () => number,
  visit: (x: number, z: number) => void,
): void {
  const depth = (inner + outer) * 0.5;
  const sides = [
    { x0: -depth, z0: -depth, x1: width + depth, z1: -depth, nx: 0, nz: -1 },
    { x0: width + depth, z0: -depth, x1: width + depth, z1: height + depth, nx: 1, nz: 0 },
    { x0: width + depth, z0: height + depth, x1: -depth, z1: height + depth, nx: 0, nz: 1 },
    { x0: -depth, z0: height + depth, x1: -depth, z1: -depth, nx: -1, nz: 0 },
  ];
  for (const side of sides) {
    const len = Math.hypot(side.x1 - side.x0, side.z1 - side.z0);
    let d = rng() * step * 0.55;
    while (d < len) {
      const u = d / len;
      const alongX = side.x0 + (side.x1 - side.x0) * u;
      const alongZ = side.z0 + (side.z1 - side.z0) * u;
      const extra = inner + rng() * (outer - inner) - depth;
      const jitter = (rng() - 0.5) * step * 0.5;
      const tx = -(side.z1 - side.z0) / len;
      const tz = (side.x1 - side.x0) / len;
      visit(alongX + side.nx * extra + tx * jitter, alongZ + side.nz * extra + tz * jitter);
      d += step * (0.72 + rng() * 0.56);
    }
  }
}

function insideMap(x: number, z: number, width: number, height: number, pad: number): boolean {
  return x > pad && z > pad && x < width - pad && z < height - pad;
}

function tooClose(x: number, z: number, minDist: number, placed: Placement[]): boolean {
  const min2 = minDist * minDist;
  for (const other of placed) {
    const dx = other.x - x;
    const dz = other.z - z;
    if (dx * dx + dz * dz < min2) {
      return true;
    }
  }
  return false;
}

function keepTextures(...materials: THREE.MeshLambertMaterial[]): Set<THREE.Texture> {
  const keep = new Set<THREE.Texture>();
  for (const mat of materials) {
    if (mat.map) {
      keep.add(mat.map);
    }
  }
  return keep;
}

function disposeScene(root: THREE.Object3D, keep: Set<THREE.Texture>): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) {
      return;
    }
    mesh.geometry.dispose();
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) {
      const std = mat as THREE.MeshStandardMaterial;
      disposeTex(std.map, keep);
      disposeTex(std.normalMap, keep);
      disposeTex(std.metalnessMap, keep);
      disposeTex(std.roughnessMap, keep);
      disposeTex(std.aoMap, keep);
      disposeTex(std.emissiveMap, keep);
      mat.dispose();
    }
  });
}

function disposeTex(tex: THREE.Texture | null | undefined, keep: Set<THREE.Texture>): void {
  if (tex && !keep.has(tex)) {
    tex.dispose();
  }
}
