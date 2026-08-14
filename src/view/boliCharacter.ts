import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";
import { RHYTHM } from "../sim/types";
import skin1Url from "../../models/bolis/boli_skin1_rigged.glb?url";
import {
  CLIP_CROUCH_IDLE,
  CLIP_CROUCH_WALK,
  CLIP_DOWNED,
  CLIP_IDLE,
  CLIP_WALK,
  buildBoliClips,
} from "./boliClips";

export const BOLI_SKIN1_ID = "skin1";
export const BOLI_GAME_SCALE = 8.43;

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
  actions: Map<string, THREE.AnimationAction>;
  currentClip: string;
  bodyMat: THREE.MeshLambertMaterial;
  weaponSocket: THREE.Object3D | null;
  phase: number;
  idleScale: number;
};

type Template = {
  scene: THREE.Group;
  clips: THREE.AnimationClip[];
  lambert: THREE.MeshLambertMaterial;
};

let template: Template | null = null;
let loading: Promise<Template> | null = null;

function toLambert(src: THREE.Material): THREE.MeshLambertMaterial {
  const std = src as THREE.MeshStandardMaterial;
  return new THREE.MeshLambertMaterial({
    color: std.color?.clone() ?? new THREE.Color(0xe4d2b2),
    fog: true,
  });
}

function hash01(text: string, salt = 0): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

async function loadTemplate(): Promise<Template> {
  if (template) {
    return template;
  }
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const loader = new GLTFLoader();
      loader.load(
        skin1Url,
        (gltf: GLTF) => {
          gltf.scene.traverse((obj) => {
            const mesh = obj as THREE.Mesh;
            if (!mesh.isMesh) {
              return;
            }
            const src = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
            mesh.material = toLambert(src);
            mesh.castShadow = false;
            mesh.receiveShadow = false;
          });
          const lambert = findLambert(gltf.scene) ?? new THREE.MeshLambertMaterial({ color: 0xe4d2b2, fog: true });
          template = {
            scene: gltf.scene,
            clips: buildBoliClips(gltf.scene),
            lambert,
          };
          resolve(template);
        },
        undefined,
        reject,
      );
    });
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

function rebindSkeleton(root: THREE.Object3D): void {
  const bones = new Map<string, THREE.Bone>();
  root.traverse((obj) => {
    const bone = obj as THREE.Bone;
    if (bone.isBone) {
      bones.set(bone.name, bone);
    }
  });
  root.traverse((obj) => {
    const mesh = obj as THREE.SkinnedMesh;
    if (!mesh.isSkinnedMesh || !mesh.skeleton) {
      return;
    }
    mesh.bindMode = "attached";
    mesh.skeleton.bones = mesh.skeleton.bones.map((bone) => {
      if (!bone) {
        return bone;
      }
      return bones.get(bone.name) ?? bone;
    });
    mesh.bind(mesh.skeleton, mesh.bindMatrix);
    mesh.normalizeSkinWeights();
    mesh.frustumCulled = false;
  });
}

export function preloadBoliCharacters(): Promise<void> {
  return loadTemplate().then(() => undefined);
}

export function boliTemplateReady(): boolean {
  return template !== null;
}

export function createBoliCharacter(opts: {
  color: number;
  hunter: boolean;
  skinId?: string;
  weapon?: THREE.Object3D;
  seed?: string;
}): THREE.Group {
  const root = new THREE.Group();
  if (!template) {
    return root;
  }

  const model = cloneSkinned(template.scene);
  model.scale.setScalar(BOLI_GAME_SCALE);
  rebindSkeleton(model);
  const bodyMat = template.lambert.clone();
  bodyMat.color.setHex(opts.color);
  model.traverse((obj) => {
    const mesh = obj as THREE.SkinnedMesh;
    if (mesh.isMesh) {
      mesh.material = bodyMat;
      mesh.frustumCulled = false;
    }
  });
  root.add(model);

  const mixer = new THREE.AnimationMixer(model);
  const actions = new Map<string, THREE.AnimationAction>();
  for (const clip of template.clips) {
    const action = mixer.clipAction(clip);
    if (clip.name === CLIP_DOWNED) {
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
    } else {
      action.setLoop(THREE.LoopRepeat, Infinity);
    }
    action.enabled = true;
    action.weight = 0;
    actions.set(clip.name, action);
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
  const idle = actions.get(CLIP_IDLE);
  if (idle) {
    idle.weight = 1;
    idle.time = phase * idle.getClip().duration;
    idle.timeScale = idleScale;
    idle.play();
  }
  mixer.update(0);

  const data: BoliCharacterUserData = {
    kind: "rigged",
    skinId: opts.skinId ?? BOLI_SKIN1_ID,
    mixer,
    actions,
    currentClip: CLIP_IDLE,
    bodyMat,
    weaponSocket,
    phase,
    idleScale,
  };
  Object.assign(root.userData, data);
  root.userData._cadence = cadence;
  root.userData.bodyMat = bodyMat;
  root.userData.mixer = mixer;
  return root;
}

export function isRiggedBoli(mesh: THREE.Object3D): boolean {
  return mesh.userData.kind === "rigged";
}

export function syncBoliAnimation(mesh: THREE.Group, loco: BoliLocomotion): void {
  if (!isRiggedBoli(mesh)) {
    return;
  }
  ensurePhase(mesh, loco.id);
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
  fadeTo(mesh, clip, loco);
  applyWalkTiming(mesh, loco, clip, speed);
}

export function tickBoliAnimation(mesh: THREE.Group, dt: number): void {
  const mixer = mesh.userData.mixer as THREE.AnimationMixer | undefined;
  if (!mixer || dt < 0) {
    return;
  }
  mixer.update(dt > 0 ? dt : 0);
}

function ensurePhase(mesh: THREE.Group, id?: string): void {
  if (mesh.userData.phase !== undefined || !id) {
    return;
  }
  mesh.userData.phase = hash01(id, 1);
  mesh.userData.idleScale = 0.82 + hash01(id, 2) * 0.36;
  mesh.userData._cadence = 0.9 + hash01(id, 3) * 0.2;
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

function applyWalkTiming(mesh: THREE.Group, loco: BoliLocomotion, clipName: string, speed: number): void {
  if (clipName !== CLIP_WALK && clipName !== CLIP_CROUCH_WALK) {
    mesh.userData._walkClip = "";
    return;
  }
  const actions = mesh.userData.actions as Map<string, THREE.AnimationAction>;
  const action = actions.get(clipName);
  if (!action) {
    return;
  }
  const cadence = Number(mesh.userData._cadence ?? 1);
  const rawScale = THREE.MathUtils.clamp(speed / RHYTHM.speed, 0.35, 1.65) * cadence;
  const prev = Number(mesh.userData._walkScale ?? rawScale);
  const speedScale = prev * 0.7 + rawScale * 0.3;
  mesh.userData._walkScale = speedScale;
  action.paused = false;
  action.timeScale = speedScale;
  if (mesh.userData._walkClip !== clipName) {
    const duration = action.getClip().duration;
    const phase = Number(mesh.userData.phase ?? 0) * duration;
    action.time = (loco.walkTime * 0.37 + phase) % duration;
    mesh.userData._walkClip = clipName;
  }
}

function fadeTo(mesh: THREE.Group, clipName: string, loco: BoliLocomotion): void {
  if (mesh.userData.currentClip === clipName) {
    return;
  }
  const actions = mesh.userData.actions as Map<string, THREE.AnimationAction> | undefined;
  if (!actions) {
    return;
  }
  const next = actions.get(clipName);
  if (!next) {
    return;
  }
  const prev = actions.get(mesh.userData.currentClip as string);
  const locomotion = clipName === CLIP_WALK || clipName === CLIP_CROUCH_WALK;
  const fade = clipName === CLIP_DOWNED ? DOWNED_FADE : FADE;
  next.enabled = true;
  next.paused = false;
  next.play();
  if (clipName === CLIP_DOWNED) {
    next.reset();
    next.weight = 1;
  } else if (locomotion) {
    const duration = next.getClip().duration;
    next.time = (loco.walkTime * 0.37 + Number(mesh.userData.phase ?? 0) * duration) % duration;
  } else {
    next.timeScale = Number(mesh.userData.idleScale ?? 1);
  }
  if (prev && prev !== next) {
    prev.crossFadeTo(next, fade, false);
  } else {
    next.weight = 1;
  }
  mesh.userData.currentClip = clipName;
}
