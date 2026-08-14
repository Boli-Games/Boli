import * as THREE from "three";
import { ROUND } from "../sim/types";

const SHADOW_Y = 0.055;
const IDLE_W = 7.6;
const IDLE_D = 5.7;
const CROUCH_MUL = 0.84;
const DOWNED_W = 6.5;
const DOWNED_D = 10.4;
const HUNTER_MUL = 1.08;
const OPACITY_NIGHT = 0.22;
const OPACITY_DAY = 0.32;
const MAX_SHADOWS = ROUND.boliCount + ROUND.maxPlayers + 4;

export type BlobShadowPose = {
  x: number;
  y: number;
  z: number;
  angle: number;
  crouch: boolean;
  downed: boolean;
  hunter: boolean;
  visible: boolean;
};

export type BlobShadowRig = {
  sync: (poses: BlobShadowPose[], dayAmount: number) => void;
};

function makeBlobTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const g = ctx.createRadialGradient(64, 64, 6, 64, 64, 62);
    g.addColorStop(0, "rgba(0,0,0,1)");
    g.addColorStop(0.45, "rgba(0,0,0,0.55)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

export function createBlobShadows(scene: THREE.Scene): BlobShadowRig {
  const geo = new THREE.CircleGeometry(1, 24);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({
    map: makeBlobTexture(),
    color: 0x3a3224,
    transparent: true,
    opacity: OPACITY_DAY,
    depthWrite: false,
    fog: true,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, MAX_SHADOWS);
  mesh.frustumCulled = false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.renderOrder = 1;
  scene.add(mesh);
  const dummy = new THREE.Object3D();

  return {
    sync(poses, dayAmount) {
      mat.opacity = OPACITY_NIGHT + (OPACITY_DAY - OPACITY_NIGHT) * THREE.MathUtils.clamp(dayAmount, 0, 1);
      let count = 0;
      for (const pose of poses) {
        if (!pose.visible || count >= MAX_SHADOWS) {
          continue;
        }
        const hunter = pose.hunter ? HUNTER_MUL : 1;
        let w = IDLE_W * hunter;
        let d = IDLE_D * hunter;
        if (pose.downed) {
          w = DOWNED_W * hunter;
          d = DOWNED_D * hunter;
        } else if (pose.crouch) {
          w *= CROUCH_MUL;
          d *= CROUCH_MUL;
        }
        dummy.position.set(pose.x, pose.z + SHADOW_Y, pose.y);
        dummy.rotation.set(0, pose.downed ? pose.angle : 0, 0);
        dummy.scale.set(w * 0.5, 1, d * 0.5);
        dummy.updateMatrix();
        mesh.setMatrixAt(count, dummy.matrix);
        count += 1;
      }
      mesh.count = count;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.visible = count > 0;
    },
  };
}
