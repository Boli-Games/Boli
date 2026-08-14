import { ROUND } from "./types";

/** Round daylight: 12:00–18:00 maps onto one round. */
export const DAY_MINUTES = 24 * 60;
export const DAWN_MINUTES = 6 * 60;
export const DUSK_MINUTES = 18 * 60;
export const ROUND_START_MINUTE = 12 * 60;
export const ROUND_SPAN_MINUTES = 6 * 60;
export const ROUND_END_MINUTE = ROUND_START_MINUTE + ROUND_SPAN_MINUTES;

export function wrapMinute(minute: number): number {
  return ((minute % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
}

export function worldHour(minute: number): number {
  return wrapMinute(minute) / 60;
}

export function worldMinuteFromTimeLeft(timeLeft: number): number {
  const elapsed = 1 - Math.max(0, Math.min(1, timeLeft / ROUND.duration));
  return ROUND_START_MINUTE + elapsed * ROUND_SPAN_MINUTES;
}

export function timeLeftFromWorldMinute(minute: number): number {
  const m = wrapMinute(minute);
  if (m <= ROUND_START_MINUTE) {
    return ROUND.duration;
  }
  if (m >= ROUND_END_MINUTE) {
    return 0;
  }
  return ROUND.duration * (1 - (m - ROUND_START_MINUTE) / ROUND_SPAN_MINUTES);
}

/** Round seconds → world minutes (6h of clock in ROUND.duration). */
export const WORLD_MINUTES_PER_SECOND = ROUND_SPAN_MINUTES / ROUND.duration;
