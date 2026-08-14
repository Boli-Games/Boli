import * as THREE from "three";
import {
  RHYTHM,
  ROUND,
  VIEW,
  type ControlRole,
  type Entity,
  type GameState,
  type House,
  type Hunter,
  type Objective,
  type Poi,
  type Ramp,
} from "./sim/types";
import { missionSummary } from "./sim/game";
import { skinById } from "./profile";
import { createForest } from "./view/forest";
import { addBoundaryFence } from "./view/fence";
import { addGroundSurfaces, tickGrassLod } from "./view/ground";
import { createHorizonBackdrop } from "./view/horizon";
import { createSky, skyAmount } from "./view/sky";
import { createTorches } from "./view/torches";
import { createBlobShadows, type BlobShadowPose } from "./view/blobShadow";
import { applyWorldBoxUVs, getCasitaWallMaterial, preloadHouseSurfaces } from "./view/houseSurfaces";
import { tickPerfOverlay } from "./debug/perfOverlay";
import type { CameraMode } from "./profile";
import { getQuality } from "./quality";
import { usesTouchInput, viewportSize } from "./platform";
import {
  boliTemplateReady,
  createBoliCharacter,
  isRiggedBoli,
  preloadBoliCharacters,
  syncBoliAnimation,
  tickBoliAnimation,
  boliSkinName,
  disposeBoliCharacter,
} from "./view/boliCharacter";

const BOLI_COLOR = 0xe4d2b2;
const BOLI_SHADE = 0xc9b48a;
const HUNTER_COLOR = 0x3c342c;
const HUNTER_SHADE = 0x5a4c40;
const wayNdc = new THREE.Vector3();

const HEART_SLOTS = 5;
const AMMO_SLOTS = 6;

type Hud = {
  time: HTMLElement;
  round: HTMLElement;
  mode: HTMLElement;
  hint: HTMLElement;
  mission: HTMLElement;
  hpWrap: HTMLElement;
  hpHearts: HTMLElement[];
  ammoWrap: HTMLElement;
  ammoShots: HTMLElement[];
  ammoCount: HTMLElement;
  banner: HTMLElement;
  bannerText: HTMLElement;
  crosshair: HTMLElement;
  lock: HTMLElement;
  lockTitle: HTMLElement;
  lockBody: HTMLElement;
  end: HTMLElement;
  endTitle: HTMLElement;
  hurt: HTMLElement;
  way: HTMLElement;
  wayNeedle: HTMLElement;
  wayMeta: HTMLElement;
};

type HudCache = {
  time: string;
  round: string;
  hearts: number;
  critical: boolean;
  ammoShown: boolean;
  shots: number;
  ammo: number;
  mode: string;
  modeOn: boolean;
  modeShown: boolean;
  mission: string;
  missionShown: boolean;
  banner: string;
  hint: string;
  lockTitle: string;
  playing: boolean;
  endTitle: string;
};

const hudCache: HudCache = {
  time: "",
  round: "",
  hearts: -1,
  critical: false,
  ammoShown: false,
  shots: -1,
  ammo: -1,
  mode: "",
  modeOn: false,
  modeShown: false,
  mission: "",
  missionShown: false,
  banner: "",
  hint: "",
  lockTitle: "",
  playing: true,
  endTitle: "",
};

let bannerHideAt = 0;

export type ViewOpts = {
  role: ControlRole;
  yaw: number;
  pitch: number;
  boliMode: boolean;
  crouch: boolean;
  pointerLocked: boolean;
  localId?: string;
  hunterIndex?: number;
  online?: boolean;
  hunterSkinId?: string;
  paused?: boolean;
  cameraMode?: CameraMode;
  touchUi?: boolean;
  roundNumber?: number;
  totalRounds?: number;
  overlay?: boolean;
};

export type GameView = {
  resize: () => void;
  rebuild: (state: GameState) => void;
  render: (state: GameState, opts: ViewOpts) => void;
  pickAimedEntity: (state: GameState, hunter: Hunter, yaw: number, pitch: number) => Entity | null;
  playShot: (opts: { firstPerson: boolean; hitX: number; hitY: number; hitZ: number; hit: boolean }) => void;
};

export function createView(canvas: HTMLCanvasElement): GameView {
  const quality = getQuality();
  const renderer = new THREE.WebGLRenderer(
    quality.tier === "desktop"
      ? { canvas, antialias: true }
      : { canvas, antialias: false, powerPreference: "low-power", stencil: false },
  );
  renderer.setPixelRatio(quality.pixelRatio);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = quality.shadows;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();

  const fpsCamera = new THREE.PerspectiveCamera(70, 1, 0.2, 1600);
  fpsCamera.rotation.order = "YXZ";
  fpsCamera.position.set(410, VIEW.eyeHeight, 320);
  scene.add(fpsCamera);
  let eyeBlend = VIEW.eyeHeight;

  const worldRoot = new THREE.Group();
  const characterRoot = new THREE.Group();
  scene.add(worldRoot);
  scene.add(characterRoot);

  const boliMeshes = new Map<string, THREE.Group>();
  const crateMeshes = new Map<string, THREE.Group>();
  let hunterMesh: THREE.Group | null = null;
  const extraMeshes: THREE.Group[] = [];
  const viewmodel = makeShotgun(0.036);
  viewmodel.position.set(0.24, -0.3, -0.46);
  viewmodel.rotation.set(0.12, 0, 0.04);
  fpsCamera.add(viewmodel);
  const shotFx = createShotFx(scene, fpsCamera, viewmodel);

  const camRay = new THREE.Raycaster();
  const camFrom = new THREE.Vector3();
  const camTo = new THREE.Vector3();
  const camDir = new THREE.Vector3();
  const hunterAim = new THREE.Vector3();
  const raycaster = new THREE.Raycaster();
  const centerNdc = new THREE.Vector2(0, 0);

  const sky = createSky(scene, fpsCamera);
  const forest = createForest(scene);
  const torches = createTorches(scene);
  const horizon = createHorizonBackdrop(scene);
  const blobs = createBlobShadows(scene);
  const hud = bindHud();
  const beacon = makeBeacon();
  beacon.visible = false;
  scene.add(beacon);
  let builtWorldKey = "";
  let trackedHp = -1;
  let hurtUntil = 0;
  let lastState: GameState | null = null;
  let lastAnimAt = performance.now();

  void preloadHouseSurfaces().catch(() => undefined);
  void preloadBoliCharacters()
    .then(() => {
      if (lastState) {
        rebuild(lastState);
      }
    })
    .catch((err) => {
      console.warn("No se pudo cargar el Boli riggeado; se usa el procedural:", err);
    });

  function ensureWorld(state: GameState): void {
    const key = `${state.world.width}x${state.world.height}`;
    if (key === builtWorldKey) {
      return;
    }
    builtWorldKey = key;
    while (worldRoot.children.length > 0) {
      worldRoot.remove(worldRoot.children[0]);
    }
    crateMeshes.clear();
    buildWorld(worldRoot, state);
    forest.layout(state.world.width, state.world.height);
    torches.layout(state.world);
    try {
      horizon.layout(state.world.width, state.world.height);
    } catch (err) {
      console.warn("No se pudo crear el fondo del horizonte:", err);
    }
  }

  function spawnPerson(color: number, hunter: boolean, seed?: string, skinId: number | string = 0): THREE.Group {
    if (boliTemplateReady()) {
      return createBoliCharacter({
        color,
        hunter,
        skinId,
        seed,
        weapon: hunter ? makeShotgun(1) : undefined,
      });
    }
    return makePerson(color, hunter ? HUNTER_SHADE : BOLI_SHADE, hunter);
  }

  function rebuild(state: GameState): void {
    lastState = state;
    ensureWorld(state);
    while (characterRoot.children.length > 0) {
      const child = characterRoot.children[0];
      disposePerson(child);
      characterRoot.remove(child);
    }
    boliMeshes.clear();
    extraMeshes.length = 0;
    hunterMesh = null;
    for (const entity of state.entities) {
      const mesh = spawnPerson(BOLI_COLOR, false, entity.id, entity.skinId ?? 0);
      mesh.userData.entityId = entity.id;
      boliMeshes.set(entity.id, mesh);
      characterRoot.add(mesh);
    }
    hunterMesh = spawnPerson(HUNTER_COLOR, true, "hunter");
    characterRoot.add(hunterMesh);
    state.extraHunters.forEach((_extra, index) => {
      const mesh = spawnPerson(HUNTER_COLOR, true, `hunter-extra-${index}`);
      extraMeshes.push(mesh);
      characterRoot.add(mesh);
    });
    trackedHp = -1;
    hurtUntil = 0;
    resetHudCache();
  }

  function resize(): void {
    const { w, h } = viewportSize();
    const scale = getQuality().resolutionScale;
    renderer.setSize(Math.max(1, Math.round(w * scale)), Math.max(1, Math.round(h * scale)), false);
    fpsCamera.aspect = w / Math.max(1, h);
    fpsCamera.updateProjectionMatrix();
  }

  function placeCamera(
    x: number,
    z: number,
    groundZ: number,
    yaw: number,
    pitch: number,
    walkTime: number,
    walking: boolean,
    crouch = false,
    thirdPerson = false,
  ): void {
    const eyeTarget = crouch ? VIEW.crouchEyeHeight : VIEW.eyeHeight;
    eyeBlend += (eyeTarget - eyeBlend) * 0.28;
    const bob = walking && !crouch
      ? Math.abs(Math.sin((walkTime / RHYTHM.walkBouncePeriod) * Math.PI * 2)) * RHYTHM.walkBounceAmp * 0.45
      : 0;
    fpsCamera.rotation.y = Math.atan2(-Math.cos(yaw), -Math.sin(yaw));
    fpsCamera.rotation.x = pitch;
    fpsCamera.rotation.z = 0;
    if (!thirdPerson) {
      fpsCamera.position.set(x, groundZ + eyeBlend + bob, z);
      return;
    }
    const lookX = Math.cos(yaw);
    const lookZ = Math.sin(yaw);
    const rightX = -lookZ;
    const rightZ = lookX;
    const dist = VIEW.tpDistance;
    const height = crouch ? VIEW.tpHeight * 0.72 : VIEW.tpHeight;
    camFrom.set(x, groundZ + eyeBlend + bob, z);
    camTo.set(
      x - lookX * dist * Math.cos(pitch) + rightX * VIEW.tpShoulder,
      groundZ + height - Math.sin(pitch) * dist,
      z - lookZ * dist * Math.cos(pitch) + rightZ * VIEW.tpShoulder,
    );
    camDir.copy(camTo).sub(camFrom);
    const span = camDir.length();
    if (span > 0.001) {
      camDir.multiplyScalar(1 / span);
      camRay.set(camFrom, camDir);
      camRay.far = span;
      const hits = camRay.intersectObject(worldRoot, true);
      const hit = hits.find((item) => {
        const name = item.object.name || item.object.parent?.name || "";
        return !name.startsWith("grass-") && name !== "ground-grass";
      });
      const pulled = hit ? Math.max(VIEW.tpMinDist, hit.distance - 1.6) : span;
      fpsCamera.position.copy(camFrom).addScaledVector(camDir, pulled);
    } else {
      fpsCamera.position.copy(camTo);
    }
  }

  function render(state: GameState, opts: ViewOpts): void {
    ensureWorld(state);
    syncCrates(worldRoot, crateMeshes, state);
    if (
      boliMeshes.size !== state.entities.length ||
      extraMeshes.length !== state.extraHunters.length ||
      state.entities.some((entity) => {
        const mesh = boliMeshes.get(entity.id);
        return !mesh || mesh.userData.skinId !== boliSkinName(entity.skinId);
      })
    ) {
      rebuild(state);
    }

    const localId = opts.localId ?? "local";
    const localEntity = state.entities.find((entity) => entity.controllerId === localId);
    const hunterIndex = opts.hunterIndex ?? 0;
    const activeHunter =
      hunterIndex <= 0 ? state.hunter : (state.extraHunters[hunterIndex - 1] ?? state.hunter);
    const third = opts.cameraMode !== "firstPerson";

    const blobPoses: BlobShadowPose[] = [];
    for (const entity of state.entities) {
      const mesh = boliMeshes.get(entity.id);
      if (!mesh) {
        continue;
      }
      syncPerson(mesh, entity, state.revealTtl > 0 && entity.controllerId === localId, state.clock, Boolean(entity.crouch));
      mesh.visible = !(opts.role === "INFILTRATOR" && entity.controllerId === localId && !third);
      blobPoses.push({
        x: entity.x,
        y: entity.y,
        z: entity.z,
        angle: entity.angle,
        crouch: Boolean(entity.crouch),
        downed: entity.downed,
        hunter: false,
        visible: mesh.visible,
      });
    }
    if (hunterMesh) {
      syncHunter(hunterMesh, state.hunter, Boolean(state.hunter.crouch));
      hunterMesh.visible = !(opts.role === "HUNTER" && hunterIndex === 0 && !third);
      blobPoses.push({
        x: state.hunter.x,
        y: state.hunter.y,
        z: state.hunter.z,
        angle: state.hunter.angle,
        crouch: Boolean(state.hunter.crouch),
        downed: false,
        hunter: true,
        visible: hunterMesh.visible,
      });
    }
    state.extraHunters.forEach((hunter, index) => {
      const mesh = extraMeshes[index];
      if (mesh) {
        syncHunter(mesh, hunter, Boolean(hunter.crouch));
        mesh.visible = !(opts.role === "HUNTER" && hunterIndex === index + 1 && !third);
        blobPoses.push({
          x: hunter.x,
          y: hunter.y,
          z: hunter.z,
          angle: hunter.angle,
          crouch: Boolean(hunter.crouch),
          downed: false,
          hunter: true,
          visible: mesh.visible,
        });
      }
    });

    const skin = skinById(opts.hunterSkinId ?? "oak");
    if (hunterMesh) {
      tintPerson(hunterMesh, skin.color, skin.shade);
    }
    for (const mesh of extraMeshes) {
      tintPerson(mesh, skin.color, skin.shade);
    }

    if (opts.role === "HUNTER") {
      const walking = activeHunter.state === "WANDER";
      placeCamera(
        activeHunter.x,
        activeHunter.y,
        activeHunter.z,
        opts.yaw,
        opts.pitch + state.shotKick * 0.18,
        activeHunter.walkTime,
        walking,
        opts.crouch || activeHunter.crouch,
        third,
      );
      viewmodel.visible = !third;
      viewmodel.rotation.x = 0.12 + state.shotKick * 0.12;
      viewmodel.position.set(0.24, -0.3 - state.shotKick * 0.04, -0.46);
    } else if (localEntity) {
      const walking = localEntity.state === "WANDER";
      placeCamera(
        localEntity.x,
        localEntity.y,
        localEntity.z,
        opts.yaw,
        opts.pitch,
        localEntity.walkTime,
        walking,
        opts.crouch || localEntity.crouch,
        third,
      );
      viewmodel.visible = false;
    } else {
      placeCamera(state.world.width * 0.5, state.world.height * 0.5, 0, opts.yaw, opts.pitch, 0, false, false, third);
      viewmodel.visible = false;
    }

    const localHp =
      opts.role === "HUNTER" ? activeHunter.hp : (localEntity && !localEntity.downed ? localEntity.hp : 0);
    if (trackedHp >= 0 && localHp < trackedHp) {
      hurtUntil = state.clock + 0.45;
    }
    trackedHp = localHp;
    hud.hurt.style.opacity = String(Math.max(0, (hurtUntil - state.clock) / 0.45));

    forest.tick(Boolean(opts.paused));
    sky.update(state.timeLeft, state.worldMinute);
    try {
      horizon.sync(sky.atmosphere.fog, sky.atmosphere.horizon);
    } catch (err) {
      console.warn("No se pudo sincronizar el fondo del horizonte:", err);
    }
    updateBeacon(beacon, state, opts);
    updateWaypoint(fpsCamera, hud, state, opts);
    updateHud(hud, state, opts, activeHunter, localEntity);
    shotFx.consume(state);
    shotFx.tick();
    const now = performance.now();
    const animDt = opts.paused ? 0 : Math.min(0.05, (now - lastAnimAt) / 1000);
    lastAnimAt = now;
    torches.tick(fpsCamera.position, state.worldMinute, animDt, Boolean(opts.paused));
    for (const mesh of boliMeshes.values()) {
      tickBoliAnimation(mesh, animDt);
    }
    if (hunterMesh) {
      tickBoliAnimation(hunterMesh, animDt);
    }
    for (const mesh of extraMeshes) {
      tickBoliAnimation(mesh, animDt);
    }
    blobs.sync(blobPoses, skyAmount(state.timeLeft));
    tickGrassLod(fpsCamera.position.x, fpsCamera.position.z);
    renderer.render(scene, fpsCamera);
    tickPerfOverlay(renderer);
  }

  function pickAimedEntity(state: GameState, hunter: Hunter, _yaw: number, _pitch: number): Entity | null {
    const targets: THREE.Object3D[] = [];
    for (const entity of state.entities) {
      const mesh = boliMeshes.get(entity.id);
      if (!mesh || entity.downed) {
        continue;
      }
      syncPerson(mesh, entity, false, 0, Boolean(entity.crouch));
      mesh.updateMatrixWorld(true);
      targets.push(mesh);
    }
    fpsCamera.updateMatrixWorld();
    hunterAim.set(hunter.x, hunter.z + (hunter.crouch ? VIEW.crouchEyeHeight : VIEW.eyeHeight), hunter.y);
    raycaster.setFromCamera(centerNdc, fpsCamera);
    raycaster.far = hunterAim.distanceTo(fpsCamera.position) + ROUND.shotRange;
    const hits = raycaster.intersectObjects(targets, true);
    const first = hits[0];
    if (!first) {
      return null;
    }
    let node: THREE.Object3D | null = first.object;
    while (node && node.userData.entityId === undefined) {
      node = node.parent;
    }
    const id = node?.userData.entityId as string | undefined;
    if (!id) {
      return null;
    }
    const entity = state.entities.find((item) => item.id === id) ?? null;
    if (!entity) {
      return null;
    }
    const reach = Math.hypot(entity.x - hunter.x, entity.y - hunter.y, entity.z + 8 - hunterAim.y);
    return reach <= ROUND.shotRange ? entity : null;
  }

  resize();
  return { resize, rebuild, render, pickAimedEntity, playShot: shotFx.play };
}

function buildWorld(root: THREE.Group, state: GameState): void {
  const { pois, cover, houses, ramps } = state.world;
  addGroundSurfaces(root, state.world);
  addBoundaryFence(root, state.world);

  const coverMat = new THREE.MeshLambertMaterial({ color: 0x4a4338 });
  for (const rect of cover) {
    root.add(box(coverMat, rect.w, 11, rect.h, rect.x + rect.w * 0.5, 5.5, rect.y + rect.h * 0.5));
  }

  for (const house of houses) {
    root.add(makeHouseMesh(house));
  }
  const dirt = new THREE.MeshLambertMaterial({ color: 0x6a5e48 });
  for (const roof of state.world.roofs) {
    if (houses.some((house) => Math.abs(house.roofZ - roof.z) < 0.5)) {
      continue;
    }
    root.add(box(dirt, roof.w, roof.z, roof.h, roof.x + roof.w * 0.5, roof.z * 0.5, roof.y + roof.h * 0.5));
  }
  for (const ramp of ramps) {
    root.add(makeRampMesh(ramp));
  }
  for (const poi of pois) {
    root.add(makePoi(poi));
  }
  for (const objective of state.objectives) {
    root.add(makeObjectiveProp(objective));
  }
}

function syncCrates(
  root: THREE.Group,
  crateMeshes: Map<string, THREE.Group>,
  state: GameState,
): void {
  if (crateMeshes.size === 0) {
    for (const crate of state.ammoCrates) {
      const mesh = makeCrate();
      mesh.position.set(crate.x, crate.z + 3.2, crate.y);
      root.add(mesh);
      crateMeshes.set(crate.id, mesh);
    }
  }
  for (const crate of state.ammoCrates) {
    const mesh = crateMeshes.get(crate.id);
    if (mesh) {
      mesh.visible = !crate.taken;
    }
  }
}

function makeCrate(): THREE.Group {
  const group = new THREE.Group();
  const wood = new THREE.MeshLambertMaterial({ color: 0x8a6239 });
  const strap = new THREE.MeshLambertMaterial({ color: 0x4a3424 });
  const boxMesh = new THREE.Mesh(new THREE.BoxGeometry(6.4, 6.2, 6.4), wood);
  boxMesh.position.y = 0;
  const band = new THREE.Mesh(new THREE.BoxGeometry(6.7, 1.2, 6.7), strap);
  band.position.y = 0.2;
  group.add(shadow(boxMesh), shadow(band));
  return group;
}

function makeHouseMesh(house: House): THREE.Group {
  const group = new THREE.Group();
  const casita = house.id === "casita";
  const plaster = casita
    ? getCasitaWallMaterial()
    : new THREE.MeshLambertMaterial({ color: house.color });
  const trim = new THREE.MeshLambertMaterial({ color: 0x5c4030 });
  const floorMat = new THREE.MeshLambertMaterial({ color: 0x6e5840 });
  floorMat.polygonOffset = true;
  floorMat.polygonOffsetFactor = 1;
  floorMat.polygonOffsetUnits = 1;

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(house.w - house.wall * 2 + 0.4, house.h - house.wall * 2 + 0.4),
    floorMat,
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(house.x + house.w * 0.5, 0.04, house.y + house.h * 0.5);
  group.add(shadow(floor, false, true));

  for (const wall of house.walls) {
    const wallMesh = box(
      plaster,
      wall.w,
      house.roofZ,
      wall.h,
      wall.x + wall.w * 0.5,
      house.roofZ * 0.5,
      wall.y + wall.h * 0.5,
    );
    if (casita) {
      applyWorldBoxUVs(wallMesh);
    }
    group.add(wallMesh);
  }

  group.add(
    box(
      trim,
      house.w + 14,
      2.8,
      house.h + 14,
      house.x + house.w * 0.5,
      house.roofZ + 1.5,
      house.y + house.h * 0.5,
    ),
  );
  return group;
}

function makeRampMesh(ramp: Ramp): THREE.Group {
  const group = new THREE.Group();
  const wood = new THREE.MeshLambertMaterial({ color: 0x7a5a3a });
  const steps = 8;
  for (let i = 0; i < steps; i++) {
    const t0 = i / steps;
    const t1 = (i + 1) / steps;
    const z = ramp.z0 + (ramp.z1 - ramp.z0) * t0;
    const nextZ = ramp.z0 + (ramp.z1 - ramp.z0) * t1;
    const h = Math.max(1.2, Math.abs(nextZ - z) + 0.8);
    if (ramp.along === "x") {
      const x = ramp.x + ramp.w * t0 + ramp.w / steps / 2;
      group.add(box(wood, ramp.w / steps + 0.4, h, ramp.h, x, z + h * 0.5, ramp.y + ramp.h * 0.5));
    } else {
      const y = ramp.y + ramp.h * t0 + ramp.h / steps / 2;
      group.add(box(wood, ramp.w, h, ramp.h / steps + 0.4, ramp.x + ramp.w * 0.5, z + h * 0.5, y));
    }
  }
  return group;
}

function makeObjectiveProp(objective: Objective): THREE.Group {
  const group = new THREE.Group();
  group.position.set(objective.x, objective.z, objective.y);
  if (objective.id === "techo") {
    const chimney = new THREE.Mesh(
      new THREE.BoxGeometry(5, 8, 5),
      new THREE.MeshLambertMaterial({ color: 0x6a3b32 }),
    );
    chimney.position.y = 4;
    group.add(shadow(chimney));
  } else if (objective.id === "mesa") {
    const top = new THREE.Mesh(
      new THREE.BoxGeometry(14, 1.1, 14),
      new THREE.MeshLambertMaterial({ color: 0x5a4030 }),
    );
    top.position.y = 7;
    const leg = new THREE.Mesh(
      new THREE.BoxGeometry(1.6, 7, 1.6),
      new THREE.MeshLambertMaterial({ color: 0x4a3428 }),
    );
    leg.position.y = 3.5;
    group.add(shadow(top), shadow(leg));
  } else {
    const rock = new THREE.Mesh(
      new THREE.DodecahedronGeometry(4.2, 0),
      new THREE.MeshLambertMaterial({ color: 0x7a776e }),
    );
    rock.position.y = 3;
    group.add(shadow(rock));
  }
  return group;
}

function makePoi(poi: Poi): THREE.Group {
  const group = new THREE.Group();
  group.position.set(poi.x, 0, poi.y);
  if (poi.kind === "fountain") {
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(poi.radius, poi.radius, 2.4, 20),
      new THREE.MeshLambertMaterial({ color: 0x4a463f }),
    );
    base.position.y = 1.2;
    const water = new THREE.Mesh(
      new THREE.CylinderGeometry(poi.radius * 0.62, poi.radius * 0.62, 1.2, 16),
      new THREE.MeshLambertMaterial({ color: 0x6cb6c9 }),
    );
    water.position.y = 2.2;
    const spout = new THREE.Mesh(
      new THREE.CylinderGeometry(1.1, 1.4, 6, 8),
      new THREE.MeshLambertMaterial({ color: 0x8d8678 }),
    );
    spout.position.y = 5;
    group.add(shadow(base), shadow(water, false, true), shadow(spout));
  } else if (poi.kind === "statue") {
    const ped = new THREE.Mesh(
      new THREE.BoxGeometry(10, 4, 10),
      new THREE.MeshLambertMaterial({ color: 0x5a544a }),
    );
    ped.position.y = 2;
    const figure = new THREE.Mesh(
      new THREE.CapsuleGeometry(2.4, 8, 4, 8),
      new THREE.MeshLambertMaterial({ color: 0x8d8678 }),
    );
    figure.position.y = 10;
    group.add(shadow(ped), shadow(figure));
  } else {
    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(1.3, 1.6, 7, 8),
      new THREE.MeshLambertMaterial({ color: 0x6b5a3e }),
    );
    post.position.y = 3.5;
    group.add(shadow(post));
  }
  return group;
}

function box(
  mat: THREE.Material,
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.position.set(x, y, z);
  return shadow(mesh);
}

function shadow(mesh: THREE.Mesh, cast = true, receive = true): THREE.Mesh {
  mesh.castShadow = cast;
  mesh.receiveShadow = receive;
  return mesh;
}

function sausage(mat: THREE.Material, radius: number, length: number): THREE.Mesh {
  return new THREE.Mesh(new THREE.CapsuleGeometry(radius, length, 4, 8), mat);
}

function makePerson(color: number, shade: number, hunter: boolean): THREE.Group {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshLambertMaterial({ color });
  const shadeMat = new THREE.MeshLambertMaterial({ color: shade });
  const dark = new THREE.MeshLambertMaterial({ color: 0x1c1914 });

  const hipY = 6.55;
  const hips = new THREE.Group();
  hips.position.y = hipY;
  group.add(hips);

  const pelvis = new THREE.Mesh(new THREE.SphereGeometry(1.55, 10, 8), bodyMat);
  pelvis.scale.set(1.2, 0.72, 1.0);
  hips.add(pelvis);

  const torsoR = 1.9;
  const torso = sausage(bodyMat, torsoR, 3.15);
  torso.position.y = 2.35;
  hips.add(torso);

  const belly = new THREE.Mesh(new THREE.SphereGeometry(1.55, 10, 8), shadeMat);
  belly.scale.set(1.12, 0.72, 0.92);
  belly.position.set(0, 1.55, 0.35);
  hips.add(belly);

  const headR = 2.2;
  const head = new THREE.Mesh(new THREE.SphereGeometry(headR, 14, 12), bodyMat);
  head.position.y = 5.85;
  hips.add(head);

  const eyeGeo = new THREE.SphereGeometry(0.28, 8, 6);
  const leftEye = new THREE.Mesh(eyeGeo, dark);
  leftEye.position.set(-0.62, 0.18, headR - 0.32);
  const rightEye = new THREE.Mesh(eyeGeo, dark);
  rightEye.position.set(0.62, 0.18, headR - 0.32);
  const mouth = new THREE.Mesh(new THREE.SphereGeometry(0.32, 8, 6), dark);
  mouth.scale.set(1.45, 0.42, 0.55);
  mouth.position.set(0, -0.58, headR - 0.38);
  head.add(leftEye, rightEye, mouth);

  if (hunter) {
    const hair = new THREE.Mesh(new THREE.SphereGeometry(headR * 0.92, 12, 8), shadeMat);
    hair.scale.set(1.02, 0.55, 1.02);
    hair.position.y = 0.95;
    head.add(hair);
  }

  const makeArm = (side: number): THREE.Group => {
    const pivot = new THREE.Group();
    pivot.position.set(side * (torsoR + 0.28), 3.55, 0);
    pivot.rotation.z = side * 0.22;
    const upper = sausage(bodyMat, 0.7, 2.35);
    upper.position.y = -1.45;
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.82, 8, 6), bodyMat);
    hand.position.y = -3.15;
    pivot.add(upper, hand);
    hips.add(pivot);
    return pivot;
  };

  const leftArm = makeArm(-1);
  const rightArm = makeArm(1);

  const makeLeg = (side: number): THREE.Group => {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.9, 0.1, 0);
    const thigh = sausage(bodyMat, 0.88, 2.55);
    thigh.position.y = -1.55;
    const shin = sausage(bodyMat, 0.78, 2.35);
    shin.position.y = -4.15;
    const foot = new THREE.Mesh(new THREE.SphereGeometry(0.82, 8, 6), bodyMat);
    foot.scale.set(1.05, 0.52, 1.45);
    foot.position.set(0, -hipY + 0.42, 0.38);
    pivot.add(thigh, shin, foot);
    hips.add(pivot);
    return pivot;
  };

  const leftLeg = makeLeg(-1);
  const rightLeg = makeLeg(1);

  if (hunter) {
    const gun = makeShotgun(0.72);
    gun.position.set(0.1, -3.05, 1.15);
    gun.rotation.set(1.15, 0.08, 0.12);
    rightArm.add(gun);
  }

  group.userData.head = head;
  group.userData.body = torso;
  group.userData.hips = hips;
  group.userData.bodyMat = bodyMat;
  group.userData.shadeMat = shadeMat;
  group.userData.leftArm = leftArm;
  group.userData.rightArm = rightArm;
  group.userData.leftLeg = leftLeg;
  group.userData.rightLeg = rightLeg;
  group.userData.crouchBlend = 0;
  return group;
}

function tintPerson(mesh: THREE.Group, color: number, shade: number): void {
  const bodyMat = mesh.userData.bodyMat as THREE.MeshLambertMaterial | undefined;
  const shadeMat = mesh.userData.shadeMat as THREE.MeshLambertMaterial | undefined;
  bodyMat?.color.setHex(color);
  shadeMat?.color.setHex(shade);
}

function makeBeacon(): THREE.Group {
  const group = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: 0xe6d39a, transparent: true, opacity: 0.55 });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(6.4, 0.38, 8, 28), mat);
  ring.rotation.x = Math.PI / 2;
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 26, 8), mat);
  shaft.position.y = 13;
  group.add(ring, shaft);
  return group;
}

function updateBeacon(beacon: THREE.Group, state: GameState, opts: ViewOpts): void {
  const next = state.objectives.find((objective) => !objective.done);
  const show = opts.role === "INFILTRATOR" && Boolean(next) && state.phase === "PLAYING";
  beacon.visible = show;
  if (!show || !next) {
    return;
  }
  beacon.position.set(next.x, next.z + 2, next.y);
  beacon.rotation.y = state.clock * 1.4;
  const pulse = 0.88 + Math.sin(state.clock * 4.2) * 0.12;
  beacon.scale.setScalar(pulse);
}

function createShotFx(
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  viewmodel: THREE.Group,
): {
  play: (opts: { firstPerson: boolean; hitX: number; hitY: number; hitZ: number; hit: boolean }) => void;
  consume: (state: GameState) => void;
  tick: () => void;
} {
  const sparkTex = makeSparkTexture();
  const sparkMat = new THREE.SpriteMaterial({
    map: sparkTex,
    color: 0xffffff,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const beamMat = new THREE.MeshBasicMaterial({
    color: 0xffe6a0,
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const fpFlash = makeMuzzleStar();
  fpFlash.position.set(0, 0.28, -9.1);
  fpFlash.visible = false;
  viewmodel.add(fpFlash);

  const fpLight = new THREE.PointLight(0xffc56a, 0, 18, 2);
  fpLight.position.set(0.08, -0.02, -0.7);
  camera.add(fpLight);

  const worldLight = new THREE.PointLight(0xffc56a, 0, 42, 2);
  scene.add(worldLight);

  const worldFlash = makeMuzzleStar();
  worldFlash.scale.setScalar(0.12);
  worldFlash.visible = false;
  scene.add(worldFlash);

  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.18, 1, 6, 1, true), beamMat);
  beam.visible = false;
  scene.add(beam);

  const sparks: {
    sprite: THREE.Sprite;
    vx: number;
    vy: number;
    vz: number;
    life: number;
    max: number;
  }[] = [];
  const sparkPool: THREE.Sprite[] = [];
  for (let i = 0; i < 48; i++) {
    const sprite = new THREE.Sprite(sparkMat.clone());
    sprite.visible = false;
    scene.add(sprite);
    sparkPool.push(sprite);
  }

  let lastShotId = 0;
  let localUntil = 0;
  let fpFlashLife = 0;
  let worldFlashLife = 0;
  let beamLife = 0;
  let fxLast = performance.now();

  function originFromCamera(): THREE.Vector3 {
    const origin = new THREE.Vector3();
    camera.getWorldPosition(origin);
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    origin.addScaledVector(dir, 1.15);
    origin.y -= 0.12;
    return origin;
  }

  function play(opts: { firstPerson: boolean; hitX: number; hitY: number; hitZ: number; hit: boolean }): void {
    localUntil = performance.now() + 280;
    const hit = new THREE.Vector3(opts.hitX, opts.hitZ, opts.hitY);
    burst(originFromCamera(), hit, opts.firstPerson, opts.hit);
  }

  function consume(state: GameState): void {
    const event = state.shotEvent;
    if (!event || event.id === lastShotId || event.hitX === undefined) {
      return;
    }
    lastShotId = event.id;
    if (performance.now() < localUntil) {
      return;
    }
    const origin = new THREE.Vector3(event.x, event.z, event.y);
    const hit = new THREE.Vector3(event.hitX, event.hitZ, event.hitY);
    burst(origin, hit, false, event.hit);
  }

  function burst(origin: THREE.Vector3, hit: THREE.Vector3, firstPerson: boolean, didHit: boolean): void {
    if (firstPerson) {
      fpFlashLife = 0.09;
      fpFlash.visible = true;
      fpFlash.rotation.z = Math.random() * Math.PI;
      fpLight.intensity = 7.5;
    } else {
      worldFlashLife = 0.12;
      worldFlash.visible = true;
      worldFlash.position.copy(origin);
      worldFlash.lookAt(hit);
      worldLight.position.copy(origin);
      worldLight.intensity = 9;
    }

    const dir = hit.clone().sub(origin);
    const len = Math.max(0.5, dir.length());
    if (dir.lengthSq() < 0.0001) {
      dir.set(0, 0, -1);
    } else {
      dir.normalize();
    }
    beam.visible = true;
    beamLife = 0.11;
    beam.position.copy(origin).add(hit).multiplyScalar(0.5);
    beam.scale.set(1, len, 1);
    beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    (beam.material as THREE.MeshBasicMaterial).opacity = 0.95;

    const count = didHit ? 28 : 14;
    for (let i = 0; i < count; i++) {
      const sprite = sparkPool.find((item) => !item.visible);
      if (!sprite) {
        break;
      }
      const along = origin.clone().lerp(hit, didHit ? 0.92 + Math.random() * 0.08 : 0.55 + Math.random() * 0.4);
      if (didHit && i < 22) {
        along.copy(hit);
      }
      sprite.position.copy(along);
      sprite.visible = true;
      const speed = (didHit ? 22 : 10) * (0.35 + Math.random());
      const yaw = Math.random() * Math.PI * 2;
      const pitch = (Math.random() - 0.25) * Math.PI;
      const mat = sprite.material as THREE.SpriteMaterial;
      mat.color.setHex(Math.random() > 0.35 ? 0xffe08a : 0xff9a3a);
      mat.opacity = 1;
      const size = didHit ? 1.1 + Math.random() * 1.6 : 0.7 + Math.random();
      sprite.scale.setScalar(size);
      sparks.push({
        sprite,
        vx: Math.cos(yaw) * Math.cos(pitch) * speed,
        vy: Math.sin(pitch) * speed + (didHit ? 8 : 2),
        vz: Math.sin(yaw) * Math.cos(pitch) * speed,
        life: 0.18 + Math.random() * 0.28,
        max: 0.18 + Math.random() * 0.28,
      });
    }
  }

  function tick(): void {
    const now = performance.now();
    const dt = Math.min(0.05, (now - fxLast) / 1000);
    fxLast = now;

    if (fpFlashLife > 0) {
      fpFlashLife -= dt;
      const k = Math.max(0, fpFlashLife / 0.09);
      fpFlash.visible = k > 0;
      fpFlash.scale.setScalar(0.8 + (1 - k) * 1.4);
      fpFlash.traverse((node) => {
        const mesh = node as THREE.Mesh;
        const mat = mesh.material as THREE.MeshBasicMaterial | undefined;
        if (mat?.opacity !== undefined) {
          mat.opacity = k;
        }
      });
      fpLight.intensity = 7.5 * k * k;
    } else {
      fpFlash.visible = false;
      fpLight.intensity = 0;
    }

    if (worldFlashLife > 0) {
      worldFlashLife -= dt;
      const k = Math.max(0, worldFlashLife / 0.12);
      worldFlash.visible = k > 0;
      worldFlash.scale.setScalar(0.08 + (1 - k) * 0.2);
      worldFlash.traverse((node) => {
        const mesh = node as THREE.Mesh;
        const mat = mesh.material as THREE.MeshBasicMaterial | undefined;
        if (mat?.opacity !== undefined) {
          mat.opacity = k;
        }
      });
      worldLight.intensity = 9 * k;
    } else {
      worldFlash.visible = false;
      worldLight.intensity = 0;
    }

    if (beamLife > 0) {
      beamLife -= dt;
      const k = Math.max(0, beamLife / 0.11);
      beam.visible = k > 0;
      (beam.material as THREE.MeshBasicMaterial).opacity = 0.95 * k;
      beam.scale.x = 0.6 + k * 0.8;
      beam.scale.z = 0.6 + k * 0.8;
    } else {
      beam.visible = false;
    }

    for (let i = sparks.length - 1; i >= 0; i--) {
      const spark = sparks[i];
      spark.life -= dt;
      if (spark.life <= 0) {
        spark.sprite.visible = false;
        sparks.splice(i, 1);
        continue;
      }
      spark.vy -= 55 * dt;
      spark.sprite.position.x += spark.vx * dt;
      spark.sprite.position.y += spark.vy * dt;
      spark.sprite.position.z += spark.vz * dt;
      const k = spark.life / spark.max;
      spark.sprite.scale.setScalar(0.4 + k * 1.8);
      (spark.sprite.material as THREE.SpriteMaterial).opacity = k;
    }
  }

  return { play, consume, tick };
}

function makeMuzzleStar(): THREE.Group {
  const group = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({
    color: 0xfff1c2,
    transparent: true,
    opacity: 1,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const wide = new THREE.Mesh(new THREE.PlaneGeometry(16, 3.2), mat);
  const tall = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 16), mat.clone());
  const glow = new THREE.Mesh(new THREE.CircleGeometry(4.4, 12), mat.clone());
  (glow.material as THREE.MeshBasicMaterial).color.setHex(0xff9a3a);
  group.add(wide, tall, glow);
  return group;
}

function makeSparkTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return new THREE.CanvasTexture(canvas);
  }
  const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,230,1)");
  grad.addColorStop(0.28, "rgba(255,190,70,0.95)");
  grad.addColorStop(1, "rgba(255,70,0,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

function makeShotgun(scale: number): THREE.Group {
  const gun = new THREE.Group();
  gun.scale.setScalar(scale);
  const wood = new THREE.MeshLambertMaterial({ color: 0x6b4a2b });
  const metal = new THREE.MeshLambertMaterial({ color: 0x2a2c2e });
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.5, 4.2), wood);
  stock.position.set(0, -0.35, 3.4);
  stock.rotation.x = 0.18;
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.8, 1.1), wood);
  grip.position.set(0, -0.9, 1.35);
  grip.rotation.x = 0.45;
  const receiver = new THREE.Mesh(new THREE.BoxGeometry(1.05, 1.15, 3.4), metal);
  receiver.position.set(0, 0.05, 0.2);
  const barrelL = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 9.2, 8), metal);
  barrelL.rotation.x = Math.PI / 2;
  barrelL.position.set(-0.32, 0.28, -4.4);
  const barrelR = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 9.2, 8), metal);
  barrelR.rotation.x = Math.PI / 2;
  barrelR.position.set(0.32, 0.28, -4.4);
  const pump = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.85, 2.2), wood);
  pump.position.set(0, -0.35, -1.6);
  gun.add(stock, grip, receiver, barrelL, barrelR, pump);
  return gun;
}

function poseLimbs(mesh: THREE.Group, walking: boolean, walkTime: number, downed: boolean, crouch: boolean): void {
  const swing = walking && !downed && !crouch ? Math.sin((walkTime / RHYTHM.walkBouncePeriod) * Math.PI * 2) : 0;
  const crouchSwing = walking && !downed && crouch ? Math.sin((walkTime / RHYTHM.walkBouncePeriod) * Math.PI * 2) : 0;
  const hips = mesh.userData.hips as THREE.Group | undefined;
  const leftArm = mesh.userData.leftArm as THREE.Group | undefined;
  const rightArm = mesh.userData.rightArm as THREE.Group | undefined;
  const leftLeg = mesh.userData.leftLeg as THREE.Group | undefined;
  const rightLeg = mesh.userData.rightLeg as THREE.Group | undefined;
  const blend = Number(mesh.userData.crouchBlend ?? 0);
  const nextBlend = downed ? 0 : blend + ((crouch ? 1 : 0) - blend) * 0.28;
  mesh.userData.crouchBlend = nextBlend;
  if (hips) {
    hips.position.y = 6.55 - nextBlend * 3.55;
    hips.rotation.x = nextBlend * 0.42;
  }
  if (leftArm) {
    leftArm.rotation.x = swing * 0.7 + nextBlend * 0.35 + crouchSwing * 0.22;
  }
  if (rightArm) {
    rightArm.rotation.x = -swing * 0.7 + nextBlend * 0.55 + crouchSwing * 0.18;
  }
  if (leftLeg) {
    leftLeg.rotation.x = -swing * 0.55 + nextBlend * 1.05 + crouchSwing * 0.2;
  }
  if (rightLeg) {
    rightLeg.rotation.x = swing * 0.55 + nextBlend * 1.05 - crouchSwing * 0.2;
  }
}

function syncPerson(mesh: THREE.Group, entity: Entity, revealed: boolean, clock: number, crouch: boolean): void {
  const walking =
    !entity.downed &&
    (entity.state === "WANDER" || entity.state === "REACT" || (entity.state === "REGROUP" && !isHolding(entity)));
  const rigged = isRiggedBoli(mesh);
  const bounce = walking && !crouch && !rigged
    ? Math.abs(Math.sin((entity.walkTime / RHYTHM.walkBouncePeriod) * Math.PI * 2)) * RHYTHM.walkBounceAmp * 0.45
    : 0;
  const stumble = entity.stumbleTtl > 0 ? Math.sin(clock * 18) * 0.18 : 0;
  mesh.position.set(entity.x, entity.z + bounce, entity.y);
  mesh.rotation.x = !rigged && entity.downed ? Math.PI / 2 : 0;
  mesh.rotation.y = Math.atan2(Math.cos(entity.angle), Math.sin(entity.angle));
  mesh.rotation.z = stumble;
  if (rigged) {
    syncBoliAnimation(mesh, {
      walking,
      crouch: crouch && !entity.downed,
      downed: entity.downed,
      dancing: entity.state === "DANCE",
      walkTime: entity.walkTime,
      x: entity.x,
      y: entity.y,
      id: entity.id,
    });
  } else {
    poseLimbs(mesh, walking, entity.walkTime, entity.downed, crouch && !entity.downed);
  }
  const bodyMat = mesh.userData.bodyMat as THREE.MeshLambertMaterial | undefined;
  if (bodyMat) {
    bodyMat.emissive.setHex(revealed ? 0x661111 : 0x000000);
  }
}

function syncHunter(mesh: THREE.Group, hunter: Hunter, crouch: boolean): void {
  const walking = hunter.state === "WANDER";
  const rigged = isRiggedBoli(mesh);
  const bounce = walking && !crouch && !rigged
    ? Math.abs(Math.sin((hunter.walkTime / RHYTHM.walkBouncePeriod) * Math.PI * 2)) * RHYTHM.walkBounceAmp * 0.45
    : 0;
  mesh.position.set(hunter.x, hunter.z + bounce, hunter.y);
  mesh.rotation.y = Math.atan2(Math.cos(hunter.angle), Math.sin(hunter.angle));
  if (rigged) {
    syncBoliAnimation(mesh, {
      walking,
      crouch,
      downed: false,
      walkTime: hunter.walkTime,
      x: hunter.x,
      y: hunter.y,
      id: hunter.controllerId ?? "hunter",
    });
  } else {
    poseLimbs(mesh, walking, hunter.walkTime, false, crouch);
  }
}

function isHolding(entity: Entity): boolean {
  const gx = typeof entity.goalX === "number" ? entity.goalX : entity.targetX;
  const gy = typeof entity.goalY === "number" ? entity.goalY : entity.targetY;
  return Math.hypot(gx - entity.x, gy - entity.y) <= RHYTHM.wanderArriveSlack;
}

function bindHud(): Hud {
  const end = must("#end");
  const lock = must("#lock");
  const hpWrap = must("#hpwrap");
  const ammoWrap = must("#ammoWrap");
  const hpHearts = Array.from(must("#hpHearts").querySelectorAll<HTMLElement>(".hud-heart"));
  const ammoShots = Array.from(must("#ammoShots").querySelectorAll<HTMLElement>(".hud-shot"));
  const clearAnim = (el: HTMLElement, classes: string[]): void => {
    el.addEventListener("animationend", (ev) => {
      if (ev.target === el) {
        el.classList.remove(...classes);
      }
    });
  };
  clearAnim(hpWrap, ["is-hit", "is-heal"]);
  clearAnim(ammoWrap, ["is-fire", "is-gain"]);
  for (const slot of [...hpHearts, ...ammoShots]) {
    slot.addEventListener("animationend", () => slot.classList.remove("is-pop"));
  }
  return {
    time: must("#time"),
    round: must("#roundTag"),
    mode: must("#mode"),
    hint: must("#hint"),
    mission: must("#mission"),
    hpWrap,
    hpHearts,
    ammoWrap,
    ammoShots,
    ammoCount: must("#ammoCount"),
    banner: must("#banner"),
    bannerText: must("#bannerText"),
    crosshair: must("#crosshair"),
    lock,
    lockTitle: lock.querySelector("h1") ?? lock,
    lockBody: lock.querySelector("p") ?? lock,
    end,
    endTitle: end.querySelector("h1") ?? end,
    hurt: must("#hurt"),
    way: must("#way"),
    wayNeedle: must("#wayNeedle"),
    wayMeta: must("#wayMeta"),
  };
}

function must(selector: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(selector);
  if (!el) {
    throw new Error(`No se encontró ${selector}`);
  }
  return el;
}

function resetHudCache(): void {
  hudCache.time = "";
  hudCache.round = "";
  hudCache.hearts = -1;
  hudCache.critical = false;
  hudCache.ammoShown = false;
  hudCache.shots = -1;
  hudCache.ammo = -1;
  hudCache.mode = "";
  hudCache.modeOn = false;
  hudCache.modeShown = false;
  hudCache.mission = "";
  hudCache.missionShown = false;
  hudCache.banner = "";
  hudCache.hint = "";
  hudCache.lockTitle = "";
  hudCache.playing = true;
  hudCache.endTitle = "";
  bannerHideAt = 0;
}

function slotsFromRatio(ratio: number, slots: number): number {
  if (ratio <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(slots, Math.round(ratio * slots)));
}

function ammoSlots(ammo: number): number {
  if (ammo <= 0) {
    return 0;
  }
  return Math.min(AMMO_SLOTS, Math.ceil(ammo / (ROUND.maxShells / AMMO_SLOTS)));
}

function presentBanner(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) {
    return trimmed;
  }
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

function bumpHudAnim(el: HTMLElement, className: string): void {
  el.classList.remove(className);
  void el.offsetWidth;
  el.classList.add(className);
}

function setSlots(els: HTMLElement[], filled: number, popIndex: number): void {
  for (let i = 0; i < els.length; i++) {
    const on = i < filled;
    const el = els[i];
    const wasOn = el.classList.contains("is-on");
    if (wasOn !== on) {
      el.classList.toggle("is-on", on);
      el.classList.toggle("is-off", !on);
      if (i === popIndex) {
        bumpHudAnim(el, "is-pop");
      }
    }
  }
}

function setHearts(hud: Hud, ratio: number): void {
  hud.hpWrap.classList.remove("hidden");
  const hearts = slotsFromRatio(ratio, HEART_SLOTS);
  const critical = ratio > 0 && ratio <= 0.25;
  if (hudCache.hearts !== hearts) {
    const pop = hudCache.hearts < 0 ? -1 : hearts < hudCache.hearts ? hearts : hearts - 1;
    setSlots(hud.hpHearts, hearts, pop);
    hudCache.hearts = hearts;
  }
  if (hudCache.critical !== critical) {
    hud.hpWrap.classList.toggle("is-critical", critical);
    hudCache.critical = critical;
  }
}

function setAmmo(hud: Hud, ammo: number): void {
  const shots = ammoSlots(ammo);
  if (hudCache.shots !== shots) {
    const pop = hudCache.shots < 0 ? -1 : shots < hudCache.shots ? shots : shots - 1;
    setSlots(hud.ammoShots, shots, pop);
    if (hudCache.shots >= 0 && shots < hudCache.shots) {
      bumpHudAnim(hud.ammoWrap, "is-fire");
    } else if (hudCache.shots >= 0 && shots > hudCache.shots) {
      bumpHudAnim(hud.ammoWrap, "is-gain");
    }
    hudCache.shots = shots;
  }
  if (hudCache.ammo !== ammo) {
    hud.ammoCount.textContent = String(ammo);
    hud.ammoWrap.classList.toggle("is-empty", ammo <= 0);
    hudCache.ammo = ammo;
  }
}

function disposePerson(root: THREE.Object3D): void {
  disposeBoliCharacter(root);
  if (root.userData.kind === "rigged") {
    return;
  }
  const seen = new Set<THREE.BufferGeometry | THREE.Material>();
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) {
      return;
    }
    if (mesh.geometry && !seen.has(mesh.geometry)) {
      seen.add(mesh.geometry);
      mesh.geometry.dispose();
    }
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) {
      if (mat && !seen.has(mat)) {
        seen.add(mat);
        mat.dispose();
      }
    }
  });
}

function setBanner(hud: Hud, raw: string | undefined): void {
  const now = performance.now();
  if (raw) {
    const text = presentBanner(raw);
    bannerHideAt = 0;
    if (hudCache.banner !== text) {
      hud.bannerText.textContent = text;
      hud.banner.classList.remove("hidden", "is-out");
      bumpHudAnim(hud.banner, "is-in");
      hudCache.banner = text;
    }
    return;
  }
  if (hudCache.banner === "" && hud.banner.classList.contains("hidden")) {
    return;
  }
  if (!bannerHideAt) {
    bannerHideAt = now + 260;
    hud.banner.classList.remove("is-in");
    hud.banner.classList.add("is-out");
    return;
  }
  if (now >= bannerHideAt) {
    hud.banner.classList.add("hidden");
    hud.banner.classList.remove("is-out", "is-in");
    hudCache.banner = "";
    bannerHideAt = 0;
  }
}

function updateHud(
  hud: Hud,
  state: GameState,
  opts: ViewOpts,
  activeHunter: Hunter,
  localEntity: Entity | undefined,
): void {
  const time = formatTime(state.timeLeft);
  if (hudCache.time !== time) {
    hud.time.textContent = time;
    hudCache.time = time;
  }
  const roundNumber = opts.roundNumber ?? 1;
  const totalRounds = opts.totalRounds ?? 5;
  const round = `RONDA ${roundNumber} / ${totalRounds}`;
  if (hudCache.round !== round) {
    hud.round.textContent = round;
    hudCache.round = round;
  }
  const mission = missionSummary(state);
  setBanner(hud, state.behaviorCheck?.banner);
  const touchUi = Boolean(opts.touchUi);
  if (opts.role === "HUNTER") {
    if (hudCache.ammoShown !== true) {
      hud.ammoWrap.classList.remove("hidden");
      hud.mode.classList.add("hidden");
      hudCache.ammoShown = true;
      hudCache.modeShown = false;
    }
    setAmmo(hud, state.accusationsLeft);
    setHearts(hud, activeHunter.hp / ROUND.hunterHp);
    const hint = touchUi
      ? "Joystick · arrastrá para mirar"
      : "Shift: correr · C / Ctrl: agachar · Esc: opciones";
    if (hudCache.hint !== hint) {
      hud.hint.textContent = hint;
      hudCache.hint = hint;
    }
    if (hudCache.missionShown) {
      hud.mission.classList.add("hidden");
      hudCache.missionShown = false;
    }
    const lockTitle = "Sos el cazador";
    if (hudCache.lockTitle !== lockTitle) {
      hud.lockTitle.textContent = lockTitle;
      hud.lockBody.textContent = touchUi
        ? "Joystick a la izquierda, mirá a la derecha, dispará con el botón. Pocos cartuchos."
        : "Pocos cartuchos. Pegarle a un boli te cuesta sangre. Observá quién se mueve distinto.";
      hudCache.lockTitle = lockTitle;
    }
  } else {
    if (hudCache.ammoShown) {
      hud.ammoWrap.classList.add("hidden");
      hudCache.ammoShown = false;
    }
    const mode = opts.boliMode ? "Modo boli ON" : touchUi ? "Modo boli" : "Q: modo boli";
    if (!hudCache.modeShown) {
      hud.mode.classList.remove("hidden");
      hudCache.modeShown = true;
    }
    if (hudCache.mode !== mode) {
      hud.mode.textContent = mode;
      hudCache.mode = mode;
    }
    if (hudCache.modeOn !== opts.boliMode) {
      hud.mode.classList.toggle("on", opts.boliMode);
      hudCache.modeOn = opts.boliMode;
    }
    const hp = localEntity && !localEntity.downed ? localEntity.hp : 0;
    setHearts(hud, hp / ROUND.hitsToDown);
    const hint = touchUi
      ? "Joystick · arrastrá para mirar"
      : "Shift: correr · C / Ctrl: agachar · Q: boli · Esc: opciones";
    if (hudCache.hint !== hint) {
      hud.hint.textContent = hint;
      hudCache.hint = hint;
    }
    const missionText = `Misión ${mission.done}/${mission.total}: ${mission.next}`;
    if (!hudCache.missionShown) {
      hud.mission.classList.remove("hidden");
      hudCache.missionShown = true;
    }
    if (hudCache.mission !== missionText) {
      hud.mission.textContent = missionText;
      hudCache.mission = missionText;
    }
    const lockTitle = "Hacete el boli";
    if (hudCache.lockTitle !== lockTitle) {
      hud.lockTitle.textContent = lockTitle;
      hud.lockBody.textContent = touchUi
        ? "Mezclate con la manada. Usá el joystick y el botón Boli para copiar el ritmo."
        : "Mezclate con la manada y cumplí la misión, o sobreviví hasta que se acabe el tiempo. Quedarte solo te delata.";
      hudCache.lockTitle = lockTitle;
    }
  }
  hud.crosshair.classList.toggle("hidden", !opts.pointerLocked || Boolean(opts.paused));
  hud.lock.classList.toggle(
    "hidden",
    opts.pointerLocked || Boolean(opts.paused) || state.phase !== "PLAYING",
  );
  const endHint = hud.end.querySelector("p");
  if (endHint) {
    const endText = touchUi ? "Pausa para volver al menú" : "Esc para volver al menú";
    if (endHint.textContent !== endText) {
      endHint.textContent = endText;
    }
  }

  const playing = state.phase === "PLAYING";
  if (playing || opts.overlay) {
    if (!hudCache.playing || hudCache.endTitle !== "") {
      hud.end.classList.add("hidden");
      hudCache.playing = true;
      hudCache.endTitle = "";
    }
    return;
  }
  const title = endTitle(state);
  if (hudCache.playing || hudCache.endTitle !== title) {
    hud.end.classList.remove("hidden");
    hud.endTitle.textContent = title;
    hudCache.playing = false;
    hudCache.endTitle = title;
  }
}

function updateWaypoint(camera: THREE.PerspectiveCamera, hud: Hud, state: GameState, opts: ViewOpts): void {
  const next = state.objectives.find((objective) => !objective.done);
  const show = opts.role === "INFILTRATOR" && Boolean(next) && state.phase === "PLAYING" && !opts.paused;
  hud.way.classList.toggle("hidden", !show);
  if (!show || !next) {
    return;
  }
  wayNdc.set(next.x, next.z + 10, next.y).project(camera);
  const dist = Math.hypot(next.x - camera.position.x, next.y - camera.position.z);
  const behind = wayNdc.z > 1;
  let sx = (wayNdc.x * 0.5 + 0.5) * window.innerWidth;
  let sy = (-wayNdc.y * 0.5 + 0.5) * window.innerHeight;
  if (behind) {
    sx = window.innerWidth - sx;
    sy = window.innerHeight - sy;
  }
  const margin = usesTouchInput() ? 88 : 52;
  const cx = window.innerWidth * 0.5;
  const cy = window.innerHeight * 0.5;
  const onScreen = !behind && wayNdc.x >= -0.92 && wayNdc.x <= 0.92 && wayNdc.y >= -0.82 && wayNdc.y <= 0.82;
  if (onScreen) {
    hud.way.style.left = `${sx}px`;
    hud.way.style.top = `${sy}px`;
    hud.wayNeedle.style.transform = "rotate(0deg)";
    hud.wayMeta.textContent = `${Math.round(dist)} · ${next.label}`;
    return;
  }
  const dx = sx - cx;
  const dy = sy - cy;
  const ang = Math.atan2(dy, dx);
  const tx = Math.cos(ang);
  const ty = Math.sin(ang);
  const scale = Math.min((cx - margin) / Math.max(0.001, Math.abs(tx)), (cy - margin) / Math.max(0.001, Math.abs(ty)));
  hud.way.style.left = `${cx + tx * scale}px`;
  hud.way.style.top = `${cy + ty * scale}px`;
  hud.wayNeedle.style.transform = `rotate(${(ang * 180) / Math.PI + 90}deg)`;
  hud.wayMeta.textContent = `${Math.round(dist)}`;
}

function endTitle(state: GameState): string {
  if (state.phase === "HUNTER_WIN") {
    return "El infiltrado cayó";
  }
  if (state.objectives.every((objective) => objective.done)) {
    return "El boli cumplió la misión";
  }
  if (state.hunter.hp <= 0 && state.extraHunters.every((hunter) => hunter.hp <= 0)) {
    return "El cazador se quedó sin pulso";
  }
  return "El boli sobrevivió";
}

function formatTime(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}
