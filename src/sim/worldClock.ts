import { ROUND } from "./types";

/** 00:00–06:00 of world time maps onto one round. */
export const DAY_MINUTES = 24 * 60;
export const DAWN_MINUTES = 6 * 60;
export const DUSK_MINUTES = 18 * 60;

export function wrapMinute(minute: number): number {
  return ((minute % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
}

export function worldHour(minute: number): number {
  return wrapMinute(minute) / 60;
}

export function worldMinuteFromTimeLeft(timeLeft: number): number {
  const elapsed = 1 - Math.max(0, Math.min(1, timeLeft / ROUND.duration));
  return elapsed * DAWN_MINUTES;
}

export function timeLeftFromWorldMinute(minute: number): number {
  const m = wrapMinute(minute);
  if (m <= DAWN_MINUTES) {
    return ROUND.duration * (1 - m / DAWN_MINUTES);
  }
  if (m < DUSK_MINUTES) {
    return 0;
  }
  return ROUND.duration * ((m - DUSK_MINUTES) / DAWN_MINUTES);
}

/** Round seconds → world minutes (6h of clock in ROUND.duration). */
export const WORLD_MINUTES_PER_SECOND = DAWN_MINUTES / ROUND.duration;
