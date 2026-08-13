import { setDebugClockHook } from "../sim/debugClock";
import { type GameState } from "../sim/types";
import {
  DAWN_MINUTES,
  timeLeftFromWorldMinute,
  worldMinuteFromTimeLeft,
  wrapMinute,
} from "../sim/worldClock";
import { isDebugHost } from "./enabled";

/**
 * Flip to `false` to hide the console even on localhost.
 * On a production host this module never installs UI or key listeners.
 */
export const DEBUG_TIME_CONSOLE = true;

const TOGGLE_CODES = new Set(["F2", "F8", "Backquote"]);

type ConsoleOpts = {
  getState: () => GameState | null;
  onOpen: () => void;
  onClose: () => void;
};

const clock = {
  paused: false,
  speed: 1,
  holdWin: false,
};

export function installTimeConsole(opts: ConsoleOpts): void {
  if (!DEBUG_TIME_CONSOLE || !isDebugHost()) {
    return;
  }
  if (document.getElementById("dbg-time")) {
    return;
  }

  setDebugClockHook({
    tickDelta(dt) {
      if (clock.paused) {
        return 0;
      }
      return dt * clock.speed;
    },
    allowTimerWin() {
      return !clock.paused && !clock.holdWin;
    },
  });

  injectStyles();

  const tab = document.createElement("button");
  tab.id = "dbg-time-tab";
  tab.type = "button";
  tab.textContent = "F2 DEBUG TIME";
  tab.title = "Abrir consola de tiempo (F2, F8 o `)";

  const root = document.createElement("div");
  root.id = "dbg-time";
  root.setAttribute("data-open", "false");
  root.innerHTML = `
    <div class="dbg-banner">DEBUG TIME CONSOLE</div>
    <div class="dbg-time-line">TIME: --:--</div>
    <div class="dbg-status"></div>
    <pre class="dbg-log"></pre>
    <form class="dbg-form" autocomplete="off">
      <label class="dbg-prompt" for="dbg-time-input">&gt;</label>
      <input id="dbg-time-input" class="dbg-input" type="text" spellcheck="false" placeholder="time +1" />
    </form>
    <div class="dbg-hint">F2 / F8 / \` abre y cierra · Esc cierra · solo localhost</div>
  `;

  document.body.appendChild(tab);
  document.body.appendChild(root);

  const timeEl = root.querySelector<HTMLElement>(".dbg-time-line")!;
  const statusEl = root.querySelector<HTMLElement>(".dbg-status")!;
  const logEl = root.querySelector<HTMLElement>(".dbg-log")!;
  const form = root.querySelector<HTMLFormElement>(".dbg-form")!;
  const input = root.querySelector<HTMLInputElement>(".dbg-input")!;
  const lines: string[] = [];
  let open = false;
  let raf = 0;

  const log = (message: string) => {
    lines.push(message);
    if (lines.length > 12) {
      lines.shift();
    }
    logEl.textContent = lines.join("\n");
    logEl.scrollTop = logEl.scrollHeight;
  };

  const refreshStatus = () => {
    const state = opts.getState();
    if (!state) {
      timeEl.textContent = "TIME: --:--";
      statusEl.textContent = "sin partida  ·  pause=" + String(clock.paused) + "  ·  speed=" + String(clock.speed);
      return;
    }
    timeEl.textContent = "TIME: " + formatClock(currentMinute(state));
    statusEl.textContent =
      "queda " +
      formatRemain(state.timeLeft) +
      "  ·  timeLeft=" +
      state.timeLeft.toFixed(1) +
      "s  ·  pause=" +
      String(clock.paused) +
      "  ·  speed=" +
      String(clock.speed) +
      "x";
  };

  const setOpen = (next: boolean) => {
    if (open === next) {
      return;
    }
    open = next;
    root.setAttribute("data-open", next ? "true" : "false");
    tab.setAttribute("data-open", next ? "true" : "false");
    tab.textContent = next ? "F2 DEBUG TIME · ON" : "F2 DEBUG TIME";
    cancelAnimationFrame(raf);
    if (next) {
      opts.onOpen();
      refreshStatus();
      const tick = () => {
        refreshStatus();
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      input.value = "";
      window.setTimeout(() => input.focus(), 0);
    } else {
      input.blur();
      opts.onClose();
    }
  };

  const toggle = () => setOpen(!open);

  tab.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    toggle();
  });

  const onKey = (event: KeyboardEvent) => {
    if (event.repeat) {
      return;
    }
    const isToggle =
      TOGGLE_CODES.has(event.code) || event.key === "F2" || event.key === "F8" || event.key === "`";
    if (isToggle) {
      event.preventDefault();
      event.stopImmediatePropagation();
      toggle();
      return;
    }
    if (open && event.code === "Escape") {
      event.preventDefault();
      event.stopImmediatePropagation();
      setOpen(false);
    }
  };

  window.addEventListener("keydown", onKey, true);
  document.addEventListener("keydown", onKey, true);

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const raw = input.value.trim();
    if (!raw) {
      return;
    }
    input.value = "";
    log("> " + raw);
    log(runCommand(raw, opts.getState()));
    refreshStatus();
  });

  log("Lista para comandos.");
  log("Ejemplos: time +1  ·  time set 06:00  ·  time pause");
  refreshStatus();
  console.info("[Boli] Debug time console lista. F2 / F8 / ` o el botón naranja.");
}

function runCommand(raw: string, state: GameState | null): string {
  const cmd = raw.trim().replace(/\s+/g, " ");
  const lower = cmd.toLowerCase();

  if (lower === "help" || lower === "time help") {
    return [
      "time +1 / -1 / +10 / -10",
      "time set HH:MM   (00:00 noche · 06:00 amanecer · 12:00 mediodía · 18:00 noche)",
      "time pause | resume",
      "time speed <n>",
    ].join("\n");
  }

  if (lower === "time pause") {
    clock.paused = true;
    return "Time paused";
  }

  if (lower === "time resume") {
    clock.paused = false;
    return "Time resumed (speed " + String(clock.speed) + "x)";
  }

  const speed = /^time speed (\d+(?:\.\d+)?)$/i.exec(cmd);
  if (speed) {
    const value = Number(speed[1]);
    if (!(value > 0) || value > 100) {
      return "speed debe estar entre 0 (excluido) y 100";
    }
    clock.speed = value;
    clock.paused = false;
    return "Time speed set to " + String(value) + "x";
  }

  if (lower === "time") {
    if (!state) {
      return "no hay partida";
    }
    return statusLine(state);
  }

  const delta = /^time ([+-]\d+(?:\.\d+)?)$/i.exec(cmd);
  if (delta) {
    if (!state) {
      return "no hay partida — el cielo usa state.timeLeft";
    }
    const minutes = Number(delta[1]);
    const result = applyWorldMinute(state, currentMinute(state) + minutes);
    if (minutes > 0) {
      return "Time advanced by " + formatDelta(minutes) + "\n" + result;
    }
    return "Time rewound by " + formatDelta(-minutes) + "\n" + result;
  }

  const set = /^time set (\d{1,2}):(\d{2})$/i.exec(cmd);
  if (set) {
    if (!state) {
      return "no hay partida — el cielo usa state.timeLeft";
    }
    const hours = Number(set[1]);
    const minutes = Number(set[2]);
    if (hours > 23 || minutes > 59) {
      return "hora inválida (usa HH:MM)";
    }
    const result = applyWorldMinute(state, hours * 60 + minutes);
    return "Time set to " + pad(hours) + ":" + pad(minutes) + "\n" + result;
  }

  return "comando desconocido — help";
}

function currentMinute(state: GameState): number {
  return state.worldMinute ?? worldMinuteFromTimeLeft(state.timeLeft);
}

function applyWorldMinute(state: GameState, next: number): string {
  const minute = wrapMinute(next);
  state.worldMinute = minute;
  state.timeLeft = timeLeftFromWorldMinute(minute);
  if (state.timeLeft <= 0 || minute >= DAWN_MINUTES) {
    clock.holdWin = true;
    clock.paused = true;
  } else {
    clock.holdWin = false;
  }
  return "TIME: " + formatClock(minute);
}

function statusLine(state: GameState): string {
  return (
    "TIME: " +
    formatClock(currentMinute(state)) +
    "  ·  pause=" +
    String(clock.paused) +
    "  ·  speed=" +
    String(clock.speed) +
    "x"
  );
}

function formatDelta(minutes: number): string {
  return minutes === 1 ? "1 minute" : String(minutes) + " minutes";
}

function formatClock(totalMinutes: number): string {
  const mins = Math.max(0, Math.round(totalMinutes));
  return pad(Math.floor(mins / 60)) + ":" + pad(mins % 60);
}

function formatRemain(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return pad(Math.floor(s / 60)) + ":" + pad(s % 60);
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function injectStyles(): void {
  if (document.getElementById("dbg-time-css")) {
    return;
  }
  const style = document.createElement("style");
  style.id = "dbg-time-css";
  style.textContent = `
    #dbg-time-tab,
    #dbg-time {
      position: fixed;
      left: 16px;
      z-index: 2147483647;
      font-family: ui-monospace, "Cascadia Mono", Consolas, monospace;
      pointer-events: auto;
    }
    #dbg-time-tab {
      bottom: 16px;
      border: 2px solid #ffe08a;
      background: #c45c4a;
      color: #1a0c0a;
      font-size: 13px;
      font-weight: 800;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      padding: 8px 12px;
      cursor: pointer;
      box-shadow: 0 0 0 3px rgba(0, 0, 0, 0.55), 0 10px 28px rgba(0, 0, 0, 0.45);
    }
    #dbg-time-tab[data-open="true"] {
      display: none;
    }
    #dbg-time {
      display: none;
      bottom: 16px;
      width: min(460px, calc(100vw - 32px));
      color: #fff6d8;
      background: rgba(8, 10, 14, 0.94);
      border: 2px solid #ffe08a;
      box-shadow: 0 0 0 3px rgba(0, 0, 0, 0.55), 0 16px 40px rgba(0, 0, 0, 0.5);
    }
    #dbg-time[data-open="true"] {
      display: block;
    }
    #dbg-time .dbg-banner {
      background: #c45c4a;
      color: #1a0c0a;
      font-weight: 800;
      letter-spacing: 0.08em;
      padding: 10px 12px;
      text-transform: uppercase;
    }
    #dbg-time .dbg-time-line {
      padding: 10px 12px 0;
      color: #ffe08a;
      font-size: 22px;
      font-weight: 800;
    }
    #dbg-time .dbg-status {
      padding: 4px 12px 0;
      color: #9ee7b0;
      font-size: 12px;
    }
    #dbg-time .dbg-log {
      margin: 8px 0 0;
      padding: 0 12px;
      min-height: 5.5em;
      max-height: 12em;
      overflow: auto;
      white-space: pre-wrap;
      color: #e8e0cc;
      font-size: 13px;
    }
    #dbg-time .dbg-form {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 12px 8px;
    }
    #dbg-time .dbg-prompt {
      color: #ffe08a;
      font-size: 18px;
      font-weight: 800;
    }
    #dbg-time .dbg-input {
      flex: 1;
      border: 1px solid #ffe08a;
      outline: none;
      background: #161a20;
      color: #fff6d8;
      font: inherit;
      font-size: 14px;
      padding: 8px 10px;
    }
    #dbg-time .dbg-hint {
      padding: 0 12px 10px;
      color: #b7b09e;
      font-size: 11px;
    }
  `;
  document.head.appendChild(style);
}
