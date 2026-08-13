import { createInput } from "./input";
import { bindMenu, roomCodeFromUrl } from "./menu";
import { connectRoom, type RoomClient } from "./net/room";
import { randomRoomCode, type NetInput, type ServerMsg } from "./net/protocol";
import {
  applySnapshot,
  createGame,
  fireAtEntity,
  hunterForController,
  playerEntity,
  revealInfiltrator,
  snapshotOf,
  tickGame,
} from "./sim/game";
import { shortestAngleDiff } from "./sim/physics";
import { mulberry32 } from "./sim/rng";
import type { ControlRole, GameState } from "./sim/types";
import { VIEW } from "./sim/types";
import { createView } from "./view";

const FIXED_DT = 1 / 60;
const MAX_FRAME = 0.05;
const SNAP_EVERY = 4;

const canvasEl = document.querySelector<HTMLCanvasElement>("#game");
const hudEl = document.querySelector<HTMLElement>("#hud");
if (!canvasEl || !hudEl) {
  throw new Error("No se encontró el canvas o el HUD");
}
const canvas: HTMLCanvasElement = canvasEl;
const hud: HTMLElement = hudEl;

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
  snapAcc: number;
};

let mode: "menu" | "solo" | "online" = "menu";
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
let assigned = false;

const menu = bindMenu({
  onSolo: () => startSolo(),
  onCreate: () => joinRoom(randomRoomCode(), true),
  onJoin: (code) => joinRoom(code, false),
  onStart: () => online?.room.send({ t: "start" }),
  onLeave: () => backToMenu(),
});

function startSolo(): void {
  teardownOnline();
  state = createGame();
  view.rebuild(state);
  mode = "solo";
  role = "INFILTRATOR";
  hunterIndex = 0;
  infiltratorYaw = playerEntity(state)?.angle ?? 0;
  infiltratorPitch = 0;
  hunterYaw = state.hunter.angle;
  hunterPitch = 0;
  acc = 0;
  assigned = true;
  enterPlay();
}

function joinRoom(code: string, created: boolean): void {
  teardownOnline();
  const name = created ? "Anfitrión" : "Jugador";
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
    online.snapAcc = 0;
    mode = "online";
    assigned = true;
    syncRoleFromState(true);
    enterPlay();
    return;
  }
  if (msg.t === "input" && online.isHost) {
    online.remotes.set(msg.from, msg.input);
    return;
  }
  if (msg.t === "snapshot" && state && !online.isHost) {
    applySnapshot(state, msg.snap);
    syncRoleFromState(false);
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
  input.setEnabled(true);
}

function backToMenu(error = ""): void {
  document.exitPointerLock();
  input.setEnabled(false);
  teardownOnline();
  state = null;
  mode = "menu";
  assigned = false;
  hud.classList.add("hidden");
  history.replaceState(null, "", window.location.pathname);
  menu.showHome(error);
}

function teardownOnline(): void {
  online?.room.close();
  online = null;
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
  acc += raw;
  const frameInput = input.read();

  if (mode === "menu" || !state || !assigned) {
    requestAnimationFrame(frame);
    return;
  }

  const onlineMode = mode === "online";
  const localId = onlineMode && online ? online.localId : "local";

  if (frameInput.restart) {
    if (onlineMode) {
      backToMenu();
      requestAnimationFrame(frame);
      return;
    }
    startSolo();
  }
  if (!onlineMode && frameInput.reveal) {
    revealInfiltrator(state);
  }
  if (!onlineMode && state.promotedControllerId === "local") {
    role = "HUNTER";
    hunterIndex = 0;
    hunterYaw = state.hunter.angle;
    hunterPitch = state.hunter.pitch;
    state.promotedControllerId = null;
  }
  if (!onlineMode && frameInput.toggleView && (role === "INFILTRATOR" || playerEntity(state))) {
    role = role === "INFILTRATOR" ? "HUNTER" : "INFILTRATOR";
    hunterYaw = state.hunter.angle;
    hunterPitch = state.hunter.pitch;
    infiltratorYaw = playerEntity(state)?.angle ?? infiltratorYaw;
    hunterIndex = 0;
  }

  const wasLocked = frameInput.pointerLocked;
  if (frameInput.click && !wasLocked) {
    canvas.requestPointerLock();
  }

  const boliMode = frameInput.boliMode;
  if (wasLocked) {
    if (role === "HUNTER") {
      hunterYaw += frameInput.mouseDx * VIEW.lookSensitivity;
      hunterPitch -= frameInput.mouseDy * VIEW.lookSensitivity;
      hunterPitch = Math.max(-1.15, Math.min(1.15, hunterPitch));
    } else if (!boliMode) {
      infiltratorYaw += frameInput.mouseDx * VIEW.lookSensitivity;
      infiltratorPitch -= frameInput.mouseDy * VIEW.lookSensitivity;
      infiltratorPitch = Math.max(-1.15, Math.min(1.15, infiltratorPitch));
    }
  }

  let shoot = false;
  let targetId: string | null = null;
  if (role === "HUNTER" && frameInput.click && wasLocked) {
    const hunter = activeHunter();
    if (hunter) {
      const target = view.pickAimedEntity(state, hunter, hunterYaw, hunterPitch);
      targetId = target?.id ?? null;
      shoot = true;
    }
  }

  const net: NetInput = {
    forward: frameInput.forward,
    strafe: frameInput.strafe,
    yaw: role === "HUNTER" ? hunterYaw : infiltratorYaw,
    pitch: hunterPitch,
    boliMode: boliMode || role === "HUNTER",
    shoot,
    targetId,
  };

  if (onlineMode && online && !online.isHost) {
    online.room.send({ t: "input", input: net });
  }

  if (!onlineMode || online?.isHost) {
    while (acc >= FIXED_DT) {
      const pack = packInputs(net, localId);
      tickGame(state, pack, FIXED_DT);
      resolveShots(pack, localId, net);
      acc -= FIXED_DT;
      if (online?.isHost) {
        online.snapAcc += 1;
        if (online.snapAcc >= SNAP_EVERY) {
          online.snapAcc = 0;
          online.room.send({ t: "snapshot", snap: snapshotOf(state) });
        }
      }
    }
  } else {
    acc = 0;
  }

  if (onlineMode) {
    syncRoleFromState(false);
  }

  const player = playerEntity(state, localId);
  if (player && (boliMode || role === "HUNTER")) {
    infiltratorYaw += shortestAngleDiff(infiltratorYaw, player.angle) * Math.min(1, raw * 6);
    infiltratorPitch += (0 - infiltratorPitch) * Math.min(1, raw * 5);
  }
  if (!onlineMode && role === "INFILTRATOR") {
    hunterYaw = state.hunter.angle;
    hunterPitch = state.hunter.pitch;
  }

  if (state.phase !== "PLAYING") {
    document.exitPointerLock();
  }

  view.render(state, {
    role,
    yaw: activeYaw(),
    pitch: activePitch(),
    boliMode,
    pointerLocked: wasLocked,
    localId,
    hunterIndex,
    online: onlineMode,
  });
  requestAnimationFrame(frame);
}

function packInputs(local: NetInput, localId: string) {
  const infiltrators: Record<string, { forward: number; strafe: number; yaw: number; boliMode: boolean }> = {};
  const hunters: Record<string, { forward: number; strafe: number; yaw: number; pitch: number }> = {};
  const add = (id: string, net: NetInput) => {
    if (hunterForController(state!, id) || (id === "local" && role === "HUNTER")) {
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

function resolveShots(
  pack: ReturnType<typeof packInputs>,
  localId: string,
  local: NetInput,
): void {
  if (!state) {
    return;
  }
  const shots: { id: string; targetId: string | null }[] = [];
  if (local.shoot) {
    shots.push({ id: localId, targetId: local.targetId });
    local.shoot = false;
  }
  if (online?.isHost) {
    for (const [id, net] of online.remotes) {
      if (net.shoot) {
        shots.push({ id, targetId: net.targetId });
        net.shoot = false;
      }
    }
  }
  for (const shot of shots) {
    const found = hunterForController(state, shot.id);
    const hunter =
      found?.hunter ?? (shot.id === "local" && pack.hunters.local ? state.hunter : null);
    if (!hunter) {
      continue;
    }
    const target = shot.targetId ? (state.entities.find((entity) => entity.id === shot.targetId) ?? null) : null;
    fireAtEntity(state, target, hunter);
  }
}

requestAnimationFrame(frame);

const pendingRoom = roomCodeFromUrl();
if (pendingRoom) {
  joinRoom(pendingRoom, false);
}
