/**
 * What the cove sounds like from where you're looking: a pure function of the world around the
 * camera target, the zoom and the hour. Three-free so it can be tested in node; src/sound.ts
 * turns these levels into Web Audio.
 */
import { N, WATER_Y, type World } from "./world.ts";

export interface Listener {
  /** Camera target on the ground plane. */
  x: number; z: number;
  /** Camera distance from its target. */
  dist: number;
  /** 0 by day, 1 at night. */
  night: number;
  /** People walking near the target. */
  people?: { x: number; z: number; vis: number }[];
  /** Boats currently under way. */
  sailing?: number;
}

export interface Mix {
  /** Continuous beds, 0..1. */
  surf: number; wind: number; insects: number;
  /** How often the occasional voices speak, 0..1 (0 = never). */
  gulls: number; creaks: number; voices: number; owl: number; bell: number; ropes: number;
}

const R = 9;
const near = (dx: number, dz: number) => Math.max(0, 1 - Math.hypot(dx, dz) / R);
const GREEN = new Set(["palm", "bougainvillea", "scrub"]);

export function ambienceMix(world: World, l: Listener): Mix {
  // how much of the view is water, how much is shore where waves break
  let water = 0, shore = 0, total = 0;
  for (let dz = -R; dz <= R; dz += 1.5) for (let dx = -R; dx <= R; dx += 1.5) {
    const x = l.x + dx, z = l.z + dz, w = near(dx, dz);
    if (w <= 0) continue;
    total += w;
    if (x < 0 || z < 0 || x > N || z > N) { water += w; continue; }
    const g = world.height(x, z);
    if (g < WATER_Y) { water += w; if (g > WATER_Y - 0.6) shore += w; }
    else if (g < WATER_Y + 0.5) shore += w;
  }
  water /= total || 1; shore /= total || 1;

  let decks = 0, ropes = 0;
  for (const e of world.edges.values()) {
    const a = world.nodes.get(e.a), b = world.nodes.get(e.b);
    if (!a || !b) continue;
    const k = near((a.x + b.x) / 2 - l.x, (a.z + b.z) / 2 - l.z) * Math.hypot(b.x - a.x, b.z - a.z);
    if (e.style === "rope") ropes += k; else decks += k;
  }
  let green = 0, lighthouse = false, boats = 0;
  for (const p of world.props.values()) {
    if (GREEN.has(p.type)) green += near(p.x - l.x, p.z - l.z);
    else if (p.type === "lighthouse") lighthouse = true;
    else if (p.type === "rowboat" || p.type === "sloop" || p.type === "hull") boats += near(p.x - l.x, p.z - l.z);
  }
  let folk = 0;
  for (const v of l.people ?? []) folk += v.vis * near(v.x - l.x, v.z - l.z);

  // close in you hear the cove; pulled back you hear the wind
  const close = clamp01(1 - (l.dist - 6) / 50), high = clamp01((l.dist - 10) / 45);
  const day = 1 - l.night;
  return {
    surf: clamp01((0.25 + 0.75 * shore + 0.35 * water) * (0.55 + 0.45 * close)),
    wind: clamp01(0.18 + 0.55 * high + 0.15 * l.night),
    insects: clamp01(l.night * Math.min(1, green / 3) * (0.3 + 0.7 * close)),
    gulls: clamp01(day * (0.25 + 0.6 * water) * (0.4 + 0.6 * close)),
    creaks: clamp01((Math.min(1, decks / 12) + Math.min(1, boats) * 0.5 + (l.sailing ?? 0) * 0.15) * close),
    voices: clamp01(Math.min(1, folk / 3) * close * (0.4 + 0.6 * day)),
    owl: clamp01(l.night * Math.min(1, green / 2) * 0.6),
    bell: lighthouse ? clamp01(0.25 + 0.5 * l.night) : 0,
    ropes: clamp01(Math.min(1, ropes / 4) * close),
  };
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
