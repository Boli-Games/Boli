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

const BOLI_COLOR = 0xe4d2b2;
const BOLI_SHADE = 0xc9b48a;
const HUNTER_COLOR = 0x3c342c;
const HUNTER_SHADE = 0x5a4c40;
const wayNdc = new THREE.Vector3();

type Hud = {
  time: HTMLElement;
  mode: HTMLElement;
  hint: HTMLElement;
  mission: HTMLElement;
  hpWrap: HTMLElement;
  hpFill: HTMLElement;
  banner: HTMLElement;
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
};

export type GameView = {
  resize: () => void;
  rebuild: (state: GameState) => void;
  render: (state: GameState, opts: ViewOpts) => void;
  pickAimedEntity: (state: GameState, hunter: Hunter, yaw: number, pitch: number) => Entity | null;
};

export function createView(canvas: HTMLCanvasElement): GameView {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87a08c);
  scene.fog = new THREE.Fog(0x87a08c, 180, 720);

  const fpsCamera = new THREE.PerspectiveCamera(70, 1, 0.2, 900);
  fpsCamera.rotation.order = "YXZ";
  scene.add(fpsCamera);

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

  const raycaster = new THREE.Raycaster();
  const centerNdc = new THREE.Vector2(0, 0);

  addLights(scene);
  const hud = bindHud();
  const beacon = makeBeacon();
  beacon.visible = false;
  scene.add(beacon);
  let builtWorldKey = "";
  let trackedHp = -1;
  let hurtUntil = 0;

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
  }

  function rebuild(state: GameState): void {
    ensureWorld(state);
    while (characterRoot.children.length > 0) {
      characterRoot.remove(characterRoot.children[0]);
    }
    boliMeshes.clear();
    extraMeshes.length = 0;
    for (const entity of state.entities) {
      const mesh = makePerson(BOLI_COLOR, BOLI_SHADE, false);
      mesh.userData.entityId = entity.id;
      boliMeshes.set(entity.id, mesh);
      characterRoot.add(mesh);
    }
    hunterMesh = makePerson(HUNTER_COLOR, HUNTER_SHADE, true);
    characterRoot.add(hunterMesh);
    for (const extra of state.extraHunters) {
      void extra;
      const mesh = makePerson(HUNTER_COLOR, HUNTER_SHADE, true);
      extraMeshes.push(mesh);
      characterRoot.add(mesh);
    }
    trackedHp = -1;
    hurtUntil = 0;
  }

  function resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
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
  ): void {
    const eye = crouch ? VIEW.crouchEyeHeight : VIEW.eyeHeight;
    const bob = walking && !crouch
      ? Math.abs(Math.sin((walkTime / RHYTHM.walkBouncePeriod) * Math.PI * 2)) * RHYTHM.walkBounceAmp * 0.45
      : 0;
    fpsCamera.position.set(x, groundZ + eye + bob, z);
    fpsCamera.rotation.y = Math.atan2(-Math.cos(yaw), -Math.sin(yaw));
    fpsCamera.rotation.x = pitch;
    fpsCamera.rotation.z = 0;
  }

  function render(state: GameState, opts: ViewOpts): void {
    ensureWorld(state);
    syncCrates(worldRoot, crateMeshes, state);
    if (boliMeshes.size !== state.entities.length || extraMeshes.length !== state.extraHunters.length) {
      rebuild(state);
    }

    const localId = opts.localId ?? "local";
    const localEntity = state.entities.find((entity) => entity.controllerId === localId);
    const hunterIndex = opts.hunterIndex ?? 0;
    const activeHunter =
      hunterIndex <= 0 ? state.hunter : (state.extraHunters[hunterIndex - 1] ?? state.hunter);

    for (const entity of state.entities) {
      const mesh = boliMeshes.get(entity.id);
      if (!mesh) {
        continue;
      }
      syncPerson(mesh, entity, state.revealTtl > 0 && entity.controllerId === localId, state.clock);
      mesh.visible = !(opts.role === "INFILTRATOR" && entity.controllerId === localId);
    }
    if (hunterMesh) {
      syncHunter(hunterMesh, state.hunter);
      hunterMesh.visible = !(opts.role === "HUNTER" && hunterIndex === 0);
    }
    state.extraHunters.forEach((hunter, index) => {
      const mesh = extraMeshes[index];
      if (mesh) {
        syncHunter(mesh, hunter);
        mesh.visible = !(opts.role === "HUNTER" && hunterIndex === index + 1);
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
        opts.crouch,
      );
      viewmodel.visible = true;
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
        opts.crouch,
      );
      viewmodel.visible = false;
    }

    const localHp =
      opts.role === "HUNTER" ? activeHunter.hp : (localEntity && !localEntity.downed ? localEntity.hp : 0);
    if (trackedHp >= 0 && localHp < trackedHp) {
      hurtUntil = state.clock + 0.45;
    }
    trackedHp = localHp;
    hud.hurt.style.opacity = String(Math.max(0, (hurtUntil - state.clock) / 0.45));

    updateBeacon(beacon, state, opts);
    updateWaypoint(fpsCamera, hud, state, opts);
    updateHud(hud, state, opts, activeHunter, localEntity);
    renderer.render(scene, fpsCamera);
  }

  function pickAimedEntity(state: GameState, hunter: Hunter, yaw: number, pitch: number): Entity | null {
    const targets: THREE.Object3D[] = [];
    for (const entity of state.entities) {
      const mesh = boliMeshes.get(entity.id);
      if (!mesh || entity.downed) {
        continue;
      }
      syncPerson(mesh, entity, false, 0);
      mesh.updateMatrixWorld(true);
      targets.push(mesh);
    }
    placeCamera(hunter.x, hunter.y, hunter.z, yaw, pitch, 0, false);
    fpsCamera.updateMatrixWorld();
    raycaster.setFromCamera(centerNdc, fpsCamera);
    raycaster.far = ROUND.shotRange;
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
    return state.entities.find((entity) => entity.id === id) ?? null;
  }

  resize();
  return { resize, rebuild, render, pickAimedEntity };
}

function addLights(scene: THREE.Scene): void {
  const hemi = new THREE.HemisphereLight(0xe8f0e6, 0x3d4338, 0.95);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff4d6, 1.35);
  sun.position.set(80, 140, 40);
  scene.add(sun);
  const fill = new THREE.AmbientLight(0x6d7a68, 0.35);
  scene.add(fill);
}

function buildWorld(root: THREE.Group, state: GameState): void {
  const { width, height, pois, cover, houses, ramps } = state.world;
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(width, height),
    new THREE.MeshLambertMaterial({ color: 0x4f5c46 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(width * 0.5, 0, height * 0.5);
  root.add(ground);

  const wallMat = new THREE.MeshLambertMaterial({ color: 0x5a5348 });
  const wallH = 44;
  const wallT = 8;
  root.add(box(wallMat, width + wallT * 2, wallH, wallT, width * 0.5, wallH * 0.5, -wallT * 0.5));
  root.add(box(wallMat, width + wallT * 2, wallH, wallT, width * 0.5, wallH * 0.5, height + wallT * 0.5));
  root.add(box(wallMat, wallT, wallH, height, -wallT * 0.5, wallH * 0.5, height * 0.5));
  root.add(box(wallMat, wallT, wallH, height, width + wallT * 0.5, wallH * 0.5, height * 0.5));

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
  group.add(boxMesh, band);
  return group;
}

function makeHouseMesh(house: House): THREE.Group {
  const group = new THREE.Group();
  const plaster = new THREE.MeshLambertMaterial({ color: house.color });
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
  group.add(floor);

  for (const wall of house.walls) {
    group.add(
      box(
        plaster,
        wall.w,
        house.roofZ,
        wall.h,
        wall.x + wall.w * 0.5,
        house.roofZ * 0.5,
        wall.y + wall.h * 0.5,
      ),
    );
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
    group.add(chimney);
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
    group.add(top, leg);
  } else {
    const rock = new THREE.Mesh(
      new THREE.DodecahedronGeometry(4.2, 0),
      new THREE.MeshLambertMaterial({ color: 0x7a776e }),
    );
    rock.position.y = 3;
    group.add(rock);
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
    group.add(base, water, spout);
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
    group.add(ped, figure);
  } else {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(poi.radius * 0.55, poi.radius, 24),
      new THREE.MeshLambertMaterial({ color: 0x3a4a3c, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.05;
    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(1.3, 1.6, 7, 8),
      new THREE.MeshLambertMaterial({ color: 0x6b5a3e }),
    );
    post.position.y = 3.5;
    group.add(ring, post);
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
  group.userData.bodyMat = bodyMat;
  group.userData.shadeMat = shadeMat;
  group.userData.leftArm = leftArm;
  group.userData.rightArm = rightArm;
  group.userData.leftLeg = leftLeg;
  group.userData.rightLeg = rightLeg;
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

function poseLimbs(mesh: THREE.Group, walking: boolean, walkTime: number, downed: boolean): void {
  const swing = walking && !downed ? Math.sin((walkTime / RHYTHM.walkBouncePeriod) * Math.PI * 2) : 0;
  const leftArm = mesh.userData.leftArm as THREE.Group | undefined;
  const rightArm = mesh.userData.rightArm as THREE.Group | undefined;
  const leftLeg = mesh.userData.leftLeg as THREE.Group | undefined;
  const rightLeg = mesh.userData.rightLeg as THREE.Group | undefined;
  if (leftArm) {
    leftArm.rotation.x = swing * 0.7;
  }
  if (rightArm) {
    rightArm.rotation.x = -swing * 0.7;
  }
  if (leftLeg) {
    leftLeg.rotation.x = -swing * 0.55;
  }
  if (rightLeg) {
    rightLeg.rotation.x = swing * 0.55;
  }
}

function syncPerson(mesh: THREE.Group, entity: Entity, revealed: boolean, clock: number): void {
  const walking =
    !entity.downed &&
    (entity.state === "WANDER" || entity.state === "REACT" || (entity.state === "REGROUP" && !isHolding(entity)));
  const bounce = walking
    ? Math.abs(Math.sin((entity.walkTime / RHYTHM.walkBouncePeriod) * Math.PI * 2)) * RHYTHM.walkBounceAmp * 0.45
    : 0;
  const stumble = entity.stumbleTtl > 0 ? Math.sin(clock * 18) * 0.18 : 0;
  mesh.position.set(entity.x, entity.z + bounce, entity.y);
  mesh.rotation.x = entity.downed ? Math.PI / 2 : 0;
  mesh.rotation.y = Math.atan2(Math.cos(entity.angle), Math.sin(entity.angle));
  mesh.rotation.z = stumble;
  poseLimbs(mesh, walking, entity.walkTime, entity.downed);
  const body = mesh.userData.body as THREE.Mesh;
  const mat = body.material as THREE.MeshLambertMaterial;
  mat.emissive.setHex(revealed ? 0x661111 : 0x000000);
}

function syncHunter(mesh: THREE.Group, hunter: Hunter): void {
  const walking = hunter.state === "WANDER";
  const bounce = walking
    ? Math.abs(Math.sin((hunter.walkTime / RHYTHM.walkBouncePeriod) * Math.PI * 2)) * RHYTHM.walkBounceAmp * 0.45
    : 0;
  mesh.position.set(hunter.x, hunter.z + bounce, hunter.y);
  mesh.rotation.y = Math.atan2(Math.cos(hunter.angle), Math.sin(hunter.angle));
  poseLimbs(mesh, walking, hunter.walkTime, false);
}

function isHolding(entity: Entity): boolean {
  return Math.hypot(entity.targetX - entity.x, entity.targetY - entity.y) <= RHYTHM.wanderArriveSlack;
}

function bindHud(): Hud {
  const end = must("#end");
  const lock = must("#lock");
  return {
    time: must("#time"),
    mode: must("#mode"),
    hint: must("#hint"),
    mission: must("#mission"),
    hpWrap: must("#hpwrap"),
    hpFill: must("#hpfill"),
    banner: must("#banner"),
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

function setHpBar(hud: Hud, ratio: number): void {
  hud.hpWrap.classList.remove("hidden");
  hud.hpFill.style.width = `${Math.max(0, Math.min(100, ratio * 100))}%`;
  hud.hpFill.classList.toggle("mid", ratio <= 0.5 && ratio > 0.25);
  hud.hpFill.classList.toggle("low", ratio <= 0.25);
}

function updateHud(
  hud: Hud,
  state: GameState,
  opts: ViewOpts,
  activeHunter: Hunter,
  localEntity: Entity | undefined,
): void {
  hud.time.textContent = formatTime(state.timeLeft);
  const mission = missionSummary(state);
  if (state.behaviorCheck) {
    hud.banner.classList.remove("hidden");
    hud.banner.textContent = state.behaviorCheck.banner;
  } else {
    hud.banner.classList.add("hidden");
  }
  if (opts.role === "HUNTER") {
    hud.mode.textContent = `${state.accusationsLeft} cartuchos`;
    hud.mode.classList.toggle("on", state.accusationsLeft > 0);
    setHpBar(hud, activeHunter.hp / ROUND.hunterHp);
    hud.hint.textContent = "Shift: correr · Ctrl: agachar · Esc: opciones";
    hud.mission.classList.add("hidden");
    hud.lockTitle.textContent = "Sos el cazador";
    hud.lockBody.textContent =
      "Pocos cartuchos. Pegarle a un boli te cuesta sangre. Observá quién se mueve distinto.";
  } else {
    hud.mode.textContent = opts.boliMode ? "Modo boli ON" : "Q: modo boli";
    hud.mode.classList.toggle("on", opts.boliMode);
    const hp = localEntity && !localEntity.downed ? localEntity.hp : 0;
    setHpBar(hud, hp / ROUND.hitsToDown);
    hud.hint.textContent = "Shift: correr · Ctrl: agachar · Q: boli · Esc: opciones";
    hud.mission.classList.remove("hidden");
    hud.mission.textContent = `Misión ${mission.done}/${mission.total}: ${mission.next}`;
    hud.lockTitle.textContent = "Hacete el boli";
    hud.lockBody.textContent =
      "Mezclate con la manada y cumplí la misión, o sobreviví hasta que se acabe el tiempo. Quedarte solo te delata.";
  }
  hud.crosshair.classList.toggle("hidden", !opts.pointerLocked || Boolean(opts.paused));
  hud.lock.classList.toggle(
    "hidden",
    opts.pointerLocked || Boolean(opts.paused) || state.phase !== "PLAYING",
  );

  if (state.phase === "PLAYING") {
    hud.end.classList.add("hidden");
    return;
  }
  hud.end.classList.remove("hidden");
  hud.endTitle.textContent = endTitle(state);
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
  const margin = 52;
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
