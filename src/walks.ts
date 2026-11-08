import { WATER_Y, DECK_Y, N, grottoTieAt, type World, type WalkEdge, type WalkNode } from "./world.ts";
import { MeshBuilder, M, hexRGB, hsh, add, scl, lerp3, type V3 } from "./mesh.ts";
import { doorOf, type Light } from "./houses.ts";

/**
 * The walkway network: nodes joined by edges. One system covers docks and piers on posts, beach
 * boardwalks, ramps, stairs up the cliffs (any steep edge becomes a staircase) and rope bridges
 * (rope-style edges sag between tall end posts). Junctions get rounded landings; dead ends over
 * water get bollards, a ladder and often a lantern.
 */

export const WALK_W = 1.1;
const DECK = "#a58461", TAR = "#4c3b2e";
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

export interface WalkBuild { lights: Light[]; foam: { x: number; z: number; r: number }[] }

const OCT = Math.cos(Math.PI / 8);
/** Smallest angle (radians) between the walkways meeting at a post; π when fewer than two meet. */
export function junctionAngle(world: World, n: WalkNode) {
  const dirs: number[] = [];
  for (const e of world.edgesOf(n.id)) { const o = world.nodes.get(e.a === n.id ? e.b : e.a); if (o) dirs.push(Math.atan2(o.z - n.z, o.x - n.x)); }
  let m = Math.PI;
  for (let i = 0; i < dirs.length; i++) for (let j = i + 1; j < dirs.length; j++) { let d = Math.abs(dirs[i] - dirs[j]) % (2 * Math.PI); if (d > Math.PI) d = 2 * Math.PI - d; m = Math.min(m, d); }
  return m;
}
/** How far walkways stop short of a junction so their decks don't overlap: grows as the angle between them closes. */
export function junctionTrim(world: World, n: WalkNode) {
  const es = world.edgesOf(n.id);
  const hw = es.reduce((m, e) => Math.max(m, e.width), 0.6) / 2;
  if (es.length < 2) return 0;
  const th = Math.max(0.2, junctionAngle(world, n));
  return Math.min(1.9, Math.max(hw * 0.55, hw / Math.tan(th / 2) + 0.12));
}
/**
 * How walkways meet at a post: "through" when one runs straight on (no platform, the decks just join),
 * "square" when they meet at right angles (a plain square of decking), "landing" for anything else.
 */
export type Joint = "end" | "through" | "square" | "bend" | "landing";
const THROUGH = (20 * Math.PI) / 180, SQUARE = (8 * Math.PI) / 180, BEND = (110 * Math.PI) / 180;
export function jointOf(world: World, n: WalkNode): Joint {
  const es = world.edgesOf(n.id);
  if (es.length < 2) return "end";
  const dirs: number[] = [];
  for (const e of es) { const o = world.nodes.get(e.a === n.id ? e.b : e.a); if (o) dirs.push(Math.atan2(o.z - n.z, o.x - n.x)); }
  if (dirs.length < 2) return "end";
  if (es.some(e => e.style === "rope")) return "landing";
  if (dirs.length === 2 && junctionAngle(world, n) >= Math.PI - THROUGH) return "through";
  const q = Math.PI / 2;
  const square = dirs.every(d => { const r = (((d - dirs[0]) % q) + q) % q; return Math.min(r, q - r) <= SQUARE; });
  if (square) return "square";
  // a gentle turn gets a mitred corner; anything sharper, or several walkways at odd angles, meet on a landing
  return dirs.length === 2 && junctionAngle(world, n) >= BEND ? "bend" : "landing";
}
/** The mitred corner piece at a bend: inner mitre point, the two outer deck corners and the outer point between them. */
function bendKite(world: World, n: WalkNode) {
  const es = world.edgesOf(n.id), hw = jointHalf(world, n);
  const [p, q] = es.map(e => world.nodes.get(e.a === n.id ? e.b : e.a)!);
  const la = Math.hypot(p.x - n.x, p.z - n.z), lb = Math.hypot(q.x - n.x, q.z - n.z);
  const ua = [(p.x - n.x) / la, (p.z - n.z) / la], ub = [(q.x - n.x) / lb, (q.z - n.z) / lb];
  const th = junctionAngle(world, n), t = hw / Math.tan(th / 2), m = hw / Math.sin(th / 2);
  const bl = Math.hypot(ua[0] + ub[0], ua[1] + ub[1]), b = [(ua[0] + ub[0]) / bl, (ua[1] + ub[1]) / bl];
  const outer = (u: number[]) => { const sx = -u[1], sz = u[0], k = sx * b[0] + sz * b[1] > 0 ? -1 : 1; return [n.x + u[0] * t + sx * hw * k, n.z + u[1] * t + sz * hw * k]; };
  return { t, pts: [[n.x + b[0] * m, n.z + b[1] * m], outer(ua), [n.x - b[0] * m, n.z - b[1] * m], outer(ub)] };
}
function groundRopeJoint(world: World, n: WalkNode) {
  const es = world.edgesOf(n.id);
  return n.pad <= 0 && es.length >= 2 && es.every(e => e.style === "rope") && n.y - world.height(n.x, n.z) < 0.3;
}

export function landingRadius(world: World, n: WalkNode) {
  const es = world.edgesOf(n.id);
  const w = es.reduce((m, e) => Math.max(m, e.width), 0.6);
  if (n.pad > 0) return n.pad;
  if (groundRopeJoint(world, n)) return w / 2;
  const j = jointOf(world, n);
  if (j === "through" || j === "square" || j === "bend") return (w / 2) * 1.14 / OCT;
  return Math.max((w / 2) * 1.14 / OCT, junctionTrim(world, n) + 0.12);
}

export function buildWalks(world: World, mb: MeshBuilder, out: WalkBuild) {
  for (const e of world.edges.values()) {
    const a = world.nodes.get(e.a), b = world.nodes.get(e.b);
    if (!a || !b) continue;
    mb.setOwner(`w:e:${e.id}`);
    edgeMesh(world, mb, e, a, b, out);
  }
  for (const n of world.nodes.values()) {
    mb.setOwner(`w:n:${n.id}`);
    nodeMesh(world, mb, n, out);
  }
}

/** Where the deck from n toward `to` reaches the edge of a grotto quay n sits on (null if n isn't on one). */
function quayTrim(world: World, n: WalkNode, to: WalkNode | undefined) {
  const t = grottoTieAt(world, n.x, n.z); if (!t) return null;
  if (t.legacy || !to) return 0;
  const L = Math.hypot(to.x - n.x, to.z - n.z) || 1, ux = (to.x - n.x) / L, uz = (to.z - n.z) / L;
  const c = Math.cos(t.rot), s = Math.sin(t.rot), a = Math.abs(ux * c + uz * s), b = Math.abs(-ux * s + uz * c);
  return t.half / Math.max(a, b, 1e-3) - 0.03;
}

function trimFor(world: World, n: WalkNode, w: number, e?: WalkEdge) {
  const q = quayTrim(world, n, e && world.nodes.get(e.a === n.id ? e.b : e.a));
  if (q !== null) return q;
  if (n.pad > 0) return n.pad * 0.92;
  if (groundRopeJoint(world, n)) return 0;
  const j = jointOf(world, n);
  // running straight on: the decks overrun the post a touch so a slight kink leaves no gap
  if (j === "through") return -(w / 2) * Math.tan((Math.PI - junctionAngle(world, n)) / 2) - 0.01;
  if (j === "square") return jointHalf(world, n) - 0.01;
  if (j === "bend") return bendKite(world, n).t - 0.01;
  if (j === "landing") return Math.max((w / 2) * 0.55, junctionTrim(world, n));
  return 0;
}
const jointHalf = (world: World, n: WalkNode) => world.edgesOf(n.id).reduce((m, e) => Math.max(m, e.width), WALK_W) / 2;

function post(world: World, mb: MeshBuilder, x: number, z: number, top: number, out: WalkBuild, r = 0.075) {
  const g = world.height(Math.min(N, Math.max(0, x)), Math.min(N, Math.max(0, z)));
  if (top - g < 0.15) return;
  mb.paint(hexRGB(TAR), M.plank);
  mb.cyl(x, z, g - 0.35, top, r, r * 0.88, 7, true, hsh(x * 3 + z * 7));
  if (g < WATER_Y) out.foam.push({ x, z, r: r * 0.6 });
}

function ropeLine(mb: MeshBuilder, a: V3, b: V3, sag: number, r = 0.02) {
  const pts: V3[] = [];
  for (let i = 0; i <= 10; i++) { const t = i / 10; const p = lerp3(a, b, t); pts.push([p[0], p[1] - Math.sin(Math.PI * t) * sag, p[2]]); }
  mb.paint(hexRGB("#b89a70"), M.cloth);
  mb.tube(pts, r, 4);
}

function edgeMesh(world: World, mb: MeshBuilder, e: WalkEdge, A: WalkNode, B: WalkNode, out: WalkBuild) {
  const dx = B.x - A.x, dz = B.z - A.z, L = Math.hypot(dx, dz);
  if (L < 0.05) return;
  const u: V3 = [dx / L, 0, dz / L], s: V3 = [-u[2], 0, u[0]];
  const w = e.width, hw = w / 2;
  const tA = trimFor(world, A, w, e), tB = trimFor(world, B, w, e);
  const s0 = tA, s1 = L - tB;
  if (s1 - s0 < 0.02) return;
  const yAt = (d: number) => A.y + (B.y - A.y) * (d / L);
  const P = (d: number, off: number, y: number): V3 => [A.x + u[0] * d + s[0] * off, y, A.z + u[2] * d + s[2] * off];
  const r0 = hsh(e.id.length * 7.1 + A.x * 3.3 + B.z * 1.7);

  if (e.style === "rope") {
    const sag = Math.min(0.9, 0.06 * L + 0.05);
    const deckY = (d: number) => yAt(d) - Math.sin(Math.PI * (d - s0) / (s1 - s0)) * sag;
    const ground = (d: number, off: number) => {
      const p = P(d, off, 0);
      return world.height(Math.min(N - 0.01, Math.max(0.01, p[0])), Math.min(N - 0.01, Math.max(0.01, p[2])));
    };
    const floating = (d: number) => deckY(d) - Math.max(ground(d, 0), ground(d, -hw * 0.85), ground(d, hw * 0.85)) > 0.28;
    const railY = (d: number, side: number) => Math.max(yAt(d) + 0.95 - Math.sin(Math.PI * (d - s0) / (s1 - s0)) * sag * 0.85, ground(d, side * hw * 0.85) + 0.85);
    const n = Math.max(2, Math.ceil((s1 - s0) / 0.3));
    for (let i = 0; i < n; i++) {
      const d = s0 + (i + 0.5) * (s1 - s0) / n;
      if (!floating(d - 0.1) || !floating(d) || !floating(d + 0.1)) continue;
      mb.paint(hexRGB(DECK, 0.85 + hsh(i * 3.7 + r0) * 0.25), M.plank);
      mb.beam(P(d, -hw * 0.85, deckY(d) - 0.03), P(d, hw * 0.85, deckY(d) - 0.03), u, 0.1, 0.025);
    }
    for (const side of [-1, 1]) {
      const off = side * hw * 0.85;
      for (const d of [s0, s1]) {
        const p = P(d, off, 0), g = ground(d, off);
        mb.paint(hexRGB(TAR), M.plank);
        mb.cyl(p[0], p[2], Math.min(g - 0.2, yAt(d) - 0.4), railY(d, side) + 0.1, 0.07, 0.06, 7);
      }
      // On land the rope becomes a railing; only suspended sections need slats, base rope and hangers.
      const posts = Math.max(1, Math.ceil((s1 - s0) / 1.3));
      for (let i = 1; i < posts; i++) {
        const d = s0 + (s1 - s0) * i / posts;
        if (floating(d)) continue;
        const p = P(d, off, 0);
        mb.paint(hexRGB(TAR), M.plank);
        mb.cyl(p[0], p[2], ground(d, off) - 0.15, railY(d, side) + 0.1, 0.055, 0.05, 7);
      }
      const steps = Math.max(10, Math.ceil((s1 - s0) / 0.15));
      const top: V3[] = [];
      for (let i = 0; i <= steps; i++) {
        const d = s0 + (s1 - s0) * i / steps;
        top.push(P(d, off, railY(d, side)));
      }
      mb.paint(hexRGB("#b89a70"), M.cloth);
      mb.tube(top, 0.025, 4);
      for (let i = 0; i < n; i++) {
        const da = s0 + (s1 - s0) * i / n, db = s0 + (s1 - s0) * (i + 1) / n;
        if (!floating(da) || !floating((da + db) / 2) || !floating(db)) continue;
        mb.tube([P(da, off, deckY(da) - 0.06), P(db, off, deckY(db) - 0.06)], 0.022, 4);
      }
      for (let i = 1; i < 6; i++) {
        const d = s0 + (s1 - s0) * i / 6;
        if (!floating(d)) continue;
        mb.paint(hexRGB("#b89a70"), M.cloth);
        mb.beam(P(d, off, deckY(d) - 0.05), P(d, off, railY(d, side)), u, 0.008, 0.008, false);
      }
    }
    return;
  }

  const stairs = isStairs(A, B);
  if (stairs) {
    const rise = B.y - A.y;
    const n = Math.max(2, Math.ceil(Math.abs(rise) / 0.21));
    for (let i = 0; i < n; i++) {
      const d0 = s0 + (s1 - s0) * i / n, d1 = s0 + (s1 - s0) * (i + 1) / n;
      const y = A.y + rise * ((i + 0.5) / n) + rise / n * 0.5 * Math.sign(rise) * 0;
      const ty = rise > 0 ? A.y + rise * (i + 1) / n : A.y + rise * i / n;
      mb.paint(hexRGB(DECK, 0.85 + hsh(i * 5.3 + r0) * 0.2), M.plank);
      mb.beam(P((d0 + d1) / 2, -hw * 0.9, ty - 0.03), P((d0 + d1) / 2, hw * 0.9, ty - 0.03), u, (d1 - d0) / 2 + 0.02, 0.03);
      void y;
    }
    mb.paint(hexRGB("#6b4a33"), M.plank);
    for (const side of [-1, 1]) mb.beam(P(s0, side * hw, A.y - 0.1), P(s1, side * hw, B.y - 0.1), [0, 1, 0], 0.04, 0.1);
  } else {
    // deck boards across the walkway
    const n = Math.max(1, Math.floor((s1 - s0) / 0.21));
    const bw = (s1 - s0) / n;
    for (let i = 0; i < n; i++) {
      const d = s0 + (i + 0.5) * bw;
      const y = yAt(d) + (hsh(i * 1.3 + r0 * 10) - 0.5) * 0.012;
      const tone = 0.8 + hsh(i * 7.9 + r0 * 3) * 0.3;
      const ofs = (hsh(i * 2.1 + r0) - 0.5) * 0.06;
      mb.paint(hexRGB(DECK, tone), M.plank);
      mb.beam(P(d, -hw + ofs, y - 0.03), P(d, hw + ofs, y - 0.03), u, bw / 2 - 0.012, 0.03);
    }
    // stringers
    mb.paint(hexRGB("#6b4a33"), M.plank);
    for (const side of [-0.8, 0.8]) mb.beam(P(s0, side * hw, yAt(s0) - 0.13), P(s1, side * hw, yAt(s1) - 0.13), [0, 1, 0], 0.05, 0.06);
  }
  // posts in pairs, with a cross beam
  const np = Math.max(1, Math.round((s1 - s0) / 1.3));
  const high = Math.max(A.y, B.y) - Math.max(WATER_Y, Math.min(world.height(A.x, A.z), world.height(B.x, B.z)));
  const rail = e.rail || high > 1.5;
  for (let i = 0; i <= np; i++) {
    const d = s0 + (s1 - s0) * i / np;
    // at a junction end the landing carries the deck, but a rope rail still needs a post to tie off to
    const endAtLanding = (i === 0 && tA > 0) || (i === np && tB > 0);
    if (endAtLanding && !rail) continue;
    // where a walkway runs straight on, the first of its two edges carries the shared pair of posts
    const endNode = i === 0 ? A : i === np ? B : null;
    if (endNode && (i === 0 ? tA : tB) < 0 && world.edgesOf(endNode.id)[0]?.id !== e.id) continue;
    const y = stairs ? Math.min(A.y, B.y) + Math.abs(B.y - A.y) * (B.y > A.y ? d / L : 1 - d / L) : yAt(d);
    for (const side of [-1, 1]) {
      const p = P(d, side * (hw - 0.02), 0);
      post(world, mb, p[0], p[2], y - 0.06 + (rail ? 0.72 : 0), out);
    }
    const g = Math.min(world.height(P(d, -hw, 0)[0], P(d, -hw, 0)[2]), world.height(P(d, hw, 0)[0], P(d, hw, 0)[2]));
    if (y - g > 0.5) { mb.paint(hexRGB("#6b4a33"), M.plank); mb.beam(P(d, -hw, y - 0.22), P(d, hw, y - 0.22), u, 0.04, 0.05); }
    if (y - Math.max(g, WATER_Y) > 1.2 && i < np) {
      // X bracing between post pairs on tall stretches
      const d2 = s0 + (s1 - s0) * (i + 1) / np;
      const y2 = stairs ? y : yAt(d2);
      const lo = Math.max(g, WATER_Y - 0.1) + 0.2;
      mb.paint(hexRGB("#6b4a33", 0.85), M.plank);
      for (const side of [-1, 1]) mb.beam(P(d, side * hw, lo), P(d2, side * hw, Math.min(y, y2) - 0.3), s, 0.025, 0.03);
    }
  }
  if (rail) {
    for (const side of [-1, 1]) {
      for (let i = 0; i < np; i++) {
        const da = s0 + (s1 - s0) * i / np, db = s0 + (s1 - s0) * (i + 1) / np;
        const ya = stairs ? A.y + (B.y - A.y) * (da / L) : yAt(da), yb = stairs ? A.y + (B.y - A.y) * (db / L) : yAt(db);
        ropeLine(mb, P(da, side * (hw - 0.02), ya + 0.62), P(db, side * (hw - 0.02), yb + 0.62), 0.06);
      }
    }
  }
}

function nodeMesh(world: World, mb: MeshBuilder, n: WalkNode, out: WalkBuild) {
  const es = world.edgesOf(n.id);
  if (!es.length && n.pad <= 0) return;
  // tied on to a grotto quay: the quay is the landing
  if (grottoTieAt(world, n.x, n.z)) return;
  const w = es.reduce((m, e) => Math.max(m, e.width), WALK_W);
  const deg = es.length;
  const other = es.map(e => world.nodes.get(e.a === n.id ? e.b : e.a)).filter(Boolean) as WalkNode[];
  const ang = other.length ? Math.atan2(other[0].z - n.z, other[0].x - n.x) : 0;
  if (n.pad > 0) {
    // a square platform
    const c = Math.cos(ang), s = Math.sin(ang), P = n.pad;
    const nb = Math.max(2, Math.floor(P * 2 / 0.21));
    for (let i = 0; i < nb; i++) {
      const d = -P + (i + 0.5) * (2 * P / nb);
      mb.paint(hexRGB(DECK, 0.8 + hsh(i * 3.1 + n.x) * 0.3), M.plank);
      mb.beam([n.x + c * d - s * -P, n.y - 0.03, n.z + s * d + c * -P], [n.x + c * d - s * P, n.y - 0.03, n.z + s * d + c * P], [c, 0, s], P / nb - 0.012, 0.03);
    }
    for (const [i, j] of [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, -1], [0, 1], [-1, 0], [1, 0]]) {
      if ((i === 0 || j === 0) && P < 1.4) continue;
      post(world, mb, n.x + c * i * (P - 0.08) - s * j * (P - 0.08), n.z + s * i * (P - 0.08) + c * j * (P - 0.08), n.y - 0.06, out, 0.085);
    }
    if (hsh(n.x * 1.7 + n.z * 2.3) < 0.8) lanternPost(mb, n.x + c * (P - 0.2) - s * (P - 0.2), n.z + s * (P - 0.2) + c * (P - 0.2), n.y, out);
    return;
  }
  if (groundRopeJoint(world, n)) return;
  const joint = jointOf(world, n);
  if (joint === "through") return;
  if (joint === "bend") {
    const k = bendKite(world, n).pts, y = n.y;
    mb.paint(hexRGB(DECK, 0.92), M.plank);
    mb.quad(k.map(([x, z]) => [x, y, z] as V3), [0, 1, 0]);
    mb.paint(hexRGB("#6b4a33"), M.plank);
    for (let i = 0; i < 4; i++) { const [a, b] = [k[i], k[(i + 1) % 4]]; mb.quad([[a[0], y, a[1]], [b[0], y, b[1]], [b[0], y - 0.06, b[1]], [a[0], y - 0.06, a[1]]], [(a[0] + b[0]) / 2 - n.x, 0, (a[1] + b[1]) / 2 - n.z]); }
    for (const i of [0, 2]) { const dx = n.x - k[i][0], dz = n.z - k[i][1], d = Math.hypot(dx, dz); post(world, mb, k[i][0] + dx / d * 0.08, k[i][1] + dz / d * 0.08, n.y - 0.06, out); }
    return;
  }
  if (joint === "square") {
    // a plain square of boards where walkways meet at right angles, laid across the first one
    const c = Math.cos(ang), s = Math.sin(ang), P = jointHalf(world, n);
    const nb = Math.max(2, Math.round(P * 2 / 0.21));
    for (let i = 0; i < nb; i++) {
      const d = -P + (i + 0.5) * (2 * P / nb);
      mb.paint(hexRGB(DECK, 0.8 + hsh(i * 3.1 + n.x) * 0.3), M.plank);
      mb.beam([n.x + c * d - s * -P, n.y - 0.03, n.z + s * d + c * -P], [n.x + c * d - s * P, n.y - 0.03, n.z + s * d + c * P], [c, 0, s], P / nb - 0.012, 0.03);
    }
    for (const [i, j] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) post(world, mb, n.x + c * i * (P - 0.02) - s * j * (P - 0.02), n.z + s * i * (P - 0.02) + c * j * (P - 0.02), n.y - 0.06, out);
    return;
  }
  if (joint === "landing") {
    // an octagonal landing, big enough that the decks coming in at sharp angles all reach it
    const R = landingRadius(world, n);
    mb.paint(hexRGB(DECK, 0.95), M.plank);
    mb.cyl(n.x, n.z, n.y - 0.06, n.y, R, R, 8, true, ang + Math.PI / 8);
    mb.paint(hexRGB("#6b4a33"), M.plank);
    mb.cyl(n.x, n.z, n.y - 0.2, n.y - 0.06, R * 0.92, R * 0.92, 8, false, ang + Math.PI / 8);
    const np = R > 1.1 ? 8 : 4;
    for (let k = 0; k < np; k++) {
      const a = ang + Math.PI / np + k * 2 * Math.PI / np;
      post(world, mb, n.x + Math.cos(a) * R * 0.8, n.z + Math.sin(a) * R * 0.8, n.y - 0.06, out);
    }
    if (R > 1.1) post(world, mb, n.x, n.z, n.y - 0.06, out, 0.09);
    return;
  }
  if (deg === 1) {
    const o = other[0];
    const g = world.height(n.x, n.z);
    const ux = Math.cos(ang), uz = Math.sin(ang);
    const sx = -uz, sz = ux;
    // end posts
    for (const side of [-1, 1]) post(world, mb, n.x + sx * side * (w / 2 - 0.02) + ux * 0.1, n.z + sz * side * (w / 2 - 0.02) + uz * 0.1, n.y - 0.06, out);
    const door = doorOf(world, n);
    if (door) {
      // a door: the deck runs on to the wall as a threshold
      const [nx, nz] = door.line.n, tx = -nz, tz = nx, d = Math.max(0.05, door.hit.d);
      const nb = Math.max(1, Math.ceil(d / 0.21)), bw = d / nb;
      for (let i = 0; i < nb; i++) {
        const o = (i + 0.5) * bw;
        const cx = n.x - nx * o, cz = n.z - nz * o;
        mb.paint(hexRGB(DECK, 0.8 + hsh(i * 4.3 + n.x * 2.1 + n.z) * 0.3), M.plank);
        mb.beam([cx - tx * w / 2, n.y - 0.03, cz - tz * w / 2], [cx + tx * w / 2, n.y - 0.03, cz + tz * w / 2], [nx, 0, nz], bw / 2 - 0.012, 0.03);
      }
    } else if (g < WATER_Y - 0.2) {
      // pier end: bollards, a ladder down to the water, often a lantern
      mb.paint(hexRGB("#3b332c"), M.metal);
      for (const side of [-1, 1]) mb.cyl(n.x + sx * side * (w / 2 - 0.16) + ux * 0.18, n.z + sz * side * (w / 2 - 0.16) + uz * 0.18, n.y, n.y + 0.22, 0.07, 0.06, 7);
      mb.paint(hexRGB("#6b4a33"), M.plank);
      const lx = n.x - ux * 0.05, lz = n.z - uz * 0.05;
      for (const side of [-1, 1]) mb.beam([lx + sx * side * 0.18, WATER_Y - 0.4, lz + sz * side * 0.18], [lx + sx * side * 0.18, n.y + 0.4, lz + sz * side * 0.18], [ux, 0, uz], 0.025, 0.025);
      for (let y = WATER_Y - 0.2; y < n.y + 0.3; y += 0.25) mb.beam([lx - sx * 0.18, y, lz - sz * 0.18], [lx + sx * 0.18, y, lz + sz * 0.18], [0, 1, 0], 0.015, 0.015);
      if (hsh(n.x * 3.7 + n.z * 1.1) < 0.7) lanternPost(mb, n.x + sx * (w / 2 - 0.12) + ux * 0.3, n.z + sz * (w / 2 - 0.12) + uz * 0.3, n.y, out);
    }
    void o;
  }
}

export function lanternPost(mb: MeshBuilder, x: number, z: number, y: number, out: { lights: Light[] }) {
  mb.paint(hexRGB("#5a4231"), M.plank);
  mb.cyl(x, z, y - 0.05, y + 1.35, 0.045, 0.04, 6);
  mb.beam([x, y + 1.3, z], [x + 0.28, y + 1.3, z], [0, 0, 1], 0.025, 0.025);
  mb.paint(hexRGB("#2e2a26"), M.metal);
  mb.box([x + 0.18, y + 1.12, z - 0.08], [x + 0.34, y + 1.15, z + 0.08]);
  mb.paint(hexRGB("#ffd08a"), M.lamp);
  mb.box([x + 0.2, y + 0.95, z - 0.06], [x + 0.32, y + 1.12, z + 0.06]);
  out.lights.push({ x: x + 0.26, y: y + 1.0, z, r: 3.0, i: 0.85 });
}
void add; void scl;
