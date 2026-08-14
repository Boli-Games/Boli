import * as THREE from "three";
import { RHYTHM } from "../sim/types";

export const CLIP_IDLE = "boli_idle";
export const CLIP_WALK = "boli_walk";
export const CLIP_CROUCH_IDLE = "boli_crouch_idle";
export const CLIP_CROUCH_WALK = "boli_crouch_walk";
export const CLIP_DOWNED = "boli_downed";
export const CLIP_DANCE_1 = "boli_dance_1";
export const CLIP_DANCE_2 = "boli_dance_2";
export const CLIP_DANCE_3 = "boli_dance_3";

const DEG = Math.PI / 180;
const euler = new THREE.Euler(0, 0, 0, "XYZ");
const quat = new THREE.Quaternion();

function pushQuat(values: number[], xDeg: number, yDeg: number, zDeg: number): void {
  euler.set(xDeg * DEG, yDeg * DEG, zDeg * DEG, "XYZ");
  quat.setFromEuler(euler);
  values.push(quat.x, quat.y, quat.z, quat.w);
}

function quatTrack(bone: string, times: number[], poses: Array<[number, number, number]>): THREE.QuaternionKeyframeTrack {
  const values: number[] = [];
  for (const [x, y, z] of poses) {
    pushQuat(values, x, y, z);
  }
  return new THREE.QuaternionKeyframeTrack(`${bone}.quaternion`, times, values);
}

function posTrack(bone: string, times: number[], points: Array<[number, number, number]>): THREE.VectorKeyframeTrack {
  return new THREE.VectorKeyframeTrack(`${bone}.position`, times, points.flat());
}

function sampleTimes(duration: number, steps: number): number[] {
  const times: number[] = [];
  for (let i = 0; i <= steps; i++) {
    times.push((i / steps) * duration);
  }
  return times;
}

export function buildBoliClips(scene: THREE.Object3D): THREE.AnimationClip[] {
  const hips = scene.getObjectByName("Hips");
  const hipBind = hips?.position.clone() ?? new THREE.Vector3(0, 0.816, 0.01);
  return [
    buildIdle(hipBind),
    buildWalk(hipBind),
    buildCrouchIdle(hipBind),
    buildCrouchWalk(hipBind),
    buildDowned(),
    buildDance1(hipBind),
    buildDance2(hipBind),
    buildDance3(hipBind),
  ];
}

function buildIdle(hipBind: THREE.Vector3): THREE.AnimationClip {
  const duration = 3.2;
  const steps = 16;
  const times = sampleTimes(duration, steps);
  const hipsQ: Array<[number, number, number]> = [];
  const hipsP: Array<[number, number, number]> = [];
  const spineQ: Array<[number, number, number]> = [];
  const chestQ: Array<[number, number, number]> = [];
  const neckQ: Array<[number, number, number]> = [];
  const headQ: Array<[number, number, number]> = [];
  const lArm: Array<[number, number, number]> = [];
  const rArm: Array<[number, number, number]> = [];
  const lFore: Array<[number, number, number]> = [];
  const rFore: Array<[number, number, number]> = [];

  for (let i = 0; i <= steps; i++) {
    const u = (i / steps) * Math.PI * 2;
    const breath = Math.sin(u);
    const slow = Math.sin(u * 0.5);
    hipsQ.push([0.8 * breath, 0.6 * slow, 0]);
    hipsP.push([hipBind.x, hipBind.y + 0.005 * breath, hipBind.z]);
    spineQ.push([1.6 * breath, 0.7 * slow, 0]);
    chestQ.push([1.2 * breath, 0.4 * -slow, 0]);
    neckQ.push([0.5 * breath, 0.9 * slow, 0]);
    headQ.push([0.6 * breath, 1.8 * slow, 0]);
    lArm.push([0, 1.4 * slow, 40 + 2.2 * breath]);
    rArm.push([0, 1.2 * -slow, -40 - 2.0 * breath]);
    lFore.push([0, 0, 16 + 1.4 * breath]);
    rFore.push([0, 0, -16 - 1.4 * breath]);
  }

  return new THREE.AnimationClip(CLIP_IDLE, duration, [
    quatTrack("Hips", times, hipsQ),
    posTrack("Hips", times, hipsP),
    quatTrack("Spine", times, spineQ),
    quatTrack("Chest", times, chestQ),
    quatTrack("Neck", times, neckQ),
    quatTrack("Head", times, headQ),
    quatTrack("LeftUpperArm", times, lArm),
    quatTrack("RightUpperArm", times, rArm),
    quatTrack("LeftLowerArm", times, lFore),
    quatTrack("RightLowerArm", times, rFore),
  ]);
}

function buildWalk(hipBind: THREE.Vector3): THREE.AnimationClip {
  const duration = RHYTHM.walkBouncePeriod * 2;
  const steps = 16;
  const times = sampleTimes(duration, steps);
  const hipsQ: Array<[number, number, number]> = [];
  const hipsP: Array<[number, number, number]> = [];
  const spineQ: Array<[number, number, number]> = [];
  const chestQ: Array<[number, number, number]> = [];
  const neckQ: Array<[number, number, number]> = [];
  const headQ: Array<[number, number, number]> = [];
  const lShoulder: Array<[number, number, number]> = [];
  const rShoulder: Array<[number, number, number]> = [];
  const lUpLeg: Array<[number, number, number]> = [];
  const rUpLeg: Array<[number, number, number]> = [];
  const lLowLeg: Array<[number, number, number]> = [];
  const rLowLeg: Array<[number, number, number]> = [];
  const lFoot: Array<[number, number, number]> = [];
  const rFoot: Array<[number, number, number]> = [];
  const lArm: Array<[number, number, number]> = [];
  const rArm: Array<[number, number, number]> = [];
  const lFore: Array<[number, number, number]> = [];
  const rFore: Array<[number, number, number]> = [];
  const lHand: Array<[number, number, number]> = [];
  const rHand: Array<[number, number, number]> = [];

  for (let i = 0; i <= steps; i++) {
    const u = (i / steps) * Math.PI * 2;
    const c = Math.cos(u);
    const s = Math.sin(u);
    const liftL = Math.max(0, s);
    const liftR = Math.max(0, -s);
    hipsQ.push([2.4 * Math.abs(s), 6.5 * s, 0]);
    hipsP.push([hipBind.x, hipBind.y + 0.016 * Math.abs(c), hipBind.z]);
    spineQ.push([3.2 * Math.abs(s), -4.2 * s, 0]);
    chestQ.push([1.8 * Math.abs(s), -2.6 * s, 0]);
    neckQ.push([1.0 * c, 2.0 * s, 0]);
    headQ.push([1.4 * c, 2.8 * -s, 0]);
    lShoulder.push([0, -10 * c, 5]);
    rShoulder.push([0, -10 * c, -5]);
    lUpLeg.push([-38 * c, 0, 2 * s]);
    rUpLeg.push([38 * c, 0, -2 * s]);
    lLowLeg.push([18 + 42 * liftL, 0, 0]);
    rLowLeg.push([18 + 42 * liftR, 0, 0]);
    lFoot.push([-10 * c + 8 * liftL, 0, 0]);
    rFoot.push([10 * c + 8 * liftR, 0, 0]);
    lArm.push([0, -52 * c, 34]);
    rArm.push([0, -52 * c, -34]);
    lFore.push([0, -18 * c, 22 + 10 * Math.max(0, -c)]);
    rFore.push([0, -18 * c, -22 - 10 * Math.max(0, c)]);
    lHand.push([0, -10 * c, 4 * Math.max(0, -c)]);
    rHand.push([0, -10 * c, -4 * Math.max(0, c)]);
  }

  return new THREE.AnimationClip(CLIP_WALK, duration, [
    quatTrack("Hips", times, hipsQ),
    posTrack("Hips", times, hipsP),
    quatTrack("Spine", times, spineQ),
    quatTrack("Chest", times, chestQ),
    quatTrack("Neck", times, neckQ),
    quatTrack("Head", times, headQ),
    quatTrack("LeftShoulder", times, lShoulder),
    quatTrack("RightShoulder", times, rShoulder),
    quatTrack("LeftUpperLeg", times, lUpLeg),
    quatTrack("RightUpperLeg", times, rUpLeg),
    quatTrack("LeftLowerLeg", times, lLowLeg),
    quatTrack("RightLowerLeg", times, rLowLeg),
    quatTrack("LeftFoot", times, lFoot),
    quatTrack("RightFoot", times, rFoot),
    quatTrack("LeftUpperArm", times, lArm),
    quatTrack("RightUpperArm", times, rArm),
    quatTrack("LeftLowerArm", times, lFore),
    quatTrack("RightLowerArm", times, rFore),
    quatTrack("LeftHand", times, lHand),
    quatTrack("RightHand", times, rHand),
  ]);
}

function crouchBase(u: number): {
  hipsQ: [number, number, number];
  spine: [number, number, number];
  chest: [number, number, number];
  lUp: number;
  rUp: number;
  lLow: number;
  rLow: number;
} {
  const breath = Math.sin(u);
  return {
    hipsQ: [16 + 1.0 * breath, 0, 0],
    spine: [12 + 1.1 * breath, 0, 0],
    chest: [8 + 0.8 * breath, 0, 0],
    lUp: -58,
    rUp: -58,
    lLow: 88,
    rLow: 88,
  };
}

function buildCrouchIdle(hipBind: THREE.Vector3): THREE.AnimationClip {
  const duration = 2.8;
  const steps = 12;
  const times = sampleTimes(duration, steps);
  const hipsQ: Array<[number, number, number]> = [];
  const hipsP: Array<[number, number, number]> = [];
  const spineQ: Array<[number, number, number]> = [];
  const chestQ: Array<[number, number, number]> = [];
  const lUp: Array<[number, number, number]> = [];
  const rUp: Array<[number, number, number]> = [];
  const lLow: Array<[number, number, number]> = [];
  const rLow: Array<[number, number, number]> = [];
  const lFoot: Array<[number, number, number]> = [];
  const rFoot: Array<[number, number, number]> = [];
  const lArm: Array<[number, number, number]> = [];
  const rArm: Array<[number, number, number]> = [];

  for (let i = 0; i <= steps; i++) {
    const u = (i / steps) * Math.PI * 2;
    const base = crouchBase(u);
    hipsQ.push(base.hipsQ);
    hipsP.push([hipBind.x, hipBind.y * 0.58 + 0.004 * Math.sin(u), hipBind.z + 0.04]);
    spineQ.push(base.spine);
    chestQ.push(base.chest);
    lUp.push([base.lUp + 1.2 * Math.sin(u), 0, 0]);
    rUp.push([base.rUp + 1.0 * Math.sin(u + 0.4), 0, 0]);
    lLow.push([base.lLow, 0, 0]);
    rLow.push([base.rLow, 0, 0]);
    lFoot.push([-24, 0, 0]);
    rFoot.push([-24, 0, 0]);
    lArm.push([0, 4 + 1.5 * Math.sin(u), 36]);
    rArm.push([0, -6 + 1.2 * Math.sin(u + 0.5), -40]);
  }

  return new THREE.AnimationClip(CLIP_CROUCH_IDLE, duration, [
    quatTrack("Hips", times, hipsQ),
    posTrack("Hips", times, hipsP),
    quatTrack("Spine", times, spineQ),
    quatTrack("Chest", times, chestQ),
    quatTrack("LeftUpperLeg", times, lUp),
    quatTrack("RightUpperLeg", times, rUp),
    quatTrack("LeftLowerLeg", times, lLow),
    quatTrack("RightLowerLeg", times, rLow),
    quatTrack("LeftFoot", times, lFoot),
    quatTrack("RightFoot", times, rFoot),
    quatTrack("LeftUpperArm", times, lArm),
    quatTrack("RightUpperArm", times, rArm),
  ]);
}

function buildCrouchWalk(hipBind: THREE.Vector3): THREE.AnimationClip {
  const duration = RHYTHM.walkBouncePeriod * 2.2;
  const steps = 16;
  const times = sampleTimes(duration, steps);
  const hipsQ: Array<[number, number, number]> = [];
  const hipsP: Array<[number, number, number]> = [];
  const spineQ: Array<[number, number, number]> = [];
  const chestQ: Array<[number, number, number]> = [];
  const lUp: Array<[number, number, number]> = [];
  const rUp: Array<[number, number, number]> = [];
  const lLow: Array<[number, number, number]> = [];
  const rLow: Array<[number, number, number]> = [];
  const lFoot: Array<[number, number, number]> = [];
  const rFoot: Array<[number, number, number]> = [];
  const lArm: Array<[number, number, number]> = [];
  const rArm: Array<[number, number, number]> = [];

  for (let i = 0; i <= steps; i++) {
    const u = (i / steps) * Math.PI * 2;
    const c = Math.cos(u);
    const s = Math.sin(u);
    const base = crouchBase(u);
    hipsQ.push([base.hipsQ[0], 4.2 * s, 0]);
    hipsP.push([hipBind.x, hipBind.y * 0.58 + 0.008 * Math.abs(c), hipBind.z + 0.04]);
    spineQ.push([base.spine[0], -2.6 * s, 0]);
    chestQ.push([base.chest[0], -1.8 * s, 0]);
    lUp.push([base.lUp - 16 * c, 0, 0]);
    rUp.push([base.rUp + 16 * c, 0, 0]);
    lLow.push([base.lLow + 10 * Math.max(0, s), 0, 0]);
    rLow.push([base.rLow + 10 * Math.max(0, -s), 0, 0]);
    lFoot.push([-24 + 6 * c, 0, 0]);
    rFoot.push([-24 - 6 * c, 0, 0]);
    lArm.push([0, -12 * c, 34]);
    rArm.push([0, -12 * c, -38]);
  }

  return new THREE.AnimationClip(CLIP_CROUCH_WALK, duration, [
    quatTrack("Hips", times, hipsQ),
    posTrack("Hips", times, hipsP),
    quatTrack("Spine", times, spineQ),
    quatTrack("Chest", times, chestQ),
    quatTrack("LeftUpperLeg", times, lUp),
    quatTrack("RightUpperLeg", times, rUp),
    quatTrack("LeftLowerLeg", times, lLow),
    quatTrack("RightLowerLeg", times, rLow),
    quatTrack("LeftFoot", times, lFoot),
    quatTrack("RightFoot", times, rFoot),
    quatTrack("LeftUpperArm", times, lArm),
    quatTrack("RightUpperArm", times, rArm),
  ]);
}

function buildDowned(): THREE.AnimationClip {
  const times = [0, 0.18, 0.42];
  return new THREE.AnimationClip(CLIP_DOWNED, 0.42, [
    quatTrack("Root", times, [
      [0, 0, 0],
      [48, 0, 0],
      [90, 0, 0],
    ]),
    quatTrack("Hips", times, [
      [0, 0, 0],
      [8, 0, 0],
      [12, 0, 0],
    ]),
    quatTrack("LeftUpperArm", times, [
      [0, 0, -8],
      [0, 12, -22],
      [0, 18, -28],
    ]),
    quatTrack("RightUpperArm", times, [
      [0, 0, 8],
      [0, -10, 18],
      [0, -14, 24],
    ]),
    quatTrack("LeftUpperLeg", times, [
      [0, 0, 0],
      [-16, 0, 0],
      [-22, 8, 0],
    ]),
    quatTrack("RightUpperLeg", times, [
      [0, 0, 0],
      [10, 0, 0],
      [14, -6, 0],
    ]),
    quatTrack("LeftLowerLeg", times, [
      [0, 0, 0],
      [18, 0, 0],
      [28, 0, 0],
    ]),
    quatTrack("RightLowerLeg", times, [
      [0, 0, 0],
      [12, 0, 0],
      [20, 0, 0],
    ]),
  ]);
}

function buildDance1(hipBind: THREE.Vector3): THREE.AnimationClip {
  const duration = 1.35;
  const steps = 16;
  const times = sampleTimes(duration, steps);
  const hipsQ: Array<[number, number, number]> = [];
  const hipsP: Array<[number, number, number]> = [];
  const spineQ: Array<[number, number, number]> = [];
  const chestQ: Array<[number, number, number]> = [];
  const headQ: Array<[number, number, number]> = [];
  const lArm: Array<[number, number, number]> = [];
  const rArm: Array<[number, number, number]> = [];
  const lFore: Array<[number, number, number]> = [];
  const rFore: Array<[number, number, number]> = [];
  const lUp: Array<[number, number, number]> = [];
  const rUp: Array<[number, number, number]> = [];
  for (let i = 0; i <= steps; i++) {
    const u = (i / steps) * Math.PI * 2;
    const s = Math.sin(u);
    const c = Math.cos(u);
    hipsQ.push([4 * Math.abs(s), 22 * s, 8 * c]);
    hipsP.push([hipBind.x + 0.04 * s, hipBind.y + 0.05 * Math.abs(c), hipBind.z]);
    spineQ.push([8 * s, 10 * c, 0]);
    chestQ.push([6 * -s, 14 * s, 0]);
    headQ.push([8 * c, 16 * s, 0]);
    lArm.push([-20 + 12 * c, 18 * s, 78 + 22 * s]);
    rArm.push([-18 - 12 * c, 18 * -s, -78 - 22 * s]);
    lFore.push([0, 0, 28 + 18 * Math.abs(s)]);
    rFore.push([0, 0, -28 - 18 * Math.abs(s)]);
    lUp.push([8 * Math.max(0, s), 6 * s, 0]);
    rUp.push([8 * Math.max(0, -s), 6 * -s, 0]);
  }
  return new THREE.AnimationClip(CLIP_DANCE_1, duration, [
    quatTrack("Hips", times, hipsQ),
    posTrack("Hips", times, hipsP),
    quatTrack("Spine", times, spineQ),
    quatTrack("Chest", times, chestQ),
    quatTrack("Head", times, headQ),
    quatTrack("LeftUpperArm", times, lArm),
    quatTrack("RightUpperArm", times, rArm),
    quatTrack("LeftLowerArm", times, lFore),
    quatTrack("RightLowerArm", times, rFore),
    quatTrack("LeftUpperLeg", times, lUp),
    quatTrack("RightUpperLeg", times, rUp),
  ]);
}

function buildDance2(hipBind: THREE.Vector3): THREE.AnimationClip {
  const duration = 1.1;
  const steps = 16;
  const times = sampleTimes(duration, steps);
  const hipsQ: Array<[number, number, number]> = [];
  const hipsP: Array<[number, number, number]> = [];
  const spineQ: Array<[number, number, number]> = [];
  const chestQ: Array<[number, number, number]> = [];
  const lArm: Array<[number, number, number]> = [];
  const rArm: Array<[number, number, number]> = [];
  const lUp: Array<[number, number, number]> = [];
  const rUp: Array<[number, number, number]> = [];
  const lLow: Array<[number, number, number]> = [];
  const rLow: Array<[number, number, number]> = [];
  for (let i = 0; i <= steps; i++) {
    const u = (i / steps) * Math.PI * 2;
    const s = Math.sin(u);
    const c = Math.cos(u);
    const bounce = Math.abs(Math.sin(u * 2));
    hipsQ.push([10 * bounce, 8 * s, 0]);
    hipsP.push([hipBind.x, hipBind.y + 0.11 * bounce, hipBind.z]);
    spineQ.push([14 * bounce, -6 * s, 0]);
    chestQ.push([10 * bounce, 8 * c, 0]);
    lArm.push([-70 + 20 * bounce, 12 * s, 20]);
    rArm.push([-70 + 20 * bounce, -12 * s, -20]);
    lUp.push([-18 * Math.max(0, s), 0, 0]);
    rUp.push([-18 * Math.max(0, -s), 0, 0]);
    lLow.push([28 * Math.max(0, s), 0, 0]);
    rLow.push([28 * Math.max(0, -s), 0, 0]);
  }
  return new THREE.AnimationClip(CLIP_DANCE_2, duration, [
    quatTrack("Hips", times, hipsQ),
    posTrack("Hips", times, hipsP),
    quatTrack("Spine", times, spineQ),
    quatTrack("Chest", times, chestQ),
    quatTrack("LeftUpperArm", times, lArm),
    quatTrack("RightUpperArm", times, rArm),
    quatTrack("LeftUpperLeg", times, lUp),
    quatTrack("RightUpperLeg", times, rUp),
    quatTrack("LeftLowerLeg", times, lLow),
    quatTrack("RightLowerLeg", times, rLow),
  ]);
}

function buildDance3(hipBind: THREE.Vector3): THREE.AnimationClip {
  const duration = 1.55;
  const steps = 16;
  const times = sampleTimes(duration, steps);
  const hipsQ: Array<[number, number, number]> = [];
  const hipsP: Array<[number, number, number]> = [];
  const spineQ: Array<[number, number, number]> = [];
  const chestQ: Array<[number, number, number]> = [];
  const headQ: Array<[number, number, number]> = [];
  const lArm: Array<[number, number, number]> = [];
  const rArm: Array<[number, number, number]> = [];
  const lUp: Array<[number, number, number]> = [];
  const rUp: Array<[number, number, number]> = [];
  const lLow: Array<[number, number, number]> = [];
  const rLow: Array<[number, number, number]> = [];
  for (let i = 0; i <= steps; i++) {
    const u = (i / steps) * Math.PI * 2;
    const s = Math.sin(u);
    const c = Math.cos(u);
    hipsQ.push([6 * c, 28 * s, 12 * c]);
    hipsP.push([hipBind.x + 0.03 * c, hipBind.y + 0.04 * Math.abs(s), hipBind.z]);
    spineQ.push([10 * s, 18 * s, 8 * c]);
    chestQ.push([8 * -s, 16 * c, 0]);
    headQ.push([12 * s, 20 * -s, 6 * c]);
    lArm.push([-8, 40 * s, 86 + 10 * c]);
    rArm.push([-40 + 30 * Math.max(0, -s), -24 * s, -70]);
    lUp.push([6 * c, 10 * s, 0]);
    rUp.push([-36 * Math.max(0, s), -8 * s, 0]);
    lLow.push([8 * Math.abs(c), 0, 0]);
    rLow.push([42 * Math.max(0, s), 0, 0]);
  }
  return new THREE.AnimationClip(CLIP_DANCE_3, duration, [
    quatTrack("Hips", times, hipsQ),
    posTrack("Hips", times, hipsP),
    quatTrack("Spine", times, spineQ),
    quatTrack("Chest", times, chestQ),
    quatTrack("Head", times, headQ),
    quatTrack("LeftUpperArm", times, lArm),
    quatTrack("RightUpperArm", times, rArm),
    quatTrack("LeftUpperLeg", times, lUp),
    quatTrack("RightUpperLeg", times, rUp),
    quatTrack("LeftLowerLeg", times, lLow),
    quatTrack("RightLowerLeg", times, rLow),
  ]);
}
