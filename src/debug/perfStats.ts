export type PerfSnapshot = {
  fps: number;
  ms: number;
  draws: number;
  tris: number;
  points: number;
  lines: number;
  geometries: number;
  textures: number;
  heap: string;
};

let emaMs = 16.6;
let last = 0;

export function samplePerf(
  dtMs: number,
  info: {
    render: { calls: number; triangles: number; points: number; lines: number };
    memory: { geometries: number; textures: number };
  },
): PerfSnapshot {
  emaMs = emaMs * 0.85 + dtMs * 0.15;
  const mem = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
  return {
    fps: Math.round(1000 / Math.max(0.1, emaMs)),
    ms: Math.round(emaMs * 10) / 10,
    draws: info.render.calls,
    tris: info.render.triangles,
    points: info.render.points,
    lines: info.render.lines,
    geometries: info.memory.geometries,
    textures: info.memory.textures,
    heap: mem ? `${Math.round(mem.usedJSHeapSize / 1048576)} MB` : "NO MEDIBLE",
  };
}

export function resetPerfClock(): void {
  last = 0;
  emaMs = 16.6;
}

export function markFrameNow(): number {
  const now = performance.now();
  const dt = last ? now - last : 16.6;
  last = now;
  return dt;
}
