/**
 * Optional hook so the DEV time console can pause / scale `timeLeft`
 * without forking the day/night cycle. Production never registers a hook,
 * so `tickGame` keeps the same countdown as before.
 */
export type DebugClockHook = {
  tickDelta: (dt: number) => number;
  allowTimerWin: () => boolean;
};

let hook: DebugClockHook | null = null;

export function setDebugClockHook(next: DebugClockHook | null): void {
  hook = next;
}

export function clockTickDelta(dt: number): number {
  return hook ? hook.tickDelta(dt) : dt;
}

export function clockAllowsTimerWin(): boolean {
  return hook ? hook.allowTimerWin() : true;
}
