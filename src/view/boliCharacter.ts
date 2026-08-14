import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";
import { RHYTHM } from "../sim/types";
import skin1Url from "../../models/bolis/boli_skin1_rigged.glb?url";
import skin2Url from "../../models/bolis/boli_skin2_rigged.glb?url";
import skin3Url from "../../models/bolis/boli_skin3_rigged.glb?url";
import {
  CLIP_CROUCH_IDLE,
  CLIP_CROUCH_WALK,
  CLIP_DOWNED,
  CLIP_IDLE,
  CLIP_WALK,
  buildBoliClips,
} from "./boliClips";

export const BOLI_SKIN_IDS = ["skin1", "skin2", "skin3"] as const;
export type BoliSkinId = (typeof BOLI_SKIN_IDS)[number];
export const BOLI_SKIN1_ID: BoliSkinId = "skin1";
export const BOLI_GAME_SCALE = 8.43;

const SKIN_URLS: Record<BoliSkinId, string> = {
  skin1: skin1Url,
  skin2: skin2Url,
  skin3: skin3Url,
};

export function boliSkinName(id: number | string | undefined | null): BoliSkinId {
  if (id === 1 || id === "skin2" || id === "1") {
    return "skin2";
  }
  if (id === 2 || id === "skin3" || id === "2") {
    return "skin3";
  }
  return "skin1";
}

const MOVE_EPS = 2.2;
const FADE = 0.22;
const DOWNED_FADE = 0.14;

export type BoliLocomotion = {
  walking: boolean;
  crouch: boolean;
  downed: boolean;
  walkTime: number;
  x: number;
  y: number;
  id?: string;
};

export type BoliCharacterUserData = {
  kind: "rigged";
  skinId: string;
  mixer: THREE.AnimationMixer;
  currentClip: string;
  bodyMat: THREE.MeshLambertMaterial;
  weaponSocket: THREE.Object3D | null;
  phase: number;
  idleScale: number;
};

type TrackBinding = {
  interpolant: THREE.Interpolant;
  bone: THREE.Object3D;
  prop: "quaternion" | "position";
};

type ClipBinding = {
  clip: THREE.AnimationClip;
  tracks: TrackBinding[];
};

type Animator = {
  model: THREE.Object3D;
  skins: THREE.SkinnedMesh[];
  mixer: THREE.AnimationMixer;
  bindings: Map<string, ClipBinding>;
  current: string;
  previous: string | null;
  fade: number;
  fadeLen: number;
  times: Record<string, number>;
  phase: number;
  idleScale: number;
  cadence: number;
  speedScale: number;
};

type Template = {
  skinId: BoliSkinId;
  scene: THREE.Group;
  lambert: THREE.MeshLambertMaterial;
  vertexColorAlbedo: boolean;
};

const animators = new WeakMap<THREE.Object3D, Animator>();
const _quat = new THREE.Quaternion();
const _pos = new THREE.Vector3();

const templates = new Map<BoliSkinId, Template>();
let sharedClips: THREE.AnimationClip[] | null = null;
let loading: Promise<void> | null = null;

function toLambert(src: THREE.Material, opts: { facePaint: boolean; vertexColorAlbedo: boolean }): THREE.MeshLambertMaterial {
  const std = src as THREE.MeshStandardMaterial;
  const mat = new THREE.MeshLambertMaterial({
    color: opts.vertexColorAlbedo ? new THREE.Color(0xffffff) : (std.color?.clone() ?? new THREE.Color(0xe4d2b2)),
    fog: true,
    vertexColors: true,
    flatShading: false,
  });
  if (opts.facePaint) {
    applyTongueShader(mat);
  }
  return mat;
}

const TONGUE_RED = new THREE.Color(0xdc1c28);
const EYE_BLACK = new THREE.Color(0x111111);

function isTongueVertex(x: number, y: number, z: number, ny: number): boolean {
  return Math.abs(x) <= 0.125 && y >= 1.545 && y <= 1.62 && z >= 0.14 && ny < -0.4;
}

function isMouthInteriorVertex(x: number, y: number, z: number, ny: number): boolean {
  if (Math.abs(x) > 0.13 || y < 1.555 || y > 1.642 || z < 0.09 || z > 0.29) {
    return false;
  }
  if (ny > 0.4) {
    return true;
  }
  return ny < -0.5 && z < 0.16;
}

function isEyeVertex(x: number, y: number, z: number): boolean {
  if (z < 0.185 || y < 1.645 || y > 1.76) {
    return false;
  }
  const left = ((x + 0.095) / 0.07) ** 2 + ((y - 1.7) / 0.055) ** 2 <= 1 && x < -0.04;
  const right = ((x - 0.11) / 0.075) ** 2 + ((y - 1.68) / 0.05) ** 2 <= 1 && x > 0.04;
  return left || right;
}

function paintTongueGeometry(root: THREE.Object3D): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) {
      return;
    }
    const pos = mesh.geometry.getAttribute("position");
    const nrm = mesh.geometry.getAttribute("normal");
    if (!pos) {
      return;
    }
    const colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const ny = nrm ? nrm.getY(i) : 0;
      if (isTongueVertex(x, y, z, ny)) {
        colors[i * 3] = 1;
        colors[i * 3 + 1] = 0;
        colors[i * 3 + 2] = 0;
      } else if (isMouthInteriorVertex(x, y, z, ny) || isEyeVertex(x, y, z)) {
        colors[i * 3] = 0;
        colors[i * 3 + 1] = 1;
        colors[i * 3 + 2] = 0;
      } else {
        colors[i * 3] = 1;
        colors[i * 3 + 1] = 1;
        colors[i * 3 + 2] = 1;
      }
    }
    mesh.geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  });
}

function applyTongueShader(mat: THREE.MeshLambertMaterial): void {
  mat.vertexColors = true;
  mat.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <color_fragment>",
      `#include <color_fragment>
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(${TONGUE_RED.r}, ${TONGUE_RED.g}, ${TONGUE_RED.b}), 1.0 - vColor.g);
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(${EYE_BLACK.r}, ${EYE_BLACK.g}, ${EYE_BLACK.b}), 1.0 - vColor.r);`,
    );
  };
  mat.customProgramCacheKey = () => "boli-face-tongue-eyes";
}

function hash01(text: string, salt = 0): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

async function loadSkinTemplate(skinId: BoliSkinId): Promise<Template> {
  const existing = templates.get(skinId);
  if (existing) {
    return existing;
  }
  const gltf = await new Promise<GLTF>((resolve, reject) => {
    new GLTFLoader().load(SKIN_URLS[skinId], resolve, undefined, reject);
  });
  const vertexColorAlbedo = skinId !== "skin1";
  gltf.scene.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) {
      return;
    }
    const src = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    mesh.material = toLambert(src, { facePaint: skinId === "skin1", vertexColorAlbedo });
    mesh.castShadow = false;
    mesh.receiveShadow = false;
  });
  if (skinId === "skin1") {
    paintTongueGeometry(gltf.scene);
    sharedClips = buildBoliClips(gltf.scene);
  }
  const lambert = findLambert(gltf.scene) ?? new THREE.MeshLambertMaterial({
    color: vertexColorAlbedo ? 0xffffff : 0xe4d2b2,
    fog: true,
    vertexColors: true,
    flatShading: false,
  });
  const template: Template = { skinId, scene: gltf.scene, lambert, vertexColorAlbedo };
  templates.set(skinId, template);
  return template;
}

async function loadAllTemplates(): Promise<void> {
  if (templates.has("skin1") && templates.has("skin2") && templates.has("skin3")) {
    return;
  }
  if (!loading) {
    loading = (async () => {
      await loadSkinTemplate("skin1");
      await Promise.all([
        loadSkinTemplate("skin2").catch((err) => {
          console.warn("No se pudo cargar Skin 2; se usa Skin 1:", err);
        }),
        loadSkinTemplate("skin3").catch((err) => {
          console.warn("No se pudo cargar Skin 3; se usa Skin 1:", err);
        }),
      ]);
    })();
  }
  return loading;
}

function findLambert(root: THREE.Object3D): THREE.MeshLambertMaterial | null {
  let found: THREE.MeshLambertMaterial | null = null;
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.isMesh && mesh.material && !Array.isArray(mesh.material) && found === null) {
      found = mesh.material as THREE.MeshLambertMaterial;
    }
  });
  return found;
}

function bindClip(model: THREE.Object3D, clip: THREE.AnimationClip): ClipBinding {
  const tracks: TrackBinding[] = [];
  for (const track of clip.tracks) {
    const split = track.name.lastIndexOf(".");
    const boneName = track.name.slice(0, split);
    const prop = track.name.slice(split + 1);
    const bone = model.getObjectByName(boneName);
    if (!bone || (prop !== "quaternion" && prop !== "position")) {
      continue;
    }
    tracks.push({
      interpolant: (track as unknown as { createInterpolant: () => THREE.Interpolant }).createInterpolant(),
      bone,
      prop,
    });
  }
  return { clip, tracks };
}

function applyClip(binding: ClipBinding, time: number, weight: number): void {
  if (weight <= 0.001 || binding.tracks.length === 0) {
    return;
  }
  const duration = binding.clip.duration || 1;
  const t = ((time % duration) + duration) % duration;
  const replace = weight >= 0.999;
  for (const track of binding.tracks) {
    const value = track.interpolant.evaluate(t) as Float32Array;
    if (track.prop === "quaternion") {
      _quat.set(value[0], value[1], value[2], value[3]);
      if (replace) {
        track.bone.quaternion.copy(_quat);
      } else {
        track.bone.quaternion.slerp(_quat, weight);
      }
    } else {
      _pos.set(value[0], value[1], value[2]);
      if (replace) {
        track.bone.position.copy(_pos);
      } else {
        track.bone.position.lerp(_pos, weight);
      }
    }
  }
}

export function preloadBoliCharacters(): Promise<void> {
  return loadAllTemplates();
}

export function boliTemplateReady(): boolean {
  return templates.has("skin1") && sharedClips !== null;
}

export function createBoliCharacter(opts: {
  color: number;
  hunter: boolean;
  skinId?: number | string;
  weapon?: THREE.Object3D;
  seed?: string;
}): THREE.Group {
  const root = new THREE.Group();
  const requested = boliSkinName(opts.hunter ? "skin1" : opts.skinId);
  const template = templates.get(requested) ?? templates.get("skin1");
  if (!template || !sharedClips) {
    return root;
  }

  const model = cloneSkinned(template.scene);
  model.scale.setScalar(BOLI_GAME_SCALE);
  const skins: THREE.SkinnedMesh[] = [];
  const bodyMat = template.lambert.clone();
  if (template.skinId === "skin1") {
    applyTongueShader(bodyMat);
    bodyMat.color.setHex(opts.color);
  } else {
    bodyMat.color.setHex(0xffffff);
    bodyMat.flatShading = false;
  }
  model.traverse((obj) => {
    const mesh = obj as THREE.SkinnedMesh;
    if (mesh.isSkinnedMesh) {
      mesh.bindMode = "attached";
      mesh.frustumCulled = false;
      mesh.material = bodyMat;
      skins.push(mesh);
    } else if (mesh.isMesh) {
      mesh.material = bodyMat;
      mesh.frustumCulled = false;
    }
  });
  root.add(model);

  const mixer = new THREE.AnimationMixer(model);
  const bindings = new Map<string, ClipBinding>();
  const times: Record<string, number> = {};
  for (const clip of sharedClips) {
    const action = mixer.clipAction(clip);
    if (clip.name === CLIP_DOWNED) {
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
    } else {
      action.setLoop(THREE.LoopRepeat, Infinity);
    }
    action.enabled = true;
    action.weight = clip.name === CLIP_IDLE ? 1 : 0;
    action.play();
    bindings.set(clip.name, bindClip(model, clip));
    times[clip.name] = 0;
  }

  const weaponSocket = model.getObjectByName("WeaponSocket") ?? null;
  if (opts.weapon && weaponSocket) {
    opts.weapon.scale.setScalar(0.085);
    opts.weapon.rotation.set(0, Math.PI, 0.12);
    opts.weapon.position.set(0.02, -0.01, 0.04);
    weaponSocket.add(opts.weapon);
  }

  const seed = opts.seed ?? Math.random().toString(36);
  const phase = hash01(seed, 1);
  const idleScale = 0.82 + hash01(seed, 2) * 0.36;
  const cadence = 0.9 + hash01(seed, 3) * 0.2;
  const idleBind = bindings.get(CLIP_IDLE);
  if (idleBind) {
    times[CLIP_IDLE] = phase * idleBind.clip.duration;
    applyClip(idleBind, times[CLIP_IDLE], 1);
    model.updateMatrixWorld(true);
    for (const skin of skins) {
      skin.skeleton.update();
    }
  }
  if (skins.length === 0 || (idleBind && idleBind.tracks.length === 0)) {
    console.warn("Boli: el skeleton no se enlazó; skin=", template.skinId, "skins=", skins.length, "tracks=", idleBind?.tracks.length ?? 0);
  }

  const animator: Animator = {
    model,
    skins,
    mixer,
    bindings,
    current: CLIP_IDLE,
    previous: null,
    fade: 1,
    fadeLen: FADE,
    times,
    phase,
    idleScale,
    cadence,
    speedScale: 1,
  };
  animators.set(root, animator);

  const data: BoliCharacterUserData = {
    kind: "rigged",
    skinId: requested,
    mixer,
    currentClip: CLIP_IDLE,
    bodyMat,
    weaponSocket,
    phase,
    idleScale,
  };
  Object.assign(root.userData, data);
  root.userData.bodyMat = bodyMat;
  root.userData.mixer = mixer;
  return root;
}

export function isRiggedBoli(mesh: THREE.Object3D): boolean {
  return mesh.userData.kind === "rigged" || animators.has(mesh);
}

export function syncBoliAnimation(mesh: THREE.Group, loco: BoliLocomotion): void {
  const animator = animators.get(mesh);
  if (!animator) {
    return;
  }
  const speed = sampleMoveSpeed(mesh, loco.x, loco.y);
  const moving = !loco.downed && (loco.walking || speed > MOVE_EPS);
  const clip = loco.downed
    ? CLIP_DOWNED
    : loco.crouch && moving
      ? CLIP_CROUCH_WALK
      : loco.crouch
        ? CLIP_CROUCH_IDLE
        : moving
          ? CLIP_WALK
          : CLIP_IDLE;
  if (clip === CLIP_WALK || clip === CLIP_CROUCH_WALK) {
    animator.speedScale = THREE.MathUtils.clamp(speed / RHYTHM.speed, 0.35, 1.65) * animator.cadence;
  }
  if (animator.current !== clip) {
    animator.previous = animator.current;
    animator.current = clip;
    animator.fade = 0;
    animator.fadeLen = clip === CLIP_DOWNED ? DOWNED_FADE : FADE;
    const bound = animator.bindings.get(clip);
    if (bound && (clip === CLIP_WALK || clip === CLIP_CROUCH_WALK)) {
      animator.times[clip] = (loco.walkTime * 0.37 + animator.phase * bound.clip.duration) % bound.clip.duration;
    }
    if (clip === CLIP_DOWNED) {
      animator.times[clip] = 0;
    }
    mesh.userData.currentClip = clip;
  }
}

export function tickBoliAnimation(mesh: THREE.Group, dt: number): void {
  const animator = animators.get(mesh);
  if (!animator) {
    return;
  }
  const step = Math.max(0, dt);
  animator.mixer.update(step);

  const current = animator.bindings.get(animator.current);
  if (!current) {
    return;
  }
  const loc = animator.current === CLIP_WALK || animator.current === CLIP_CROUCH_WALK;
  const scale = loc ? animator.speedScale : animator.current === CLIP_IDLE || animator.current === CLIP_CROUCH_IDLE
    ? animator.idleScale
    : 1;
  animator.times[animator.current] = (animator.times[animator.current] ?? 0) + step * scale;
  if (animator.current === CLIP_DOWNED) {
    animator.times[CLIP_DOWNED] = Math.min(animator.times[CLIP_DOWNED], current.clip.duration);
  }

  if (animator.previous && animator.fade < 1) {
    animator.fade = Math.min(1, animator.fade + step / animator.fadeLen);
    const prev = animator.bindings.get(animator.previous);
    if (prev) {
      const prevLoc = animator.previous === CLIP_WALK || animator.previous === CLIP_CROUCH_WALK;
      animator.times[animator.previous] += step * (prevLoc ? animator.speedScale : animator.idleScale);
      applyClip(prev, animator.times[animator.previous], 1);
    }
    applyClip(current, animator.times[animator.current], animator.fade);
    if (animator.fade >= 1) {
      animator.previous = null;
    }
  } else {
    applyClip(current, animator.times[animator.current], 1);
  }

  animator.model.updateMatrixWorld(true);
  for (const skin of animator.skins) {
    skin.skeleton.update();
  }
}

function sampleMoveSpeed(mesh: THREE.Group, x: number, y: number): number {
  const now = performance.now();
  const prevT = Number(mesh.userData._animT ?? now);
  const elapsed = (now - prevT) / 1000;
  const px = Number(mesh.userData._animX ?? x);
  const py = Number(mesh.userData._animY ?? y);
  const dist = Math.hypot(x - px, y - py);
  const prevSpeed = Number(mesh.userData._animSpeed ?? 0);
  if (elapsed < 0.008 && dist < 0.0001) {
    return prevSpeed;
  }
  const dt = Math.max(1 / 120, elapsed);
  const raw = dist / dt;
  const speed = prevSpeed === 0 ? raw : prevSpeed * 0.72 + raw * 0.28;
  mesh.userData._animT = now;
  mesh.userData._animX = x;
  mesh.userData._animY = y;
  mesh.userData._animSpeed = speed;
  return speed;
}
