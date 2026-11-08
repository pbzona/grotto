import { N, WATER_Y, DECK_Y, type World, type WalkNode } from "./world.ts";

export const WALK_W = 1.1;
export const defaultDeckY = (world: World, x: number, z: number) => {
  const g = world.height(Math.min(N, Math.max(0, x)), Math.min(N, Math.max(0, z)));
  return g < WATER_Y + 0.3 ? DECK_Y : Math.round((g + 0.2) * 20) / 20;
};
/** Rise over run of the stretch between two posts. */
export const slopeOf = (a: WalkNode, b: WalkNode) => Math.abs(b.y - a.y) / Math.max(0.1, Math.hypot(b.x - a.x, b.z - a.z));
export const isStairs = (a: WalkNode, b: WalkNode) => slopeOf(a, b) > 0.42;
/** The steepest a staircase may climb (about 37°): rickety, but still something you'd walk up. */
export const MAX_STAIR = 0.75;
/** Clamp a new height for post `n` so none of its stretches gets steeper than MAX_STAIR (left alone if they already are). */
export function clampStair(world: World, n: WalkNode, y: number) {
  let lo = -Infinity, hi = Infinity;
  for (const e of world.edgesOf(n.id)) {
    const o = world.nodes.get(e.a === n.id ? e.b : e.a); if (!o) continue;
    const r = MAX_STAIR * Math.max(0.1, Math.hypot(o.x - n.x, o.z - n.z));
    lo = Math.max(lo, o.y - r); hi = Math.min(hi, o.y + r);
  }
  return lo <= hi ? Math.max(lo, Math.min(hi, y)) : y;
}
