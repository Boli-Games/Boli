import {
  boliStuckInfo,
  debugForceBehaviorCheck,
  isStuckDebug,
  setStuckDebug,
} from "../sim/boliAi";
import { runStuckRecoveryTests } from "../sim/stuckRecoveryTest";
import { type BehaviorCheckKind, type GameState, RHYTHM } from "../sim/types";
import { isDebugHost } from "./enabled";

const STORAGE_KEY = "boli-debug-ai";

type DebugOpts = {
  getState: () => GameState | null;
};

let overlay: HTMLPreElement | null = null;
let raf = 0;
let installed: DebugOpts | null = null;

export function installAiDebug(opts: DebugOpts): void {
  if (!isDebugHost()) {
    return;
  }
  installed = opts;
  if (readStored()) {
    setStuckDebug(true);
    ensureOverlay(opts);
  }
}

export function handleAiCommand(raw: string, state: GameState | null): string | null {
  const cmd = raw.trim().replace(/\s+/g, " ").toLowerCase();
  if (!cmd.startsWith("ai ") && cmd !== "ai") {
    return null;
  }

  if (cmd === "ai" || cmd === "ai help") {
    return [
      "ai stuck          lista timers / dist / spd / toward / useful",
      "ai debug on|off   overlay + logs de recuperación (localhost)",
      "ai check house    fuerza el check de la casa chica",
      "ai check fountain | sit",
      "ai test           corre las pruebas de atasco en un mundo aislado",
    ].join("\n");
  }

  if (cmd === "ai debug on") {
    setStuckDebug(true);
    writeStored(true);
    if (installed) {
      ensureOverlay(installed);
    }
    return "ai debug ON — overlay y logs de recover. F2 → ai stuck";
  }

  if (cmd === "ai debug off") {
    setStuckDebug(false);
    writeStored(false);
    hideOverlay();
    return "ai debug OFF";
  }

  if (cmd === "ai stuck") {
    if (!state) {
      return "no hay partida";
    }
    return formatStuckDump(state);
  }

  const check = /^ai check (house|fountain|sit)$/.exec(cmd);
  if (check) {
    if (!state) {
      return "no hay partida";
    }
    debugForceBehaviorCheck(state, Math.random, check[1] as BehaviorCheckKind);
    return "check forzado: " + check[1];
  }

  if (cmd === "ai test") {
    return runStuckRecoveryTests().join("\n");
  }

  return "comando ai desconocido — ai help";
}

function ensureOverlay(opts: DebugOpts): void {
  if (!overlay) {
    overlay = document.createElement("pre");
    overlay.id = "dbg-ai-stuck";
    overlay.style.cssText = [
      "position:fixed",
      "right:16px",
      "top:16px",
      "z-index:2147483646",
      "margin:0",
      "max-width:min(420px,calc(100vw - 32px))",
      "max-height:min(46vh,420px)",
      "overflow:auto",
      "padding:10px 12px",
      "background:rgba(8,10,14,0.9)",
      "color:#fff6d8",
      "border:2px solid #ffe08a",
      "font:12px/1.35 ui-monospace,Consolas,monospace",
      "pointer-events:none",
      "white-space:pre",
    ].join(";");
    document.body.appendChild(overlay);
  }
  overlay.style.display = "block";
  cancelAnimationFrame(raf);
  const tick = () => {
    if (!overlay || !isStuckDebug()) {
      return;
    }
    const state = opts.getState();
    overlay.textContent = state ? formatStuckDump(state) : "ai debug — sin partida";
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
}

function hideOverlay(): void {
  cancelAnimationFrame(raf);
  raf = 0;
  if (overlay) {
    overlay.style.display = "none";
  }
}

function formatStuckDump(state: GameState): string {
  const rows = state.entities
    .filter((entity) => !entity.isPlayer && !entity.downed)
    .map((entity) => boliStuckInfo(entity, Boolean(state.behaviorCheck)))
    .sort((a, b) => b.stuckTimer - a.stuckTimer || b.recover - a.recover);
  const pressing = rows.filter((row) => row.stuckTimer > 0.4 || row.recover > 0).length;
  const lines = [
    "AI STUCK  ·  " + (isStuckDebug() ? "debug ON" : "debug off"),
    "útil = 0.55·hacia + 0.45·acercarse  ·  umbral " +
      (RHYTHM.speed * RHYTHM.stuckApproachRatio).toFixed(1) +
      " u/s  ·  stuck " +
      String(RHYTHM.stuckSeconds) +
      "s",
    "presionando " + String(pressing) + "/" + String(rows.length),
    "",
    "id     state    stuck  recov  dist  spd  exp  toward  useful  keep",
  ];
  for (const row of rows.slice(0, 16)) {
    lines.push(
      pad(row.id, 6) +
        " " +
        pad(row.state, 8) +
        " " +
        row.stuckTimer.toFixed(2).padStart(5) +
        " " +
        row.recover.toFixed(2).padStart(5) +
        " " +
        row.dist.toFixed(0).padStart(5) +
        " " +
        row.speed.toFixed(0).padStart(4) +
        " " +
        row.expected.toFixed(0).padStart(3) +
        " " +
        row.toward.toFixed(0).padStart(7) +
        " " +
        row.useful.toFixed(1).padStart(6) +
        "  " +
        (row.keepGoal ? "sí" : "no"),
    );
  }
  if (state.behaviorCheck) {
    lines.push("", "check " + state.behaviorCheck.kind + " ttl=" + state.behaviorCheck.ttl.toFixed(1));
  }
  return lines.join("\n");
}

function pad(value: string, width: number): string {
  return value.length >= width ? value.slice(0, width) : value + " ".repeat(width - value.length);
}

function readStored(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeStored(on: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
}
