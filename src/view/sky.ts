import * as THREE from "three";
import { worldHour, worldMinuteFromTimeLeft } from "../sim/worldClock";
import { getQuality } from "../quality";

/** Night holds for most of the round; dawn only arrives as the clock runs down. */
const DAWN_START = 0.02;

/**
 * Cartoon distance haze. The playable village stays clear; only far
 * scenery (distant forest / horizon backdrop) picks up atmosphere.
 * `near` — fade starts. Keep past combat and nearby NPCs.
 * `far` — distance where mix equals `strength`.
 * `strength` — 0–1 opacity at `far`. Below 1 so the village never whites out.
 */
const FOG = {
  nightNear: 185,
  nightFar: 820,
  nightStrength: 0.48,
  nightColor: 0x3a5278,
  dawnNear: 240,
  dawnFar: 880,
  dawnStrength: 0.4,
  dawnColor: 0xf0c8a8,
  dayNear: 280,
  dayFar: 940,
  dayStrength: 0.3,
  dayColor: 0xb0d0e4,
};

const NIGHT = {
  zenith: new THREE.Color(0x070b16),
  horizon: new THREE.Color(0x14182a),
  glow: new THREE.Color(0x1c2440),
  fog: new THREE.Color(FOG.nightColor),
  hemiSky: new THREE.Color(0x1a2744),
  hemiGround: new THREE.Color(0x090b10),
  moon: new THREE.Color(0xc5d2ee),
  sun: new THREE.Color(0x8aa0c8),
  fill: new THREE.Color(0x12161f),
  hemi: 0.42,
  moonLight: 0.5,
  sunLight: 0,
  fillLight: 0.1,
  stars: 1,
  moonAlpha: 1,
  sunAlpha: 0,
};

const DAWN = {
  zenith: new THREE.Color(0x24324c),
  horizon: new THREE.Color(0xe39a72),
  glow: new THREE.Color(0xffc196),
  fog: new THREE.Color(FOG.dawnColor),
  hemiSky: new THREE.Color(0xf0b894),
  hemiGround: new THREE.Color(0x3a241c),
  moon: new THREE.Color(0xf0e4d4),
  sun: new THREE.Color(0xffd7a8),
  fill: new THREE.Color(0x6a4a3a),
  hemi: 0.64,
  moonLight: 0.04,
  sunLight: 0.88,
  fillLight: 0.2,
  stars: 0,
  moonAlpha: 0.08,
  sunAlpha: 1,
};

/** Noon lighting. Cooler and clearer than DAWN — 12:00 must not read as sunrise. */
const DAY = {
  fog: new THREE.Color(FOG.dayColor),
  hemiSky: new THREE.Color(0x7eb8e8),
  hemiGround: new THREE.Color(0x4a5c38),
  moon: new THREE.Color(0xe8eef6),
  sun: new THREE.Color(0xfff1c4),
  fill: new THREE.Color(0x4d6270),
  hemi: 0.6,
  moonLight: 0,
  sunLight: 1.02,
  fillLight: 0.15,
  stars: 0,
};

/** Night sky + cloud stops (t = 0). Tweak these for the dark end of the blend. */
const NIGHT_SKY = {
  zenith: new THREE.Color(0x0a1438),
  mid: new THREE.Color(0x3a2468),
  lower: new THREE.Color(0x2a5a88),
  horizon: new THREE.Color(0x5a88a8),
  cloudShadow: new THREE.Color(0x4a3278),
  cloudMid: new THREE.Color(0x8f74c0),
  cloudRim: new THREE.Color(0xf2b8a4),
  cloudGreenShadow: new THREE.Color(0x1f3d36),
  cloudGreenMid: new THREE.Color(0x3d6b58),
  cloudGreenRim: new THREE.Color(0x7a9e78),
};

/**
 * Mid-dawn cloud accents (warm). Blended in while `t` rises, then out toward day white.
 * Peak mix is around CLOUD_WARM_PEAK (see mixSkyDomeColors).
 */
const DAWN_CLOUD = {
  cloudShadow: new THREE.Color(0x6a3a48),
  cloudMid: new THREE.Color(0xe09060),
  cloudRim: new THREE.Color(0xffc8a8),
  cloudGreenShadow: new THREE.Color(0x4a4038),
  cloudGreenMid: new THREE.Color(0xc89870),
  cloudGreenRim: new THREE.Color(0xf0d0b0),
};

/** Day sky + white clouds (t = 1, dawn finished). Cartoon celeste. */
const DAY_SKY = {
  zenith: new THREE.Color(0x3d9ee8),
  mid: new THREE.Color(0x62b4f0),
  lower: new THREE.Color(0x8ecaf5),
  horizon: new THREE.Color(0xb7dff8),
  cloudShadow: new THREE.Color(0xd6dbe6),
  cloudMid: new THREE.Color(0xf0f3f8),
  cloudRim: new THREE.Color(0xffffff),
  cloudGreenShadow: new THREE.Color(0xd8dde6),
  cloudGreenMid: new THREE.Color(0xeef1f6),
  cloudGreenRim: new THREE.Color(0xffffff),
};

/** Warm horizon wash strength vs day progress; peaks mid-dawn, fades for clear day. */
const DAWN_WARM_GLOW = new THREE.Color(0xffc196);
/** Progress `t` where warm cloud tint is strongest before fading to white. */
const CLOUD_WARM_PEAK = 0.38;

const _skyZenith = new THREE.Color();
const _skyMid = new THREE.Color();
const _skyLower = new THREE.Color();
const _skyHorizon = new THREE.Color();
const _cloudShadow = new THREE.Color();
const _cloudMid = new THREE.Color();
const _cloudRim = new THREE.Color();
const _cloudGreenShadow = new THREE.Color();
const _cloudGreenMid = new THREE.Color();
const _cloudGreenRim = new THREE.Color();
const _dawnGlow = new THREE.Color();

const MOON_POS = new THREE.Vector3(-260, 210, -380);
const MOON_DIR = MOON_POS.clone().normalize();
/** Cartoon moon disc scale. Was 26, then 42; +50% from the last size. */
const MOON_SIZE = 63;
const MOON_RAD = MOON_SIZE / MOON_POS.length();
/** Angular size of the doodle sun (disc + rays) on the dome. +50% from 0.092. */
const SUN_RAD = 0.138;
const SUNRISE_HOUR = DAWN_START * 6;
const SUNSET_HOUR = 18;
const NOON_HOUR = 12;
/** Golden hour begins here so 18:00 already reads as dusk, not noon. */
const DUSK_START_HOUR = 17;
/** Dusk lighting/body fade ends here — same window as `cycleAmount`. */
const DUSK_END_HOUR = 19.5;
const _sunDir = new THREE.Vector3();
const _moonDir = new THREE.Vector3();
const _sunLightPos = new THREE.Vector3();
const _shadowFocus = new THREE.Vector3();
/** Glow radius as a multiple of the moon body (~0.66 of the texture). */
const MOON_HALO_SCALE = 2.9;
/** 0–1 mix of the halo into the night sky. Less than the sun. */
const MOON_HALO_STRENGTH = 0.62;
/** Wide cartoon bloom around the sun disc. Strength was 0.92; −40%. */
const SUN_HALO_SCALE = 5.4;
const SUN_HALO_STRENGTH = 0.55;
/** Peak altitude as a fraction of 180°. 0.25 = 45°, 0.42 ≈ 76° (sun, unchanged). */
const SUN_PEAK_ELEV = 0.42;
const MOON_PEAK_ELEV = 0.25;
const STAR_SPIN = 0.00011;

const _fog = new THREE.Color();
const _hemiSky = new THREE.Color();
const _hemiGround = new THREE.Color();
const _moon = new THREE.Color();
const _sun = new THREE.Color();
const _fill = new THREE.Color();
let _hemi = NIGHT.hemi;
let _fillLight = NIGHT.fillLight;
let _sunLight = NIGHT.sunLight;
let _moonLight = NIGHT.moonLight;
let _stars = NIGHT.stars;
let _fogNear = FOG.nightNear;
let _fogFar = FOG.nightFar;
let _fogStrength = FOG.nightStrength;

export type SkyRig = {
  update: (timeLeft: number, worldMinute?: number) => void;
  atmosphere: { fog: THREE.Color; horizon: THREE.Color };
};

/**
 * Atmosphere only. Driven by `timeLeft`, never by round phase —
 * a hunter win at 8:00 keeps the night sky.
 */
export function createSky(scene: THREE.Scene, camera: THREE.Camera): SkyRig {
  const fog = new THREE.Fog(
    NIGHT.fog.clone(),
    FOG.nightNear,
    fogFarFor(FOG.nightNear, FOG.nightFar, FOG.nightStrength),
  );
  const background = NIGHT.fog.clone();
  scene.fog = fog;
  scene.background = background;

  const root = new THREE.Group();
  scene.add(root);

  const moonMap = new THREE.CanvasTexture(drawMoon());
  moonMap.colorSpace = THREE.SRGBColorSpace;
  moonMap.needsUpdate = true;
  const sunMap = new THREE.CanvasTexture(drawSun());
  sunMap.colorSpace = THREE.SRGBColorSpace;
  sunMap.needsUpdate = true;

  const segs = getQuality().skySegments;
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(820, segs, Math.max(12, Math.round(segs * 0.625))),
    makeSkyMaterial(moonMap, sunMap),
  );
  dome.geometry.scale(-1, 1, 1);
  dome.frustumCulled = false;
  dome.renderOrder = -100;
  root.add(dome);

  const starDensity = getQuality().starDensity;
  const starField = new THREE.Group();
  starField.add(makeStars(Math.max(40, Math.round(380 * starDensity)), 2.0, makeDotTexture()));
  starField.add(makeStars(Math.max(4, Math.round(12 * starDensity)), 7.5, makeSparkleTexture()));
  root.add(starField);

  const hemi = new THREE.HemisphereLight(NIGHT.hemiSky, NIGHT.hemiGround, NIGHT.hemi);
  scene.add(hemi);

  const moonLight = new THREE.DirectionalLight(NIGHT.moon, NIGHT.moonLight);
  moonLight.position.copy(MOON_POS);
  scene.add(moonLight);
  scene.add(moonLight.target);
  setupTreeShadows(moonLight);

  const sunLight = new THREE.DirectionalLight(DAWN.sun, NIGHT.sunLight);
  placeCelestial(0, _sunDir, _moonDir);
  sunLight.position.copy(_sunLightPos.copy(_sunDir).multiplyScalar(420));
  scene.add(sunLight);
  scene.add(sunLight.target);
  setupTreeShadows(sunLight);

  const fill = new THREE.AmbientLight(NIGHT.fill, NIGHT.fillLight);
  scene.add(fill);

  const uniforms = (dome.material as THREE.ShaderMaterial).uniforms;
  const started = performance.now();

  return {
    atmosphere: { fog: _fog, horizon: _skyHorizon },
    update(timeLeft: number, worldMinute?: number) {
      root.position.copy(camera.position);
      const minute = worldMinute ?? worldMinuteFromTimeLeft(timeLeft);
      const hour = worldHour(minute);
      const t = cycleAmount(hour);
      placeCelestial(hour, _sunDir, _moonDir);
      const elapsed = (performance.now() - started) * 0.001;
      mixLighting(t);
      mixSkyDomeColors(t);

      mixFogColor(t);
      background.copy(_fog);
      fog.color.copy(_fog);
      fog.near = _fogNear;
      fog.far = fogFarFor(_fogNear, _fogFar, _fogStrength);

      // Dome gradient + clouds follow the same `t` as lighting (time console / world clock).
      uniforms.zenith.value.copy(_skyZenith);
      uniforms.horizon.value.copy(_skyHorizon);
      uniforms.glow.value.copy(_dawnGlow);
      uniforms.nightZenith.value.copy(_skyZenith);
      uniforms.nightMid.value.copy(_skyMid);
      uniforms.nightLower.value.copy(_skyLower);
      uniforms.nightHorizon.value.copy(_skyHorizon);
      uniforms.cloudShadow.value.copy(_cloudShadow);
      uniforms.cloudMid.value.copy(_cloudMid);
      uniforms.cloudRim.value.copy(_cloudRim);
      uniforms.cloudGreenShadow.value.copy(_cloudGreenShadow);
      uniforms.cloudGreenMid.value.copy(_cloudGreenMid);
      uniforms.cloudGreenRim.value.copy(_cloudGreenRim);
      uniforms.dawn.value = t;
      uniforms.sunColor.value.copy(_sun);
      uniforms.sunDir.value.copy(_sunDir);
      uniforms.moonDir.value.copy(_moonDir);
      const bodies = celestialBodyAlpha(hour);
      uniforms.sunAlpha.value = bodies.sun;
      uniforms.moonAlpha.value = bodies.moon;
      uniforms.time.value = elapsed;

      hemi.color.copy(_hemiSky);
      hemi.groundColor.copy(_hemiGround);
      hemi.intensity = _hemi;

      moonLight.color.copy(_moon);
      moonLight.intensity = _moonLight * bodies.moon;
      aimTreeShadows(moonLight, camera.position, _moonDir);

      sunLight.color.copy(_sun);
      sunLight.intensity = _sunLight * bodies.sun;
      aimTreeShadows(sunLight, camera.position, _sunDir);

      const sunOwnsShadow = bodies.sun >= bodies.moon;
      if (getQuality().shadows) {
        sunLight.castShadow = sunOwnsShadow;
        moonLight.castShadow = !sunOwnsShadow;
      } else {
        sunLight.castShadow = false;
        moonLight.castShadow = false;
      }

      fill.color.copy(_fill);
      fill.intensity = _fillLight;

      starField.rotation.y = elapsed * STAR_SPIN;
      starField.rotation.z = elapsed * STAR_SPIN * 0.28;
      const starOpacity = _stars;
      starField.visible = starOpacity > 0.02;
      starField.traverse((child) => {
        const mat = (child as THREE.Points).material;
        if (mat && (mat as THREE.PointsMaterial).isPointsMaterial) {
          (mat as THREE.PointsMaterial).opacity = starOpacity;
        }
      });
    },
  };
}

/** 0 = night, 1 = day. Driven only by world hour. */
export function skyAmount(timeLeft: number): number {
  return cycleAmount(worldHour(worldMinuteFromTimeLeft(timeLeft)));
}

/** Same 0–1 day blend as sky lighting, from a world hour (0–24). */
export function dayAmountFromHour(hour: number): number {
  return cycleAmount(hour);
}

/**
 * Lighting / sky blend (0 night → 1 day). Same `t` for dome, fog, hemi, fill.
 * Sun/moon key lights use `celestialBodyAlpha` so only one dominates.
 * Dawn: DAWN_START→06:00. Day: 06:00–17:00. Dusk: 17:00–19:30.
 */
function cycleAmount(hour: number): number {
  if (hour <= 6) {
    return smoothstep(DAWN_START, 1, hour / 6);
  }
  if (hour < DUSK_START_HOUR) {
    return 1;
  }
  return 1 - smoothstep(DUSK_START_HOUR, DUSK_END_HOUR, hour);
}

/**
 * Mutually exclusive sun/moon body (+ halo) visibility.
 * Sunrise: moon fades out fully, then sun fades in.
 * Sunset: sun fades out fully, then moon fades in.
 * At the midpoint both are 0 — never both > 0.
 */
function celestialBodyAlpha(hour: number): { sun: number; moon: number } {
  if (hour <= SUNRISE_HOUR) {
    return { sun: 0, moon: 1 };
  }
  if (hour < 6) {
    const u = (hour - SUNRISE_HOUR) / Math.max(0.0001, 6 - SUNRISE_HOUR);
    if (u < 0.5) {
      return { sun: 0, moon: 1 - smoothstep(0, 0.5, u) };
    }
    return { sun: smoothstep(0.5, 1, u), moon: 0 };
  }
  if (hour < SUNSET_HOUR) {
    return { sun: 1, moon: 0 };
  }
  if (hour < DUSK_END_HOUR) {
    const u = (hour - SUNSET_HOUR) / Math.max(0.0001, DUSK_END_HOUR - SUNSET_HOUR);
    if (u < 0.5) {
      return { sun: 1 - smoothstep(0, 0.5, u), moon: 0 };
    }
    return { sun: 0, moon: smoothstep(0.5, 1, u) };
  }
  return { sun: 0, moon: 1 };
}

function sunElevation(hour: number): number {
  if (hour >= SUNRISE_HOUR && hour <= NOON_HOUR) {
    return smoothstep(SUNRISE_HOUR, NOON_HOUR, hour);
  }
  if (hour > NOON_HOUR && hour <= SUNSET_HOUR) {
    return 1 - smoothstep(NOON_HOUR, SUNSET_HOUR, hour);
  }
  return -0.18;
}

function moonElevation(hour: number): number {
  if (hour > 6 && hour < 18) {
    return -0.18;
  }
  const t = hour >= 18 ? (hour - 18) / 12 : (hour + 6) / 12;
  return Math.sin(t * Math.PI);
}

function placeCelestial(hour: number, sunDir: THREE.Vector3, moonDir: THREE.Vector3): void {
  const sunU =
    hour <= SUNRISE_HOUR
      ? 0
      : hour >= SUNSET_HOUR
        ? 1
        : (hour - SUNRISE_HOUR) / (SUNSET_HOUR - SUNRISE_HOUR);
  dirOnArc(sunElevation(hour), sunU, SUN_PEAK_ELEV, sunDir);
  const moonU = hour >= 18 ? (hour - 18) / 12 : hour <= 6 ? (hour + 6) / 12 : 0.5;
  dirOnArc(moonElevation(hour), moonU, MOON_PEAK_ELEV, moonDir);
}

/** 0 = east horizon, 0.5 = south high, 1 = west horizon. `peak` × 180° = max altitude. */
function dirOnArc(elevation: number, travel: number, peak: number, out: THREE.Vector3): void {
  const yaw = travel * Math.PI;
  const el = elevation * Math.PI * peak;
  const cs = Math.cos(el);
  out.set(Math.cos(yaw) * cs, Math.sin(el), Math.sin(yaw) * cs).normalize();
}

function mixLighting(t: number): void {
  mixColorTowardDay(t, NIGHT.hemiSky, DAWN.hemiSky, DAY.hemiSky, _hemiSky);
  mixColorTowardDay(t, NIGHT.hemiGround, DAWN.hemiGround, DAY.hemiGround, _hemiGround);
  mixColorTowardDay(t, NIGHT.moon, DAWN.moon, DAY.moon, _moon);
  mixColorTowardDay(t, NIGHT.sun, DAWN.sun, DAY.sun, _sun);
  mixColorTowardDay(t, NIGHT.fill, DAWN.fill, DAY.fill, _fill);
  _hemi = mixScalarTowardDay(t, NIGHT.hemi, DAWN.hemi, DAY.hemi);
  _fillLight = mixScalarTowardDay(t, NIGHT.fillLight, DAWN.fillLight, DAY.fillLight);
  _sunLight = mixScalarTowardDay(t, NIGHT.sunLight, DAWN.sunLight, DAY.sunLight);
  _moonLight = mixScalarTowardDay(t, NIGHT.moonLight, DAWN.moonLight, DAY.moonLight);
  _stars = mixScalarTowardDay(t, NIGHT.stars, DAWN.stars, DAY.stars);
  _fogNear = mixScalarTowardDay(t, FOG.nightNear, FOG.dawnNear, FOG.dayNear);
  _fogFar = mixScalarTowardDay(t, FOG.nightFar, FOG.dawnFar, FOG.dayFar);
  _fogStrength = mixScalarTowardDay(t, FOG.nightStrength, FOG.dawnStrength, FOG.dayStrength);
}

/** Soft atmospheric tint. Day stays blue-grey so noon never washes peach or white. */
function mixFogColor(t: number): void {
  mixColorTowardDay(t, NIGHT.fog, DAWN.fog, DAY.fog, _fog);
  _fog.lerp(_skyLower, 0.12);
}

/**
 * Stretch `fog.far` so the mix at `far` equals `strength` instead of going fully opaque.
 * Three.js Fog uses a smoothstep from near→far; stretching keeps silhouettes readable.
 */
function fogFarFor(near: number, far: number, strength: number): number {
  const s = Math.max(0.05, Math.min(0.99, strength));
  return near + (far - near) / s;
}

/**
 * Dome + cloud colors from night → day using the same progress `t` as `cycleAmount`.
 * Warm cloud tint peaks near CLOUD_WARM_PEAK, then fades to DAY_SKY whites.
 */
function mixSkyDomeColors(t: number): void {
  const skyT = smoothstep(0, 1, t);
  _skyZenith.copy(NIGHT_SKY.zenith).lerp(DAY_SKY.zenith, skyT);
  _skyMid.copy(NIGHT_SKY.mid).lerp(DAY_SKY.mid, skyT);
  _skyLower.copy(NIGHT_SKY.lower).lerp(DAY_SKY.lower, skyT);
  _skyHorizon.copy(NIGHT_SKY.horizon).lerp(DAY_SKY.horizon, skyT);

  // Warm wash peaks mid-dawn, then clears for a clean day blue.
  const warmBand = 4 * skyT * (1 - skyT);
  _dawnGlow.copy(DAY_SKY.horizon).lerp(DAWN_WARM_GLOW, warmBand);

  mixCloudTowardDay(
    skyT,
    NIGHT_SKY.cloudShadow,
    DAWN_CLOUD.cloudShadow,
    DAY_SKY.cloudShadow,
    _cloudShadow,
  );
  mixCloudTowardDay(skyT, NIGHT_SKY.cloudMid, DAWN_CLOUD.cloudMid, DAY_SKY.cloudMid, _cloudMid);
  mixCloudTowardDay(skyT, NIGHT_SKY.cloudRim, DAWN_CLOUD.cloudRim, DAY_SKY.cloudRim, _cloudRim);
  mixCloudTowardDay(
    skyT,
    NIGHT_SKY.cloudGreenShadow,
    DAWN_CLOUD.cloudGreenShadow,
    DAY_SKY.cloudGreenShadow,
    _cloudGreenShadow,
  );
  mixCloudTowardDay(
    skyT,
    NIGHT_SKY.cloudGreenMid,
    DAWN_CLOUD.cloudGreenMid,
    DAY_SKY.cloudGreenMid,
    _cloudGreenMid,
  );
  mixCloudTowardDay(
    skyT,
    NIGHT_SKY.cloudGreenRim,
    DAWN_CLOUD.cloudGreenRim,
    DAY_SKY.cloudGreenRim,
    _cloudGreenRim,
  );
}

/** Night → warm dawn/dusk → day, keyed off CLOUD_WARM_PEAK. */
function mixColorTowardDay(
  t: number,
  night: THREE.Color,
  warm: THREE.Color,
  day: THREE.Color,
  out: THREE.Color,
): void {
  const peak = Math.max(0.05, Math.min(0.95, CLOUD_WARM_PEAK));
  if (t <= peak) {
    const u = smoothstep(0, peak, t);
    out.copy(night).lerp(warm, u);
    return;
  }
  const u = smoothstep(peak, 1, t);
  out.copy(warm).lerp(day, u);
}

function mixScalarTowardDay(t: number, night: number, warm: number, day: number): number {
  const peak = Math.max(0.05, Math.min(0.95, CLOUD_WARM_PEAK));
  if (t <= peak) {
    return mix(night, warm, smoothstep(0, peak, t));
  }
  return mix(warm, day, smoothstep(peak, 1, t));
}

/** Night → warm dawn → day white, keyed off CLOUD_WARM_PEAK. */
function mixCloudTowardDay(
  t: number,
  night: THREE.Color,
  warm: THREE.Color,
  day: THREE.Color,
  out: THREE.Color,
): void {
  mixColorTowardDay(t, night, warm, day, out);
}

function makeSkyMaterial(moonMap: THREE.Texture, sunMap: THREE.Texture): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    fog: false,
    depthWrite: false,
    toneMapped: false,
    uniforms: {
      zenith: { value: NIGHT.zenith.clone() },
      horizon: { value: NIGHT.horizon.clone() },
      glow: { value: NIGHT.glow.clone() },
      nightZenith: { value: NIGHT_SKY.zenith.clone() },
      nightMid: { value: NIGHT_SKY.mid.clone() },
      nightLower: { value: NIGHT_SKY.lower.clone() },
      nightHorizon: { value: NIGHT_SKY.horizon.clone() },
      cloudShadow: { value: NIGHT_SKY.cloudShadow.clone() },
      cloudMid: { value: NIGHT_SKY.cloudMid.clone() },
      cloudRim: { value: NIGHT_SKY.cloudRim.clone() },
      cloudGreenShadow: { value: NIGHT_SKY.cloudGreenShadow.clone() },
      cloudGreenMid: { value: NIGHT_SKY.cloudGreenMid.clone() },
      cloudGreenRim: { value: NIGHT_SKY.cloudGreenRim.clone() },
      dawn: { value: 0 },
      sunColor: { value: DAWN.sun.clone() },
      sunDir: { value: new THREE.Vector3(1, 0.08, 0.3) },
      moonDir: { value: MOON_DIR.clone() },
      sunRad: { value: SUN_RAD },
      moonRad: { value: MOON_RAD },
      moonHaloScale: { value: MOON_HALO_SCALE },
      moonHaloStrength: { value: MOON_HALO_STRENGTH },
      sunHaloScale: { value: SUN_HALO_SCALE },
      sunHaloStrength: { value: SUN_HALO_STRENGTH },
      sunAlpha: { value: 0 },
      moonAlpha: { value: 1 },
      moonMap: { value: moonMap },
      sunMap: { value: sunMap },
      time: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 zenith;
      uniform vec3 horizon;
      uniform vec3 glow;
      uniform vec3 nightZenith;
      uniform vec3 nightMid;
      uniform vec3 nightLower;
      uniform vec3 nightHorizon;
      uniform vec3 cloudShadow;
      uniform vec3 cloudMid;
      uniform vec3 cloudRim;
      uniform vec3 cloudGreenShadow;
      uniform vec3 cloudGreenMid;
      uniform vec3 cloudGreenRim;
      uniform float dawn;
      uniform vec3 sunColor;
      uniform vec3 sunDir;
      uniform vec3 moonDir;
      uniform float sunRad;
      uniform float moonRad;
      uniform float moonHaloScale;
      uniform float moonHaloStrength;
      uniform float sunHaloScale;
      uniform float sunHaloStrength;
      uniform float sunAlpha;
      uniform float moonAlpha;
      uniform sampler2D moonMap;
      uniform sampler2D sunMap;
      uniform float time;
      varying vec3 vDir;

      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
      }

      float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
          mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
          f.y
        );
      }

      float puff(vec3 dir, vec3 center, float scale) {
        float d = acos(clamp(dot(dir, normalize(center)), -1.0, 1.0));
        return 1.0 - smoothstep(scale * 0.52, scale, d);
      }

      float wrapClouds(vec3 dir, float spin, float yaw0, float y, float scale) {
        float acc = 0.0;
        for (int i = 0; i < 8; i++) {
          float fi = float(i);
          float a = yaw0 + spin + fi * 0.78539816 + 0.22 * sin(fi * 1.73 + 0.8);
          float yi = y + 0.05 * sin(fi * 2.11 - 0.4);
          float sc = scale * (0.72 + 0.38 * (0.5 + 0.5 * sin(fi * 1.91 + 1.2)));
          vec3 c = normalize(vec3(cos(a), yi, sin(a)));
          acc += puff(dir, c, sc);
          acc += puff(dir, normalize(vec3(cos(a + 0.28), yi + 0.03, sin(a + 0.28))), sc * 0.6) * 0.65;
        }
        return clamp(acc, 0.0, 1.0);
      }

      float hazeZone(float yaw, float f1, float p1, float f2, float p2, float f3, float p3) {
        float wave = 0.5 * sin(yaw * f1 + p1) + 0.35 * sin(yaw * f2 + p2) + 0.22 * sin(yaw * f3 + p3);
        float n = noise(vec2(cos(yaw), sin(yaw)) * 1.35);
        return 0.16 + 0.84 * smoothstep(-0.5, 0.72, wave * 0.82 + (n - 0.5) * 0.35);
      }

      vec3 nightGradient(float h) {
        vec3 sky = mix(nightHorizon, nightLower, smoothstep(0.32, 0.48, h));
        sky = mix(sky, nightMid, smoothstep(0.48, 0.70, h));
        sky = mix(sky, nightZenith, smoothstep(0.70, 0.96, h));
        return sky;
      }

      vec3 dawnGradient(float h) {
        // Same stop progression as night, using colors already lerped night→day in JS.
        vec3 sky = mix(horizon, zenith, pow(max(h, 0.0), 0.72));
        float band = 1.0 - smoothstep(0.0, 0.34, abs(h - 0.46));
        // Warm wash peaks mid-dawn (glow is pre-mixed in JS); fades as dawn→1.
        float warm = band * 4.0 * dawn * (1.0 - dawn);
        return mix(sky, glow, warm);
      }

      void main() {
        vec3 dir = normalize(vDir);
        float h = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
        vec3 sky = mix(nightGradient(h), dawnGradient(h), dawn);

        vec3 mDir = normalize(moonDir);
        vec3 up = vec3(0.0, 1.0, 0.0);
        vec3 right = cross(up, mDir);
        if (dot(right, right) < 0.001) {
          right = vec3(1.0, 0.0, 0.0);
        }
        right = normalize(right);
        up = normalize(cross(mDir, right));
        vec3 offset = dir - mDir * dot(dir, mDir);
        vec2 moonUv = vec2(dot(offset, right), dot(offset, up)) / max(moonRad, 0.001) * 0.5 + 0.5;
        float moonDist = acos(clamp(dot(dir, mDir), -1.0, 1.0));
        float moonBody = moonRad * 0.66;
        float haloSoft = 1.0 - smoothstep(moonBody * 0.7, moonBody * moonHaloScale, moonDist);
        float haloCore = 1.0 - smoothstep(moonBody * 0.75, moonBody * 1.45, moonDist);
        float haloWash = 1.0 - smoothstep(0.0, moonBody * (moonHaloScale + 1.4), moonDist);
        float halo = (haloSoft * 0.5 + haloCore * 0.42 + haloWash * 0.22) * moonHaloStrength * moonAlpha;
        sky = mix(sky, vec3(0.88, 0.93, 1.0), clamp(halo, 0.0, 1.0));

        float moonMask = 0.0;
        if (moonUv.x > 0.0 && moonUv.x < 1.0 && moonUv.y > 0.0 && moonUv.y < 1.0) {
          vec4 moonS = texture2D(moonMap, moonUv);
          moonMask = moonS.a * moonAlpha;
          sky = mix(sky, moonS.rgb, moonMask);
        }

        float spin = time * 0.00013;
        float fade = smoothstep(0.34, 0.42, h) * (1.0 - smoothstep(0.58, 0.70, h));
        fade *= 0.78 + 0.22 * noise(dir.xz * 5.5 + time * 0.008);
        // Keep clouds through dawn/day; only hide under the moon disc.
        fade *= (1.0 - moonMask);
        float yaw = atan(dir.z, dir.x);
        float purple = wrapClouds(dir, spin, 0.0, 0.20, 0.50) * fade * hazeZone(yaw, 1.13, 0.55, 2.27, -1.2, 0.61, 2.1);
        float green = wrapClouds(dir, spin * 0.85, 0.393, 0.24, 0.46) * fade * hazeZone(yaw, 1.37, -0.8, 2.05, 1.6, 0.47, -0.4);
        vec3 cloudCol = mix(cloudShadow, cloudMid, clamp(h * 1.4, 0.0, 1.0));
        cloudCol = mix(cloudCol, cloudRim, smoothstep(0.40, 0.34, h) * 0.75);
        vec3 greenCol = mix(cloudGreenShadow, cloudGreenMid, clamp(h * 1.4, 0.0, 1.0));
        greenCol = mix(greenCol, cloudGreenRim, smoothstep(0.40, 0.34, h) * 0.55);
        float haze = 0.3;
        sky = mix(sky, cloudCol, purple * haze);
        sky = mix(sky, greenCol, green * haze);

        vec3 sDir = normalize(sunDir);
        float sunDist = acos(clamp(dot(dir, sDir), -1.0, 1.0));
        float sunHaloSoft = 1.0 - smoothstep(sunRad * 0.55, sunRad * sunHaloScale, sunDist);
        float sunHaloCore = 1.0 - smoothstep(sunRad * 0.35, sunRad * 1.85, sunDist);
        float sunWash = 1.0 - smoothstep(0.0, sunRad * (sunHaloScale + 2.2), sunDist);
        float sunHalo = (sunHaloSoft * 0.55 + sunHaloCore * 0.5 + sunWash * 0.28) * sunHaloStrength * sunAlpha;
        vec3 sunGlow = mix(sunColor, vec3(1.0, 0.94, 0.62), 0.55);
        sky = mix(sky, sunGlow, clamp(sunHalo, 0.0, 1.0));

        vec3 sunRight = cross(vec3(0.0, 1.0, 0.0), sDir);
        if (dot(sunRight, sunRight) < 0.001) {
          sunRight = vec3(1.0, 0.0, 0.0);
        }
        sunRight = normalize(sunRight);
        vec3 sunUp = normalize(cross(sDir, sunRight));
        vec3 sunOffset = dir - sDir * dot(dir, sDir);
        vec2 sunUv = vec2(dot(sunOffset, sunRight), dot(sunOffset, sunUp)) / max(sunRad, 0.001) * 0.5 + 0.5;
        if (sunUv.x > 0.0 && sunUv.x < 1.0 && sunUv.y > 0.0 && sunUv.y < 1.0) {
          vec4 sunS = texture2D(sunMap, sunUv);
          sky = mix(sky, sunS.rgb, sunS.a * sunAlpha);
        }

        gl_FragColor = vec4(sky, 1.0);
      }
    `,
  });
}

function makeStars(count: number, size: number, map: THREE.Texture): THREE.Points {
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const yaw = Math.random() * Math.PI * 2;
    const pitch = 0.22 + Math.random() * 1.05;
    const r = 700;
    positions[i * 3] = Math.cos(yaw) * Math.cos(pitch) * r;
    positions[i * 3 + 1] = Math.sin(pitch) * r;
    positions[i * 3 + 2] = Math.sin(yaw) * Math.cos(pitch) * r;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    color: 0xe8eef8,
    size,
    map,
    sizeAttenuation: false,
    transparent: true,
    opacity: 1,
    depthWrite: false,
    fog: false,
    toneMapped: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = -99;
  return points;
}

function makeDotTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 32;
  canvas.height = 32;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return new THREE.CanvasTexture(canvas);
  }
  const g = ctx.createRadialGradient(16, 16, 1, 16, 16, 14);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.45, "rgba(230,240,255,0.85)");
  g.addColorStop(1, "rgba(230,240,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 32, 32);
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

function makeSparkleTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return new THREE.CanvasTexture(canvas);
  }
  ctx.translate(32, 32);
  ctx.strokeStyle = "rgba(255,255,255,0.95)";
  ctx.lineCap = "round";
  for (let i = 0; i < 2; i++) {
    ctx.rotate(i * Math.PI * 0.5);
    const g = ctx.createLinearGradient(0, -26, 0, 26);
    g.addColorStop(0, "rgba(255,255,255,0)");
    g.addColorStop(0.45, "rgba(255,255,255,0.95)");
    g.addColorStop(0.55, "rgba(255,255,255,0.95)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.strokeStyle = g;
    ctx.lineWidth = i === 0 ? 2.4 : 1.8;
    ctx.beginPath();
    ctx.moveTo(0, -26);
    ctx.lineTo(0, 26);
    ctx.stroke();
  }
  const core = ctx.createRadialGradient(0, 0, 0, 0, 0, 8);
  core.addColorStop(0, "rgba(255,255,255,1)");
  core.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(0, 0, 8, 0, Math.PI * 2);
  ctx.fill();
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

/**
 * Sun disc fill (canvas). Pale warm yellow — tweak these for hue/saturation tests.
 * Core is closer to white; rim keeps a soft yellow so it still reads as the sun.
 */
const SUN_DISC = {
  core: "#fffdf2",
  mid: "#fff6d0",
  rim: "#ffe9a8",
};

/** Flat cartoon sun disc — same footprint as before; halo stays in the shader. */
function drawSun(): HTMLCanvasElement {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return canvas;
  }
  const cx = 256;
  const cy = 256;
  const r = 118;

  // Soft fill only — no black outline or rays; glow comes from the shader halo.
  const fill = ctx.createRadialGradient(cx - 18, cy - 22, r * 0.12, cx, cy, r);
  fill.addColorStop(0, SUN_DISC.core);
  fill.addColorStop(0.55, SUN_DISC.mid);
  fill.addColorStop(1, SUN_DISC.rim);
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();

  return canvas;
}

/** Flat cartoon moon disc — clean circle, no outline. */
function drawMoon(): HTMLCanvasElement {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return canvas;
  }
  const cx = 256;
  const cy = 256;
  const r = 168;

  const fill = ctx.createRadialGradient(cx - 28, cy - 32, r * 0.1, cx, cy, r);
  fill.addColorStop(0, "#ffffff");
  fill.addColorStop(0.65, "#f0f2f6");
  fill.addColorStop(1, "#e4e8f0");
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();

  return canvas;
}

function setupTreeShadows(light: THREE.DirectionalLight): void {
  const quality = getQuality();
  light.castShadow = quality.shadows;
  light.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
  light.shadow.intensity = 0.42;
  light.shadow.radius = quality.tier === "desktop" ? 2.2 : 1.2;
  light.shadow.bias = -0.0009;
  light.shadow.normalBias = 0.85;
  const cam = light.shadow.camera;
  const extent = 220;
  cam.left = -extent;
  cam.right = extent;
  cam.top = extent;
  cam.bottom = -extent;
  cam.near = 10;
  cam.far = 720;
  cam.updateProjectionMatrix();
}

function aimTreeShadows(light: THREE.DirectionalLight, origin: THREE.Vector3, dir: THREE.Vector3): void {
  _shadowFocus.copy(origin);
  _shadowFocus.y = 0;
  light.target.position.copy(_shadowFocus);
  light.position.copy(_shadowFocus).addScaledVector(dir, 380);
  light.target.updateMatrixWorld();
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / Math.max(0.0001, edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}
