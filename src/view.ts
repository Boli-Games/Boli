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

const BOLI_COLOR = 0xe4d2b2;
const BOLI_SHADE = 0xc9b48a;
const HUNTER_COLOR = 0x3c342c;
const HUNTER_SHADE = 0x5a4c40;

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
};

export type ViewOpts = {
  role: ControlRole;
  yaw: number;
  pitch: number;
  boliMode: boolean;
  pointerLocked: boolean;
  localId?: string;
  hunterIndex?: number;
  online?: boolean;
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
  let builtWorldKey = "";

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
  ): void {
    const bob = walking
      ? Math.abs(Math.sin((walkTime / RHYTHM.walkBouncePeriod) * Math.PI * 2)) * RHYTHM.walkBounceAmp * 0.45
      : 0;
    fpsCamera.position.set(x, groundZ + VIEW.eyeHeight + bob, z);
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
      );
      viewmodel.visible = true;
      viewmodel.rotation.x = 0.12 + state.shotKick * 0.12;
      viewmodel.position.set(0.24, -0.3 - state.shotKick * 0.04, -0.46);
    } else if (localEntity) {
      const walking = localEntity.state === "WANDER";
      placeCamera(localEntity.x, localEntity.y, localEntity.z, opts.yaw, opts.pitch, localEntity.walkTime, walking);
      viewmodel.visible = false;
    }

    updateHud(hud, state, opts, activeHunter);
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

function makePerson(color: number, shade: number, hunter: boolean): THREE.Group {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshLambertMaterial({ color });
  const shadeMat = new THREE.MeshLambertMaterial({ color: shade });
  const radius = 2.6;
  const torso = 6.6;
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(radius, torso, 4, 10), bodyMat);
  body.position.y = radius + torso * 0.5;
  const headR = 2.4;
  const head = new THREE.Mesh(new THREE.SphereGeometry(headR, 12, 10), bodyMat);
  head.position.y = radius + torso + headR * 0.85;
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.85, 2.1, 8), shadeMat);
  nose.rotation.x = Math.PI / 2;
  nose.position.set(0, head.position.y, headR + 0.5);
  group.add(body, head, nose);
  if (hunter) {
    const gun = makeShotgun(0.85);
    gun.position.set(2.1, 7.2, 2.0);
    gun.rotation.set(0.12, 0.15, 0.35);
    group.add(gun);
  }
  group.userData.head = head;
  group.userData.body = body;
  return group;
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

function syncPerson(mesh: THREE.Group, entity: Entity, revealed: boolean, clock: number): void {
  const walking =
    !entity.downed &&
    (entity.state === "WANDER" || entity.state === "REACT" || (entity.state === "REGROUP" && !isHolding(entity)));
  const bounce = walking
    ? Math.abs(Math.sin((entity.walkTime / RHYTHM.walkBouncePeriod) * Math.PI * 2)) * RHYTHM.walkBounceAmp
    : 0;
  const stumble = entity.stumbleTtl > 0 ? Math.sin(clock * 18) * 0.18 : 0;
  mesh.position.set(entity.x, entity.z + bounce, entity.y);
  mesh.rotation.x = entity.downed ? Math.PI / 2 : 0;
  mesh.rotation.y = Math.atan2(Math.cos(entity.angle), Math.sin(entity.angle));
  mesh.rotation.z = stumble;
  const body = mesh.userData.body as THREE.Mesh;
  const mat = body.material as THREE.MeshLambertMaterial;
  mat.emissive.setHex(revealed ? 0x661111 : 0x000000);
}

function syncHunter(mesh: THREE.Group, hunter: Hunter): void {
  const walking = hunter.state === "WANDER";
  const bounce = walking
    ? Math.abs(Math.sin((hunter.walkTime / RHYTHM.walkBouncePeriod) * Math.PI * 2)) * RHYTHM.walkBounceAmp
    : 0;
  mesh.position.set(hunter.x, hunter.z + bounce, hunter.y);
  mesh.rotation.y = Math.atan2(Math.cos(hunter.angle), Math.sin(hunter.angle));
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
  };
}

function must(selector: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(selector);
  if (!el) {
    throw new Error(`No se encontró ${selector}`);
  }
  return el;
}

function updateHud(hud: Hud, state: GameState, opts: ViewOpts, activeHunter: Hunter): void {
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
    hud.hpWrap.classList.remove("hidden");
    const hpRatio = activeHunter.hp / ROUND.hunterHp;
    hud.hpFill.style.width = `${Math.max(0, Math.min(100, hpRatio * 100))}%`;
    hud.hpFill.classList.toggle("mid", hpRatio <= 0.5 && hpRatio > 0.25);
    hud.hpFill.classList.toggle("low", hpRatio <= 0.25);
    hud.hint.textContent = "Clic: disparar · Espacio: menú";
    hud.mission.classList.add("hidden");
    hud.lockTitle.textContent = "Sos el cazador";
    hud.lockBody.textContent =
      "Pocos cartuchos. Pegarle a un boli te cuesta sangre. Observá quién se mueve distinto.";
  } else {
    hud.mode.textContent = opts.boliMode ? "Modo boli ON" : "Shift: modo boli";
    hud.mode.classList.toggle("on", opts.boliMode);
    hud.hpWrap.classList.add("hidden");
    hud.hint.textContent = "Shift: modo boli · Espacio: menú";
    hud.mission.classList.remove("hidden");
    hud.mission.textContent = `Misión ${mission.done}/${mission.total}: ${mission.next}`;
    hud.lockTitle.textContent = "Hacete el boli";
    hud.lockBody.textContent =
      "Mezclate con la manada y cumplí la misión, o sobreviví hasta que se acabe el tiempo. Quedarte solo te delata.";
  }
  hud.crosshair.classList.toggle("hidden", !opts.pointerLocked);
  hud.lock.classList.toggle("hidden", opts.pointerLocked || state.phase !== "PLAYING");

  if (state.phase === "PLAYING") {
    hud.end.classList.add("hidden");
    return;
  }
  hud.end.classList.remove("hidden");
  hud.endTitle.textContent = endTitle(state);
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
