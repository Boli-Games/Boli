import { isDebugHost } from "./enabled";
import { markFrameNow, samplePerf, type PerfSnapshot } from "./perfStats";

let overlay: HTMLPreElement | null = null;
let visible = false;
let frame = 0;
let lastSnap: PerfSnapshot | null = null;

export function isPerfOverlayOn(): boolean {
  return visible;
}

export function setPerfOverlay(on: boolean): void {
  visible = on;
  if (!on) {
    overlay?.remove();
    overlay = null;
    return;
  }
  ensureOverlay();
}

export function togglePerfOverlay(): boolean {
  setPerfOverlay(!visible);
  return visible;
}

export function dumpPerf(): string {
  if (!lastSnap) {
    return "perf: todavía no hay muestra (entra a una partida y pulsá F3)";
  }
  const s = lastSnap;
  return `fps=${s.fps} ms=${s.ms} draws=${s.draws} tris=${s.tris} geo=${s.geometries} tex=${s.textures} heap=${s.heap}`;
}

export function tickPerfOverlay(renderer: { info: { render: { calls: number; triangles: number; points: number; lines: number }; memory: { geometries: number; textures: number } } }): void {
  if (!visible || !isDebugHost()) {
    return;
  }
  const dt = markFrameNow();
  frame += 1;
  if (frame % 8 !== 0) {
    return;
  }
  lastSnap = samplePerf(dt, renderer.info);
  ensureOverlay();
  if (!overlay || !lastSnap) {
    return;
  }
  const s = lastSnap;
  overlay.textContent =
    `FPS ${s.fps}   ${s.ms} ms\n` +
    `draws ${s.draws}   tris ${s.tris}\n` +
    `pts ${s.points}  lines ${s.lines}\n` +
    `geo ${s.geometries}  tex ${s.textures}\n` +
    `heap ${s.heap}`;
}

function ensureOverlay(): void {
  if (overlay || !isDebugHost()) {
    return;
  }
  overlay = document.createElement("pre");
  overlay.id = "dbg-perf";
  overlay.style.cssText =
    "position:fixed;top:12px;right:12px;z-index:80;margin:0;padding:10px 12px;" +
    "background:rgba(10,12,16,.78);color:#d8f0c8;font:12px/1.35 ui-monospace,monospace;" +
    "border:1px solid #3a5a32;border-radius:8px;pointer-events:none;white-space:pre;";
  document.body.appendChild(overlay);
}
