import {
  getProfile,
  initAuth,
  onProfileChange,
  setProfile,
} from "./auth";
import { createInput } from "./input";
import { bindMenu, roomCodeFromUrl } from "./menu";
import { connectRoom, type RoomClient } from "./net/room";
import { randomRoomCode, type NetInput, type ServerMsg, emptyInput } from "./net/protocol";
import { applyRoundRewards, sensitivityToSlider, sliderToSensitivity } from "./profile";
import {
  applySnapshot,
  createGame,
  fireAtEntity,
  hunterForController,
  playerEntity,
  snapshotOf,
  tickGame,
  tickLocalPrediction,
} from "./sim/game";
import { shortestAngleDiff } from "./sim/physics";
import { mulberry32 } from "./sim/rng";
import { ROUND, VIEW, type ControlRole, type GameState } from "./sim/types";
import { createView } from "./view";

const FIXED_DT = 1 / 60;
const MAX_FRAME = 0.05;
const MAX_HIDDEN_FRAME = 0.2;
const SNAP_EVERY = 2;

const canvasEl = document.querySelector<HTMLCanvasElement>("#game");
const hudEl = document.querySelector<HTMLElement>("#hud");
const pauseEl = document.querySelector<HTMLElement>("#pause");
const hurtEl = document.querySelector<HTMLElement>("#hurt");
const wayEl = document.querySelector<HTMLElement>("#way");
const sensEl = document.querySelector<HTMLInputElement>("#sens");
if (!canvasEl || !hudEl || !pauseEl || !hurtEl || !wayEl || !sensEl) {
  throw new Error("No se encontró el canvas o el HUD");
}
const canvas: HTMLCanvasElement = canvasEl;
const hud: HTMLElement = hudEl;
const pause: HTMLElement = pauseEl;
const hurt: HTMLElement = hurtEl;
const way: HTMLElement = wayEl;
const sens: HTMLInputElement = sensEl;

const input = createInput(canvas);
const view = createView(canvas);
window.addEventListener("resize", () => view.resize());
view.resize();

type OnlineSession = {
  room: RoomClient;
  code: string;
  localId: string;
  hostId: string;
  isHost: boolean;
  hunterId: string;
  hiderIds: string[];
  remotes: Map<string, NetInput>;
  shotsSeen: Map<string, number>;
  pendingShots: { id: string; targetId: string | null }[];
  snapAcc: number;
};

let mode: "menu" | "online" = "menu";
let state: GameState | null = null;
let online: OnlineSession | null = null;
let role: ControlRole = "INFILTRATOR";
let hunterIndex = 0;
let infiltratorYaw = 0;
let infiltratorPitch = 0;
let hunterYaw = 0;
let hunterPitch = 0;
let acc = 0;
let last = performance.now();
let lastSim = performance.now();
let assigned = false;
let paused = false;
let rewarded = false;
let startedAsHunter = false;
let localShotSeq = 0;
let shotEcho = 0;
let shotTargetId: string | null = null;
let pauseFromEscape = false;
let latestNet: NetInput = emptyInput();

const menu = bindMenu({
  onCreate: () => joinRoom(randomRoomCode(), true),
  onJoin: (code) => joinRoom(code, false),
  onStart: () => online?.room.send({ t: "start" }),
  onLeave: () => backToMenu(),
});

onProfileChange(() => menu.refreshProfile());

document.addEventListener("keydown", (event) => {
  if (event.code === "Escape") {
    pauseFromEscape = true;
  }
});

document.addEventListener("pointerlockchange", () => {
  if (document.pointerLockElement === canvas) {
    pauseFromEscape = false;
    return;
  }
  if (pauseFromEscape && mode === "online" && state?.phase === "PLAYING" && !paused) {
    pauseFromEscape = false;
    setPaused(true);
  }
});

must("#btnResume").addEventListener("click", () => setPaused(false));
must("#btnQuit").addEventListener("click", () => backToMenu());
sens.addEventListener("input", () => {
  const profile = getProfile();
  setProfile({ ...profile, lookSensitivity: sliderToSensitivity(Number(sens.value)) });
});

function joinRoom(code: string, created: boolean): void {
  teardownOnline();
  const name = getProfile().displayName || (created ? "Anfitrión" : "Jugador");
  const room = connectRoom({
    code,
    name,
    onMessage: (msg) => handleNet(msg),
    onClose: () => {
      if (mode === "online") {
        backToMenu("Se cerró la sala.");
        return;
      }
      if (online) {
        backToMenu("No se pudo conectar al servidor de salas.");
      }
    },
  });
  online = {
    room,
    code,
    localId: "",
    hostId: "",
    isHost: created,
    hunterId: "",
    hiderIds: [],
    remotes: new Map(),
    shotsSeen: new Map(),
    pendingShots: [],
    snapAcc: 0,
  };
  mode = "menu";
  history.replaceState(null, "", `?room=${code}`);
  menu.showLobby({
    code,
    isHost: created,
    hostId: "",
    members: [],
    you: "",
  });
}

function handleNet(msg: ServerMsg): void {
  if (!online) {
    return;
  }
  if (msg.t === "error") {
    backToMenu(msg.message);
    return;
  }
  if (msg.t === "closed") {
    backToMenu(msg.reason);
    return;
  }
  if (msg.t === "welcome") {
    online.localId = msg.you;
    online.hostId = msg.hostId;
    online.isHost = msg.you === msg.hostId;
    menu.showLobby({
      code: online.code,
      isHost: online.isHost,
      hostId: msg.hostId,
      members: msg.members,
      you: msg.you,
    });
    return;
  }
  if (msg.t === "lobby") {
    online.hostId = msg.hostId;
    online.isHost = online.localId === msg.hostId;
    menu.showLobby({
      code: online.code,
      isHost: online.isHost,
      hostId: msg.hostId,
      members: msg.members,
      you: online.localId,
    });
    return;
  }
  if (msg.t === "start") {
    const rng = mulberry32(msg.seed);
    state = createGame({ hiderIds: msg.hiderIds, hunterId: msg.hunterId, rng });
    view.rebuild(state);
    online.hunterId = msg.hunterId;
    online.hiderIds = msg.hiderIds;
    online.remotes.clear();
    online.shotsSeen.clear();
    online.pendingShots.length = 0;
    online.snapAcc = 0;
    mode = "online";
    assigned = true;
    rewarded = false;
    syncRoleFromState(true);
    startedAsHunter = role === "HUNTER";
    localShotSeq = 0;
    shotEcho = 0;
    shotTargetId = null;
    latestNet = emptyInput();
    last = performance.now();
    lastSim = last;
    acc = 0;
    enterPlay();
    return;
  }
  if (msg.t === "input" && online.isHost) {
    if (msg.input.shoot || msg.input.shotSeq > 0) {
      const seen = online.shotsSeen.get(msg.from) ?? 0;
      if (msg.input.shotSeq > seen) {
        online.shotsSeen.set(msg.from, msg.input.shotSeq);
        online.pendingShots.push({ id: msg.from, targetId: msg.input.targetId });
      }
    }
    online.remotes.set(msg.from, { ...msg.input, shoot: false });
    if (document.hidden) {
      stepHost(performance.now());
    }
    return;
  }
  if (msg.t === "snapshot" && state && !online.isHost) {
    applySnapshot(state, msg.snap, online.localId);
    syncRoleFromState(false);
    maybeReward();
  }
}

function syncRoleFromState(forceLook: boolean): void {
  if (!state || !online) {
    return;
  }
  const found = hunterForController(state, online.localId);
  if (found) {
    if (forceLook || role !== "HUNTER") {
      hunterYaw = found.hunter.angle;
      hunterPitch = found.hunter.pitch;
    }
    role = "HUNTER";
    hunterIndex = found.index;
    return;
  }
  const wasHunter = role === "HUNTER";
  const hider = playerEntity(state, online.localId);
  role = "INFILTRATOR";
  hunterIndex = 0;
  if (hider && (forceLook || wasHunter)) {
    infiltratorYaw = hider.angle;
    infiltratorPitch = 0;
  }
}

function enterPlay(): void {
  menu.hide();
  hud.classList.remove("hidden");
  setPaused(false);
  input.setEnabled(true);
}

function backToMenu(error = ""): void {
  document.exitPointerLock();
  setPaused(false);
  input.setEnabled(false);
  teardownOnline();
  state = null;
  mode = "menu";
  assigned = false;
  hud.classList.add("hidden");
  hurt.style.opacity = "0";
  way.classList.add("hidden");
  history.replaceState(null, "", window.location.pathname);
  menu.showHome(error);
}

function teardownOnline(): void {
  online?.room.close();
  online = null;
}

function setPaused(value: boolean): void {
  paused = value;
  pause.classList.toggle("hidden", !value);
  if (value) {
    document.exitPointerLock();
    input.setEnabled(false);
    sens.value = String(sensitivityToSlider(getProfile().lookSensitivity));
    return;
  }
  if (mode === "online" && state?.phase === "PLAYING") {
    input.setEnabled(true);
  }
}

function maybeReward(): void {
  if (!state || rewarded || state.phase === "PLAYING") {
    return;
  }
  rewarded = true;
  const next = applyRoundRewards(getProfile(), {
    startedAsHunter,
    hunterWin: state.phase === "HUNTER_WIN",
    missionWin: state.objectives.every((objective) => objective.done),
  });
  setProfile(next.profile);
}

function activeYaw(): number {
  return role === "HUNTER" ? hunterYaw : infiltratorYaw;
}

function activePitch(): number {
  return role === "HUNTER" ? hunterPitch : infiltratorPitch;
}

function activeHunter() {
  if (!state) {
    return null;
  }
  if (hunterIndex <= 0) {
    return state.hunter;
  }
  return state.extraHunters[hunterIndex - 1] ?? state.hunter;
}

function frame(now: number): void {
  const raw = Math.min((now - last) / 1000, MAX_FRAME);
  last = now;
  const frameInput = input.read();

  if (mode === "menu" || !state || !assigned) {
    requestAnimationFrame(frame);
    return;
  }

  const localId = online?.localId ?? "";

  if (frameInput.pause) {
    if (state.phase !== "PLAYING") {
      backToMenu();
      requestAnimationFrame(frame);
      return;
    }
    setPaused(!paused);
  }

  const wasLocked = frameInput.pointerLocked;
  if (frameInput.click && !wasLocked && !paused && state.phase === "PLAYING") {
    void canvas.requestPointerLock();
  }

  const boliMode = frameInput.boliMode;
  const look = getProfile().lookSensitivity;
  if (wasLocked && !paused) {
    if (role === "HUNTER") {
      hunterYaw += frameInput.mouseDx * look;
      hunterPitch -= frameInput.mouseDy * look;
      hunterPitch = Math.max(-1.15, Math.min(1.15, hunterPitch));
    } else if (!boliMode) {
      infiltratorYaw += frameInput.mouseDx * look;
      infiltratorPitch -= frameInput.mouseDy * look;
      infiltratorPitch = Math.max(-1.15, Math.min(1.15, infiltratorPitch));
    }
  }

  const shootPressed =
    role === "HUNTER" && frameInput.shootPresses > 0 && wasLocked && !paused && state.phase === "PLAYING";
  if (shootPressed) {
    const hunter = activeHunter();
    if (hunter && hunter.hp > 0 && state.accusationsLeft > 0) {
      const target = view.pickAimedEntity(state, hunter, hunterYaw, hunterPitch);
      shotTargetId = target?.id ?? null;
      localShotSeq += 1;
      shotEcho = 8;
      const range = ROUND.shotRange;
      const look = Math.cos(hunterPitch);
      const crouch = frameInput.crouch || hunter.crouch;
      const eye = hunter.z + (crouch ? VIEW.crouchEyeHeight : VIEW.eyeHeight);
      view.playShot({
        firstPerson: true,
        hit: Boolean(target),
        hitX: target ? target.x : hunter.x + Math.cos(hunterYaw) * look * range,
        hitY: target ? target.y : hunter.y + Math.sin(hunterYaw) * look * range,
        hitZ: target ? target.z + 8 : eye + Math.sin(hunterPitch) * range,
      });
      if (online?.isHost) {
        const seen = online.shotsSeen.get(localId) ?? 0;
        if (localShotSeq > seen) {
          online.shotsSeen.set(localId, localShotSeq);
          online.pendingShots.push({ id: localId, targetId: shotTargetId });
        }
      } else {
        state.shotKick = 1;
      }
    }
  }
  if (shotEcho > 0) {
    shotEcho -= 1;
  }

  latestNet = {
    forward: paused ? 0 : frameInput.forward,
    strafe: paused ? 0 : frameInput.strafe,
    yaw: role === "HUNTER" ? hunterYaw : infiltratorYaw,
    pitch: hunterPitch,
    boliMode: paused ? false : boliMode || role === "HUNTER",
    sprint: !paused && frameInput.sprint,
    crouch: !paused && frameInput.crouch && (role === "HUNTER" || !boliMode),
    shoot: shotEcho > 0,
    shotSeq: localShotSeq,
    targetId: shotTargetId,
  };

  if (online && !online.isHost) {
    online.room.send({ t: "input", input: latestNet });
  }

  if (online?.isHost) {
    stepHost(now);
  } else {
    acc += raw;
    while (acc >= FIXED_DT) {
      tickLocalPrediction(state, localId, latestNet, FIXED_DT);
      acc -= FIXED_DT;
    }
  }

  syncRoleFromState(false);

  const player = playerEntity(state, localId);
  if (player && (boliMode || role === "HUNTER")) {
    infiltratorYaw += shortestAngleDiff(infiltratorYaw, player.angle) * Math.min(1, raw * 6);
    infiltratorPitch += (0 - infiltratorPitch) * Math.min(1, raw * 5);
  }

  if (state.phase !== "PLAYING" && document.pointerLockElement === canvas) {
    document.exitPointerLock();
  }

  view.render(state, {
    role,
    yaw: activeYaw(),
    pitch: activePitch(),
    boliMode,
    crouch: latestNet.crouch,
    pointerLocked: wasLocked,
    localId,
    hunterIndex,
    online: true,
    hunterSkinId: getProfile().equippedSkin,
    paused,
  });
  requestAnimationFrame(frame);
}

function stepHost(now: number): void {
  if (!online?.isHost || !state || !assigned) {
    return;
  }
  const cap = document.hidden ? MAX_HIDDEN_FRAME : MAX_FRAME;
  const raw = Math.min(Math.max(0, (now - lastSim) / 1000), cap);
  lastSim = now;
  acc += raw;
  const localId = online.localId;
  const local = document.hidden
    ? { ...latestNet, forward: 0, strafe: 0, sprint: false, shoot: false }
    : latestNet;
  let steps = 0;
  while (acc >= FIXED_DT && steps < 12) {
    tickGame(state, packInputs(local, localId), FIXED_DT);
    const fired = resolveShots();
    acc -= FIXED_DT;
    steps += 1;
    online.snapAcc += 1;
    if (fired || online.snapAcc >= SNAP_EVERY) {
      online.snapAcc = 0;
      online.room.send({ t: "snapshot", snap: snapshotOf(state) });
    }
  }
  maybeReward();
}

function packInputs(local: NetInput, localId: string) {
  const infiltrators: Record<string, NetInput> = {};
  const hunters: Record<string, NetInput> = {};
  const add = (id: string, net: NetInput) => {
    if (hunterForController(state!, id)) {
      hunters[id] = net;
    } else {
      infiltrators[id] = net;
    }
  };
  add(localId, local);
  if (online?.isHost) {
    for (const [id, net] of online.remotes) {
      add(id, net);
    }
  }
  return { infiltrators, hunters };
}

function resolveShots(): boolean {
  if (!state || !online) {
    return false;
  }
  const shots = online.pendingShots.splice(0);
  if (shots.length === 0) {
    return false;
  }
  for (const shot of shots) {
    const found = hunterForController(state, shot.id);
    const hunter = found?.hunter;
    if (!hunter) {
      continue;
    }
    const target = shot.targetId ? (state.entities.find((entity) => entity.id === shot.targetId) ?? null) : null;
    fireAtEntity(state, target, hunter);
  }
  return true;
}

function must(selector: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(selector);
  if (!el) {
    throw new Error(`No se encontró ${selector}`);
  }
  return el;
}

requestAnimationFrame(frame);
setInterval(() => {
  if (document.hidden && online?.isHost && state && assigned) {
    stepHost(performance.now());
  }
}, 33);

void initAuth().then(() => {
  menu.refreshProfile();
  const pendingRoom = roomCodeFromUrl();
  if (pendingRoom) {
    joinRoom(pendingRoom, false);
  }
});
