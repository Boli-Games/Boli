import { getPlatform, usesTouchInput, type Platform } from "./platform";

export type QualityTier = "desktop" | "mobile" | "mobile-low";

export type QualitySettings = {
  tier: QualityTier;
  pixelRatio: number;
  resolutionScale: number;
  antialias: boolean;
  shadows: boolean;
  shadowMapSize: number;
  grassLodScale: number;
  farForestSkip: number;
  forestProps: boolean;
  starDensity: number;
  skySegments: number;
};

type NavHints = Navigator & { deviceMemory?: number };

let cached: QualitySettings | null = null;

function desktopQuality(): QualitySettings {
  return {
    tier: "desktop",
    pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
    resolutionScale: 1,
    antialias: true,
    shadows: true,
    shadowMapSize: 2048,
    grassLodScale: 1,
    farForestSkip: 0,
    forestProps: true,
    starDensity: 1,
    skySegments: 32,
  };
}

function mobileQuality(low: boolean): QualitySettings {
  const dpr = window.devicePixelRatio || 1;
  if (low) {
    return {
      tier: "mobile-low",
      pixelRatio: 1,
      resolutionScale: 0.72,
      antialias: false,
      shadows: false,
      shadowMapSize: 512,
      grassLodScale: 0.42,
      farForestSkip: 0.65,
      forestProps: false,
      starDensity: 0.2,
      skySegments: 16,
    };
  }
  return {
    tier: "mobile",
    pixelRatio: Math.min(dpr, 1.25),
    resolutionScale: 0.85,
    antialias: false,
    shadows: true,
    shadowMapSize: 1024,
    grassLodScale: 0.58,
    farForestSkip: 0.4,
    forestProps: true,
    starDensity: 0.4,
    skySegments: 20,
  };
}

function isLowDevice(platform: Platform): boolean {
  if (platform.input !== "touch") {
    return false;
  }
  const nav = navigator as NavHints;
  const mem = nav.deviceMemory;
  const cores = navigator.hardwareConcurrency || 0;
  const minSide = Math.min(window.innerWidth || 1, window.innerHeight || 1);
  if (typeof mem === "number" && mem <= 4) {
    return true;
  }
  if (cores > 0 && cores <= 4 && (typeof mem !== "number" || mem <= 4)) {
    return true;
  }
  return minSide < 360;
}

function resolveQuality(): QualitySettings {
  const platform = getPlatform();
  if (!usesTouchInput() && platform.form === "desktop") {
    return desktopQuality();
  }
  if (platform.input !== "touch") {
    return desktopQuality();
  }
  return mobileQuality(isLowDevice(platform));
}

export function getQuality(): QualitySettings {
  if (!cached) {
    cached = resolveQuality();
  }
  return cached;
}

export function refreshQuality(): QualitySettings {
  cached = resolveQuality();
  return cached;
}
