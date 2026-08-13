import * as THREE from "three";
import { worldHour, worldMinuteFromTimeLeft } from "../sim/worldClock";

/** Night holds for most of the round; dawn only arrives as the clock runs down. */
const DAWN_START = 0.02;

/**
 * Cartoon haze (not a hide wall).
 * `near` — fade starts here.
 * `far` — distance where mix equals `strength` (silhouettes still read).
 * `strength` — 0–1 peak opacity at `far`. Keep below 1 so nothing vanishes.
 */
const FOG = {
  nightNear: 165,
  nightFar: 860,
  nightStrength: 0.48,
  nightColor: 0x3a5278,
  dawnNear: 230,
  dawnFar: 920,
  dawnStrength: 0.38,
  dawnColor: 0xf0c8a8,
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
  moonLight: 0.38,
  sunLight: 0.08,
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
  hemi: 0.78,
  moonLight: 0.04,
  sunLight: 0.72,
  fillLight: 0.28,
  stars: 0,
  moonAlpha: 0.08,
  sunAlpha: 1,
};

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
/** Dusk lighting/body fade ends here — same window as `dayAmount`. */
const DUSK_END_HOUR = 19.5;
const _sunDir = new THREE.Vector3();
const _moonDir = new THREE.Vector3();
const _sunLightPos = new THREE.Vector3();
const _moonLightPos = new THREE.Vector3();
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

const _zenith = new THREE.Color();
const _horizon = new THREE.Color();
const _glow = new THREE.Color();
const _fog = new THREE.Color();
const _hemiSky = new THREE.Color();
const _hemiGround = new THREE.Color();
const _moon = new THREE.Color();
const _sun = new THREE.Color();
const _fill = new THREE.Color();

export type SkyRig = {
  update: (timeLeft: number, worldMinute?: number) => void;
};

/**
 * Atmosphere only. Driven by `timeLeft`, never by round phase —
 * a hunter win at 8:00 keeps the night sky.
 */
export function createSky(scene: THREE.Scene, camera: THREE.Camera): SkyRig {
  const fog = new THREE.Fog(NIGHT.fog.clone(), FOG.nightNear, fogFarFor(FOG.nightNear, FOG.nightFar, FOG.nightStrength));
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

  const dome = new THREE.Mesh(new THREE.SphereGeometry(820, 32, 20), makeSkyMaterial(moonMap, sunMap));
  dome.geometry.scale(-1, 1, 1);
  dome.frustumCulled = false;
  dome.renderOrder = -100;
  root.add(dome);

  const starField = new THREE.Group();
  starField.add(makeStars(380, 2.0, makeDotTexture()));
  starField.add(makeStars(12, 7.5, makeSparkleTexture()));
  root.add(starField);

  const hemi = new THREE.HemisphereLight(NIGHT.hemiSky, NIGHT.hemiGround, NIGHT.hemi);
  scene.add(hemi);

  const moonLight = new THREE.DirectionalLight(NIGHT.moon, NIGHT.moonLight);
  moonLight.position.copy(MOON_POS);
  scene.add(moonLight);

  const sunLight = new THREE.DirectionalLight(DAWN.sun, NIGHT.sunLight);
  placeCelestial(0, _sunDir, _moonDir);
  sunLight.position.copy(_sunLightPos.copy(_sunDir).multiplyScalar(420));
  scene.add(sunLight);

  const fill = new THREE.AmbientLight(NIGHT.fill, NIGHT.fillLight);
  scene.add(fill);

  const uniforms = (dome.material as THREE.ShaderMaterial).uniforms;
  const started = performance.now();

  return {
    update(timeLeft: number, worldMinute?: number) {
      root.position.copy(camera.position);
      const minute = worldMinute ?? worldMinuteFromTimeLeft(timeLeft);
      const hour = worldHour(minute);
      const t = skyAmountFromMinute(minute);
      placeCelestial(hour, _sunDir, _moonDir);
      const elapsed = (performance.now() - started) * 0.001;
      mixPalette(t);

      background.copy(_fog);
      fog.color.copy(_fog);
      const near = mix(FOG.nightNear, FOG.dawnNear, t);
      const far = mix(FOG.nightFar, FOG.dawnFar, t);
      const strength = mix(FOG.nightStrength, FOG.dawnStrength, t);
      fog.near = near;
      fog.far = fogFarFor(near, far, strength);

      uniforms.zenith.value.copy(_zenith);
      uniforms.horizon.value.copy(_horizon);
      uniforms.glow.value.copy(_glow);
      uniforms.dawn.value = t;
      uniforms.sunColor.value.copy(_sun);
      uniforms.sunDir.value.copy(_sunDir);
      uniforms.moonDir.value.copy(_moonDir);
      const sunA = sunBodyAlpha(hour);
      const moonA = moonBodyAlpha(hour);
      uniforms.sunAlpha.value = sunA;
      uniforms.moonAlpha.value = moonA;
      uniforms.time.value = elapsed;

      hemi.color.copy(_hemiSky);
      hemi.groundColor.copy(_hemiGround);
      hemi.intensity = mix(NIGHT.hemi, DAWN.hemi, t);

      moonLight.color.copy(_moon);
      moonLight.intensity = 0.08 + 0.5 * moonA;
      moonLight.position.copy(_moonLightPos.copy(_moonDir).multiplyScalar(420));

      sunLight.color.copy(_sun);
      sunLight.intensity = 1.18 * sunA;
      sunLight.position.copy(_sunLightPos.copy(_sunDir).multiplyScalar(420));

      fill.color.copy(_fill);
      fill.intensity = mix(NIGHT.fillLight, DAWN.fillLight, t);

      starField.rotation.y = elapsed * STAR_SPIN;
      starField.rotation.z = elapsed * STAR_SPIN * 0.28;
      const starOpacity = mix(NIGHT.stars, DAWN.stars, t);
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

/** 0 = night (round start), 1 = dawn (timer empty). */
export function skyAmount(timeLeft: number): number {
  return skyAmountFromMinute(worldMinuteFromTimeLeft(timeLeft));
}

function skyAmountFromMinute(minute: number): number {
  return dayAmount(worldHour(minute));
}

/**
 * Single 0–1 day factor for lighting, sun alpha, and moon alpha.
 * Dawn: DAWN_START→06:00. Day: 06:00–18:00. Dusk: 18:00–19:30.
 */
function dayAmount(hour: number): number {
  if (hour <= 6) {
    return smoothstep(DAWN_START, 1, hour / 6);
  }
  if (hour < SUNSET_HOUR) {
    return 1;
  }
  return 1 - smoothstep(SUNSET_HOUR, DUSK_END_HOUR, hour);
}

function sunElevation(hour: number): number {
  if (hour >= SUNRISE_HOUR && hour <= NOON_HOUR) {
    return smoothstep(SUNRISE_HOUR, NOON_HOUR, hour);
  }
  if (hour > NOON_HOUR && hour < SUNSET_HOUR) {
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

function sunBodyAlpha(hour: number): number {
  return dayAmount(hour);
}

function moonBodyAlpha(hour: number): number {
  return 1 - dayAmount(hour);
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

function mixPalette(t: number): void {
  _zenith.copy(NIGHT.zenith).lerp(DAWN.zenith, t);
  _horizon.copy(NIGHT.horizon).lerp(DAWN.horizon, t);
  _glow.copy(NIGHT.glow).lerp(DAWN.glow, t);
  _fog.copy(NIGHT.fog).lerp(DAWN.fog, t);
  _hemiSky.copy(NIGHT.hemiSky).lerp(DAWN.hemiSky, t);
  _hemiGround.copy(NIGHT.hemiGround).lerp(DAWN.hemiGround, t);
  _moon.copy(NIGHT.moon).lerp(DAWN.moon, t);
  _sun.copy(NIGHT.sun).lerp(DAWN.sun, t);
  _fill.copy(NIGHT.fill).lerp(DAWN.fill, t);
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
        vec3 sky = mix(horizon, zenith, pow(max(h, 0.0), 0.72));
        float band = 1.0 - smoothstep(0.0, 0.34, abs(h - 0.46));
        return mix(sky, glow, band * dawn * 0.72);
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
        fade *= (1.0 - moonMask) * (1.0 - dawn);
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

  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (let i = 0; i < 16; i++) {
    const base = (i / 16) * Math.PI * 2 + 0.07 * Math.sin(i * 2.4);
    const inner = r + 16 + (i % 3) * 2;
    const outer = inner + 28 + (i % 5) * 5 + ((i * 3) % 7);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(base);
    ctx.strokeStyle = "#111111";
    ctx.lineWidth = 9 + (i % 4 === 0 ? 2 : 0);
    ctx.beginPath();
    ctx.moveTo(0, -inner);
    ctx.lineTo(2.5 * Math.sin(i * 1.7), -outer);
    ctx.stroke();
    ctx.restore();
  }

  const wobble = (angle: number): number =>
    r * (1 + 0.022 * Math.sin(angle * 5 + 0.4) + 0.014 * Math.sin(angle * 9 - 0.8));

  ctx.beginPath();
  for (let i = 0; i <= 72; i++) {
    const a = (i / 72) * Math.PI * 2;
    const rr = wobble(a);
    const x = cx + Math.cos(a) * rr;
    const y = cy + Math.sin(a) * rr;
    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.closePath();
  ctx.fillStyle = "#f4d44a";
  ctx.fill();

  ctx.save();
  ctx.clip();
  const wash = ctx.createRadialGradient(cx - 18, cy - 22, 12, cx + 16, cy + 28, r + 8);
  wash.addColorStop(0, "rgba(255, 248, 190, 0.95)");
  wash.addColorStop(0.45, "rgba(244, 212, 74, 0.2)");
  wash.addColorStop(1, "rgba(232, 150, 48, 0.7)");
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 28; i++) {
    const a = (i * 2.4) % (Math.PI * 2);
    const d = (i * 17) % (r - 18);
    ctx.beginPath();
    ctx.arc(cx + Math.cos(a) * d * 0.55, cy + Math.sin(a) * d * 0.55, 10 + (i % 5) * 3, 0, Math.PI * 2);
    ctx.fillStyle = i % 2 === 0 ? "rgba(255, 236, 140, 0.18)" : "rgba(220, 130, 40, 0.1)";
    ctx.fill();
  }
  ctx.fillStyle = "#111111";
  const specks: Array<[number, number, number]> = [
    [cx + 62, cy - 48, 2.4],
    [cx + 70, cy - 38, 2.0],
    [cx + 54, cy - 58, 1.8],
    [cx - 68, cy + 42, 2.2],
    [cx - 58, cy + 54, 1.7],
    [cx + 48, cy + 70, 2.0],
    [cx - 40, cy - 72, 1.8],
    [cx + 78, cy + 18, 2.1],
  ];
  for (const [x, y, rad] of specks) {
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.lineWidth = 2.6;
  ctx.strokeStyle = "#111111";
  const ticks: Array<[number, number, number, number]> = [
    [cx + 44, cy - 70, cx + 56, cy - 64],
    [cx - 72, cy - 8, cx - 60, cy - 2],
    [cx + 20, cy + 78, cx + 32, cy + 74],
  ];
  for (const [x0, y0, x1, y1] of ticks) {
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  }
  ctx.restore();

  ctx.beginPath();
  for (let i = 0; i <= 72; i++) {
    const a = (i / 72) * Math.PI * 2;
    const rr = wobble(a);
    const x = cx + Math.cos(a) * rr;
    const y = cy + Math.sin(a) * rr;
    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.closePath();
  ctx.lineWidth = 13;
  ctx.strokeStyle = "#111111";
  ctx.stroke();

  return canvas;
}

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

  const ray = (angle: number, inner: number, outer: number) => {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    ctx.strokeStyle = "#111111";
    ctx.lineWidth = 7;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(0, -inner);
    ctx.lineTo(0, -outer);
    ctx.stroke();
    ctx.restore();
  };
  ray(-0.95, r + 18, r + 52);
  ray(-0.72, r + 16, r + 44);
  ray(-1.18, r + 16, r + 40);
  ray(2.15, r + 18, r + 50);
  ray(2.38, r + 16, r + 42);
  ray(1.95, r + 16, r + 38);

  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = "#f4f4f4";
  ctx.fill();

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  const shade = ctx.createRadialGradient(cx + 40, cy - 36, 30, cx - 24, cy + 50, r + 10);
  shade.addColorStop(0, "rgba(255,255,255,0)");
  shade.addColorStop(0.45, "rgba(210,210,214,0.15)");
  shade.addColorStop(1, "rgba(168,168,176,0.72)");
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, size, size);

  const crater = (x: number, y: number, rx: number, ry: number, rot: number) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.beginPath();
    ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
    ctx.fillStyle = "#9a9aa2";
    ctx.fill();
    ctx.lineWidth = 5;
    ctx.strokeStyle = "#111111";
    ctx.stroke();
    ctx.restore();
  };
  crater(cx + 36, cy - 28, 28, 20, -0.35);
  crater(cx - 48, cy + 8, 22, 16, 0.4);
  crater(cx + 18, cy + 58, 18, 13, -0.2);
  crater(cx - 20, cy - 70, 14, 10, 0.5);
  crater(cx + 78, cy + 18, 11, 8, 0.15);
  crater(cx - 78, cy - 36, 9, 7, -0.4);

  ctx.fillStyle = "#111111";
  const specks: Array<[number, number]> = [
    [cx + 70, cy - 60],
    [cx - 70, cy + 48],
    [cx + 8, cy + 20],
    [cx - 30, cy + 70],
    [cx + 90, cy - 10],
    [cx - 90, cy + 8],
    [cx + 52, cy + 88],
  ];
  for (const [x, y] of specks) {
    ctx.beginPath();
    ctx.arc(x, y, 3.2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.lineWidth = 3.2;
  ctx.strokeStyle = "#111111";
  ctx.lineCap = "round";
  const ticks: Array<[number, number, number, number]> = [
    [cx - 10, cy - 20, cx + 6, cy - 16],
    [cx + 60, cy + 50, cx + 74, cy + 46],
    [cx - 60, cy - 8, cx - 48, cy - 2],
  ];
  for (const [x0, y0, x1, y1] of ticks) {
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  }
  ctx.restore();

  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.lineWidth = 14;
  ctx.strokeStyle = "#111111";
  ctx.stroke();

  return canvas;
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Stretch Three.Fog so mix at `far` equals `strength` instead of 1. */
function fogFarFor(near: number, far: number, strength: number): number {
  const amount = clamp(strength, 0.05, 1);
  return near + (far - near) / amount;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / Math.max(0.0001, edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}
