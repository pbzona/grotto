import * as THREE from "three/webgpu";

export type V3 = [number, number, number];
/** Pattern ids read by the building shader. */
export const M = { plain: 0, plaster: 1, plank: 2, tile: 4, stone: 5, glass: 6, lamp: 7, cloth: 8, metal: 9, leaf: 10, rock: 11, unlit: 12 } as const;

export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scl = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
export const norm = (a: V3): V3 => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
export const lerp3 = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

export function rng(seed: number) {
  let s = (Math.floor(seed * 2654435761) >>> 0) || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}
export const hsh = (x: number) => { const v = Math.sin(x * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };

const tmpC = new THREE.Color();
export function hexRGB(h: string | number, mul = 1): V3 { tmpC.set(h as any); return [tmpC.r * mul, tmpC.g * mul, tmpC.b * mul]; }

/** Accumulates triangles with colour + pattern id + world-unit uvs. `owner` tags triangles for picking. */
export class MeshBuilder {
  pos: number[] = []; nrm: number[] = []; col: number[] = []; mat: number[] = []; uv: number[] = [];
  idx: number[] = []; triOwner: number[] = [];
  owners: string[] = [];
  owner = -1;
  c: V3 = [1, 1, 1];
  m = 0;
  /** optional vertex transform (e.g. a house's lean) */
  xf: ((p: V3) => V3) | null = null;

  setOwner(key: string) { const i = this.owners.indexOf(key); if (i >= 0) { this.owner = i; return; } this.owner = this.owners.length; this.owners.push(key); }
  paint(c: V3, m: number) { this.c = c; this.m = m; return this; }

  private v(p: V3, n: V3, u: number, w: number) {
    const q = this.xf ? this.xf(p) : p;
    this.pos.push(q[0], q[1], q[2]); this.nrm.push(n[0], n[1], n[2]);
    this.col.push(this.c[0], this.c[1], this.c[2]); this.mat.push(this.m); this.uv.push(u, w);
  }
  /** Quad p0..p3 (any winding); faces `out` if given. uv defaults to world-unit planar mapping. */
  quad(p: V3[], out?: V3, uv?: [number, number][]) {
    let n = norm(cross(sub(p[1], p[0]), sub(p[3], p[0])));
    if (out && dot(n, out) < 0) { p = [p[0], p[3], p[2], p[1]]; if (uv) uv = [uv[0], uv[3], uv[2], uv[1]]; n = scl(n, -1); }
    if (!uv) uv = planarUV(p, n);
    const b = this.pos.length / 3;
    for (let i = 0; i < 4; i++) this.v(p[i], n, uv[i][0], uv[i][1]);
    this.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    this.triOwner.push(this.owner, this.owner);
  }
  tri(p: V3[], out?: V3, uv?: [number, number][]) {
    let n = norm(cross(sub(p[1], p[0]), sub(p[2], p[0])));
    if (out && dot(n, out) < 0) { p = [p[0], p[2], p[1]]; if (uv) uv = [uv[0], uv[2], uv[1]]; n = scl(n, -1); }
    if (!uv) uv = planarUV(p, n);
    const b = this.pos.length / 3;
    for (let i = 0; i < 3; i++) this.v(p[i], n, uv[i][0], uv[i][1]);
    this.idx.push(b, b + 1, b + 2);
    this.triOwner.push(this.owner);
  }
  /** Axis-aligned box; `skip` omits faces (+x,-x,+y,-y,+z,-z). */
  box(min: V3, max: V3, skip = "") {
    const [x0, y0, z0] = min, [x1, y1, z1] = max;
    if (!skip.includes("+z")) this.quad([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [0, 0, 1]);
    if (!skip.includes("-z")) this.quad([[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], [0, 0, -1]);
    if (!skip.includes("+x")) this.quad([[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], [1, 0, 0]);
    if (!skip.includes("-x")) this.quad([[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], [-1, 0, 0]);
    if (!skip.includes("+y")) this.quad([[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], [0, 1, 0]);
    if (!skip.includes("-y")) this.quad([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], [0, -1, 0]);
  }
  /** Oriented box from a centre line a→b, with a width axis `side` (half extents hw, hh). */
  beam(a: V3, b: V3, side: V3, hw: number, hh: number, caps = true) {
    const d = norm(sub(b, a));
    const s = norm(side);
    const u = norm(cross(d, s));
    const S = scl(s, hw), Uu = scl(u, hh);
    const c = (p: V3, i: number, j: number): V3 => add(add(p, scl(S, i)), scl(Uu, j));
    const L = len(sub(b, a));
    const faces: [V3[], V3][] = [
      [[c(a, -1, 1), c(b, -1, 1), c(b, 1, 1), c(a, 1, 1)], Uu],
      [[c(a, 1, -1), c(b, 1, -1), c(b, -1, -1), c(a, -1, -1)], scl(Uu, -1)],
      [[c(a, 1, 1), c(b, 1, 1), c(b, 1, -1), c(a, 1, -1)], S],
      [[c(a, -1, -1), c(b, -1, -1), c(b, -1, 1), c(a, -1, 1)], scl(S, -1)],
    ];
    for (const [p, o] of faces) this.quad(p, o, [[0, 0], [L, 0], [L, 0.2], [0, 0.2]]);
    if (caps) {
      this.quad([c(b, -1, -1), c(b, 1, -1), c(b, 1, 1), c(b, -1, 1)], d);
      this.quad([c(a, -1, -1), c(a, -1, 1), c(a, 1, 1), c(a, 1, -1)], scl(d, -1));
    }
  }
  /** Vertical prism (n sides) — posts, barrels, towers. */
  cyl(cx: number, cz: number, y0: number, y1: number, r0: number, r1 = r0, n = 7, caps = true, phase = 0) {
    for (let i = 0; i < n; i++) {
      const a0 = phase + (i / n) * Math.PI * 2, a1 = phase + ((i + 1) / n) * Math.PI * 2;
      const p: V3[] = [
        [cx + Math.cos(a0) * r0, y0, cz + Math.sin(a0) * r0], [cx + Math.cos(a1) * r0, y0, cz + Math.sin(a1) * r0],
        [cx + Math.cos(a1) * r1, y1, cz + Math.sin(a1) * r1], [cx + Math.cos(a0) * r1, y1, cz + Math.sin(a0) * r1],
      ];
      const am = (a0 + a1) / 2;
      const arc = Math.PI * 2 * r0 / n;
      this.quad(p, [Math.cos(am), 0, Math.sin(am)], [[i * arc, y0], [(i + 1) * arc, y0], [(i + 1) * arc, y1], [i * arc, y1]]);
      if (caps) {
        this.tri([[cx, y1, cz], p[3], p[2]], [0, 1, 0]);
        if (y0 > -50) this.tri([[cx, y0, cz], p[1], p[0]], [0, -1, 0]);
      }
    }
  }
  /** A tube along a polyline (ropes, trunks, hull ribs). */
  tube(pts: V3[], r: number | ((t: number) => number), n = 5) {
    const R = typeof r === "number" ? () => r : r;
    const frames: V3[][] = [];
    for (let i = 0; i < pts.length; i++) {
      const d = norm(sub(pts[Math.min(pts.length - 1, i + 1)], pts[Math.max(0, i - 1)]));
      let s = cross(d, [0, 1, 0]); if (len(s) < 0.1) s = cross(d, [1, 0, 0]); s = norm(s);
      const u = norm(cross(s, d));
      const rr = R(i / (pts.length - 1));
      const ring: V3[] = [];
      for (let k = 0; k < n; k++) { const a = (k / n) * Math.PI * 2; ring.push(add(pts[i], add(scl(s, Math.cos(a) * rr), scl(u, Math.sin(a) * rr)))); }
      frames.push(ring);
    }
    for (let i = 0; i < pts.length - 1; i++) for (let k = 0; k < n; k++) {
      const k1 = (k + 1) % n;
      const a = frames[i][k], b = frames[i][k1], c = frames[i + 1][k1], d = frames[i + 1][k];
      const mid = lerp3(lerp3(a, b, 0.5), lerp3(c, d, 0.5), 0.5);
      this.quad([a, b, c, d], sub(mid, lerp3(pts[i], pts[i + 1], 0.5)));
    }
  }
  /** A lumpy blob (bushes, rocks). */
  blob(c: V3, r: V3, seed: number, detail = 1) {
    const ico = icoCache(detail);
    const R = rng(seed);
    const off = new Array(ico.unique).fill(0).map(() => 0.8 + R() * 0.35);
    for (let i = 0; i < ico.pos.length; i += 9) {
      const t: V3[] = [];
      for (let j = 0; j < 3; j++) { const q = i / 3 + j; const o = off[ico.vid[q]]; t.push([c[0] + ico.pos[q * 3] * r[0] * o, c[1] + ico.pos[q * 3 + 1] * r[1] * o, c[2] + ico.pos[q * 3 + 2] * r[2] * o]); }
      const m = lerp3(lerp3(t[0], t[1], 0.5), t[2], 1 / 3);
      this.tri(t, sub(m, c));
    }
  }

  get empty() { return this.idx.length === 0; }
  /** Freeze into typed arrays for fast merging. */
  freeze(): Part {
    return { pos: new Float32Array(this.pos), nrm: new Float32Array(this.nrm), col: new Float32Array(this.col), mat: new Float32Array(this.mat), uv: new Float32Array(this.uv), idx: new Uint32Array(this.idx), triOwner: new Int32Array(this.triOwner), owners: this.owners.slice() };
  }
  /** Merge another builder's triangles in (owners are remapped by key). */
  append(o: MeshBuilder) {
    const base = this.pos.length / 3;
    for (let i = 0; i < o.pos.length; i++) this.pos.push(o.pos[i]);
    for (let i = 0; i < o.nrm.length; i++) this.nrm.push(o.nrm[i]);
    for (let i = 0; i < o.col.length; i++) this.col.push(o.col[i]);
    for (let i = 0; i < o.mat.length; i++) this.mat.push(o.mat[i]);
    for (let i = 0; i < o.uv.length; i++) this.uv.push(o.uv[i]);
    for (let i = 0; i < o.idx.length; i++) this.idx.push(o.idx[i] + base);
    const remap = o.owners.map(k => { this.setOwner(k); return this.owner; });
    for (let i = 0; i < o.triOwner.length; i++) this.triOwner.push(o.triOwner[i] < 0 ? -1 : remap[o.triOwner[i]]);
  }
  toGeometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute("mat", new THREE.Float32BufferAttribute(this.mat, 1));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx);
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }
}

function planarUV(p: V3[], n: V3): [number, number][] {
  const ax = Math.abs(n[0]), ay = Math.abs(n[1]), az = Math.abs(n[2]);
  if (ay >= ax && ay >= az) return p.map(q => [q[0], q[2]] as [number, number]);
  if (ax >= az) return p.map(q => [q[2], q[1]] as [number, number]);
  return p.map(q => [q[0], q[1]] as [number, number]);
}

const _ico = new Map<number, { pos: number[]; vid: number[]; unique: number }>();
/** Unit icosphere triangles with a shared-vertex id per corner, built once per detail level. */
function icoCache(detail: number) {
  let c = _ico.get(detail);
  if (c) return c;
  const g = new THREE.IcosahedronGeometry(1, detail);
  const P = g.getAttribute("position");
  const ids = new Map<string, number>();
  const pos: number[] = [], vid: number[] = [];
  for (let i = 0; i < P.count; i++) {
    const k = `${P.getX(i).toFixed(3)},${P.getY(i).toFixed(3)},${P.getZ(i).toFixed(3)}`;
    if (!ids.has(k)) ids.set(k, ids.size);
    pos.push(P.getX(i), P.getY(i), P.getZ(i)); vid.push(ids.get(k)!);
  }
  g.dispose();
  c = { pos, vid, unique: ids.size };
  _ico.set(detail, c);
  return c;
}

export interface Part { pos: Float32Array; nrm: Float32Array; col: Float32Array; mat: Float32Array; uv: Float32Array; idx: Uint32Array; triOwner: Int32Array; owners: string[] }
/** Concatenate frozen parts into one geometry; owners are merged by key. */
export function mergeParts(parts: Part[]) {
  let nv = 0, ni = 0, nt = 0;
  for (const p of parts) { nv += p.pos.length / 3; ni += p.idx.length; nt += p.triOwner.length; }
  const pos = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3), col = new Float32Array(nv * 3), mat = new Float32Array(nv), uv = new Float32Array(nv * 2);
  const idx = new Uint32Array(ni), triOwner = new Int32Array(nt);
  const owners: string[] = [], ownerIdx = new Map<string, number>();
  let v = 0, i = 0, t = 0;
  for (const p of parts) {
    pos.set(p.pos, v * 3); nrm.set(p.nrm, v * 3); col.set(p.col, v * 3); mat.set(p.mat, v); uv.set(p.uv, v * 2);
    for (let k = 0; k < p.idx.length; k++) idx[i + k] = p.idx[k] + v;
    const remap = p.owners.map(o => { let n = ownerIdx.get(o); if (n === undefined) { n = owners.length; owners.push(o); ownerIdx.set(o, n); } return n; });
    for (let k = 0; k < p.triOwner.length; k++) triOwner[t + k] = p.triOwner[k] < 0 ? -1 : remap[p.triOwner[k]];
    v += p.pos.length / 3; i += p.idx.length; t += p.triOwner.length;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.setAttribute("mat", new THREE.BufferAttribute(mat, 1));
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingSphere(); g.computeBoundingBox();
  return { geometry: g, owners, triOwner };
}
