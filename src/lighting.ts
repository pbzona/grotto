import * as THREE from "three/webgpu";
import { N } from "./world.ts";

interface Key { h: number; sun: string; sunI: number; sky: string; ground: string; hemiI: number; top: string; horizon: string; fog: string; night: number }
// golden sun against deep teal shadows; warm lamps against a cool teal night
const KEYS: Key[] = [
  { h: 0, sun: "#8aa0d8", sunI: 0.5, sky: "#2f5580", ground: "#1a2230", hemiI: 0.75, top: "#0a1628", horizon: "#1d3350", fog: "#15263c", night: 1 },
  { h: 4.8, sun: "#8a9dd0", sunI: 0.5, sky: "#325478", ground: "#1b212c", hemiI: 0.75, top: "#0e1c32", horizon: "#2a3f5c", fog: "#1d2e45", night: 1 },
  { h: 6.2, sun: "#ffa46b", sunI: 1.6, sky: "#8fa9c8", ground: "#5a4436", hemiI: 1.02, top: "#4f7fb0", horizon: "#f5b98a", fog: "#e8b894", night: 0.35 },
  { h: 8.5, sun: "#ffe0b3", sunI: 2.7, sky: "#a9d2ec", ground: "#9a7f62", hemiI: 1.28, top: "#4d9bd2", horizon: "#f2dcb8", fog: "#dfe3d8", night: 0 },
  { h: 13, sun: "#fff1d9", sunI: 3.0, sky: "#b3daf0", ground: "#a08567", hemiI: 1.34, top: "#3f93cf", horizon: "#e9e4d2", fog: "#dde6e4", night: 0 },
  { h: 16.5, sun: "#ffd29a", sunI: 2.8, sky: "#a8cde6", ground: "#a4805f", hemiI: 1.28, top: "#4a8fc6", horizon: "#f4d4a4", fog: "#ecd8b8", night: 0 },
  { h: 18.6, sun: "#ff9a5a", sunI: 1.9, sky: "#9a8fb6", ground: "#6a4533", hemiI: 1.09, top: "#4e6aa0", horizon: "#f7a870", fog: "#e7a67e", night: 0.25 },
  { h: 19.8, sun: "#c7768a", sunI: 0.7, sky: "#4f5a8a", ground: "#2a2230", hemiI: 0.65, top: "#223a66", horizon: "#b8707a", fog: "#5c4c64", night: 0.75 },
  { h: 21, sun: "#8aa0d8", sunI: 0.5, sky: "#2f5580", ground: "#1a2230", hemiI: 0.75, top: "#0a1628", horizon: "#1d3350", fog: "#15263c", night: 1 },
  { h: 24, sun: "#8aa0d8", sunI: 0.5, sky: "#2f5580", ground: "#1a2230", hemiI: 0.75, top: "#0a1628", horizon: "#1d3350", fog: "#15263c", night: 1 },
];
const ca = new THREE.Color(), cb = new THREE.Color();
function lerpHex(a: string, b: string, t: number, out: THREE.Color) { ca.set(a); cb.set(b); return out.copy(ca).lerp(cb, t); }

export interface Sky { sun: THREE.Color; sunI: number; sky: THREE.Color; ground: THREE.Color; hemiI: number; top: THREE.Color; horizon: THREE.Color; fog: THREE.Color; night: number; dir: THREE.Vector3 }
export function skyAt(hour: number, out?: Sky): Sky {
  const o = out ?? { sun: new THREE.Color(), sunI: 0, sky: new THREE.Color(), ground: new THREE.Color(), hemiI: 0, top: new THREE.Color(), horizon: new THREE.Color(), fog: new THREE.Color(), night: 0, dir: new THREE.Vector3() };
  const h = ((hour % 24) + 24) % 24;
  let i = 0; while (i < KEYS.length - 2 && KEYS[i + 1].h <= h) i++;
  const a = KEYS[i], b = KEYS[i + 1];
  const t = (h - a.h) / Math.max(1e-4, b.h - a.h);
  lerpHex(a.sun, b.sun, t, o.sun); lerpHex(a.sky, b.sky, t, o.sky); lerpHex(a.ground, b.ground, t, o.ground);
  lerpHex(a.top, b.top, t, o.top); lerpHex(a.horizon, b.horizon, t, o.horizon); lerpHex(a.fog, b.fog, t, o.fog);
  o.sunI = a.sunI + (b.sunI - a.sunI) * t; o.hemiI = a.hemiI + (b.hemiI - a.hemiI) * t; o.night = a.night + (b.night - a.night) * t;
  // sun arc (rises east, sets west); at night the "sun" is the moon, high in the south
  const day = (h - 6) / 13; // 0 at sunrise, 1 at sunset
  if (day >= -0.03 && day <= 1.03) {
    const ang = Math.PI * Math.min(1, Math.max(0, day));
    o.dir.set(Math.cos(ang) * 0.85, Math.max(0.12, Math.sin(ang)) * 0.9, 0.45).normalize();
  } else o.dir.set(-0.3, 0.8, 0.55).normalize();
  return o;
}
export function formatHour(h: number) {
  const hh = Math.floor(((h % 24) + 24) % 24), mm = Math.floor((h - Math.floor(h)) * 60);
  const ap = hh < 12 ? "am" : "pm"; const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${h12}:${mm.toString().padStart(2, "0")} ${ap}`;
}

/** CPU-rasterised warm glow of every lamp and lit window, sampled by the shaders at night. */
export class LightMap {
  static RES = 3; // texels per unit
  size = N * LightMap.RES;
  data = new Uint8Array(this.size * this.size * 4);
  texture: THREE.DataTexture;
  constructor() {
    this.texture = new THREE.DataTexture(this.data, this.size, this.size, THREE.RGBAFormat);
    this.texture.magFilter = this.texture.minFilter = THREE.LinearFilter;
  }
  update(lights: { x: number; z: number; r: number; i: number }[]) {
    const S = this.size, R = LightMap.RES, f = new Float32Array(S * S);
    for (const l of lights) {
      const rr = l.r * R;
      const i0 = Math.max(0, Math.floor(l.x * R - rr)), i1 = Math.min(S - 1, Math.ceil(l.x * R + rr));
      const j0 = Math.max(0, Math.floor(l.z * R - rr)), j1 = Math.min(S - 1, Math.ceil(l.z * R + rr));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const d = Math.hypot(i + 0.5 - l.x * R, j + 0.5 - l.z * R) / rr;
        if (d < 1) f[j * S + i] += l.i * 0.8 * Math.pow(1 - d, 2);
      }
    }
    for (let k = 0; k < S * S; k++) { const v = Math.min(1, f[k]); this.data[k * 4] = Math.round(v * 255); this.data[k * 4 + 3] = 255; }
    this.texture.needsUpdate = true;
  }
}
