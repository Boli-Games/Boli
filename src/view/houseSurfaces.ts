import * as THREE from "three";

export const WALL_TILE_U = 8;
export const WALL_TILE_V = 4;

let wallMaterial: THREE.MeshLambertMaterial | null = null;

function paintAtlas(): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = "#c4a574";
    ctx.fillRect(0, 0, size, 256);
    ctx.fillStyle = "#c4a05c";
    for (let x = 0; x < size; x += 64) {
      ctx.fillRect(x, 0, 10, 256);
    }
    for (let y = 0; y < 256; y += 64) {
      ctx.fillRect(0, y, size, 8);
    }
    ctx.fillStyle = "#5c4030";
    for (let x = 0; x < size; x += 64) {
      ctx.fillRect(x, 0, 3, 256);
    }
    for (let y = 0; y < 256; y += 64) {
      ctx.fillRect(0, y, size, 3);
    }
    ctx.fillStyle = "#efe0c4";
    for (let x = 8; x < size; x += 64) {
      ctx.fillRect(x, 6, 2, 244);
    }
    ctx.strokeStyle = "#8a6a48";
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(320, 16);
    ctx.lineTo(480, 240);
    ctx.stroke();
    ctx.fillStyle = "#c4a05c";
    ctx.fillRect(0, 256, size, 64);
    ctx.fillStyle = "#5c4030";
    for (let y = 256; y < 320; y += 16) {
      ctx.fillRect(0, y, size, 3);
    }
    ctx.fillStyle = "#d8c49a";
    ctx.fillRect(0, 320, size, 64);
    ctx.fillStyle = "#8a8a82";
    ctx.fillRect(0, 384, size, 64);
    ctx.fillStyle = "#5c4030";
    ctx.fillRect(0, 448, size, 64);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}

export function getCasitaWallMaterial(): THREE.MeshLambertMaterial {
  if (!wallMaterial) {
    wallMaterial = new THREE.MeshLambertMaterial({
      color: 0xffffff,
      map: paintAtlas(),
      fog: true,
    });
  }
  return wallMaterial;
}

export function preloadHouseSurfaces(): Promise<void> {
  getCasitaWallMaterial();
  return Promise.resolve();
}

export function applyWorldBoxUVs(
  mesh: THREE.Mesh,
  tileU = WALL_TILE_U,
  tileV = WALL_TILE_V,
  atlas: "top" | "full" = "top",
): void {
  const geo = mesh.geometry;
  const uv = geo.getAttribute("uv");
  const pos = geo.getAttribute("position");
  const nrm = geo.getAttribute("normal");
  if (!uv || !pos || !nrm) {
    return;
  }
  mesh.updateMatrixWorld(true);
  const v = new THREE.Vector3();
  const n = new THREE.Vector3();
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
  for (let i = 0; i < uv.count; i++) {
    v.fromBufferAttribute(pos, i);
    mesh.localToWorld(v);
    n.fromBufferAttribute(nrm, i);
    n.applyMatrix3(normalMatrix).normalize();
    const ax = Math.abs(n.x);
    const ay = Math.abs(n.y);
    const az = Math.abs(n.z);
    let u = v.x / tileU;
    let vt = v.z / tileV;
    if (ay >= ax && ay >= az) {
      u = v.x / tileU;
      vt = v.z / tileV;
    } else if (ax >= az) {
      u = v.z / tileU;
      vt = v.y / tileV;
    } else {
      u = v.x / tileU;
      vt = v.y / tileV;
    }
    const frac = vt - Math.floor(vt);
    uv.setXY(i, u, atlas === "top" ? 0.5 + frac * 0.5 : frac);
  }
  uv.needsUpdate = true;
}
