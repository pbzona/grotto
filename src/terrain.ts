import * as THREE from "three/webgpu";
import { N, WATER_Y, fbm, BASE_Y, levelY, grottoDims, grottoDome, type World, type GrottoDims } from "./world.ts";

export const RES = 4;              // mesh subdivisions per cell
export const GRID = N * RES + 1;   // vertices per side
const SKIRT_BOTTOM = BASE_Y - 1.2;

interface Vault { x: number; z: number; c: number; s: number; g: GrottoDims }

/** Terrain mesh + the data textures the shaders read (paint weights, water depth / foam). */
export class Terrain {
  mesh: THREE.Mesh;
  skirt: THREE.Mesh;
  seabed: THREE.Mesh;
  paintTex: THREE.DataTexture;
  /** r = depth below the water line (0..4 units), g = foam from things standing in the water */
  waterTex: THREE.DataTexture;
  private waterData: Uint8Array;
  private geo = new THREE.BufferGeometry();
  /** per vertex: 0 plain, 1 cut away over a grotto shell, 2 carved mouth, 3 restored ground over a vault */
  private kind = new Uint8Array(GRID * GRID);
  private vaults: Vault[] = [];
  private world: World;

  constructor(world: World, mat: THREE.Material, cliffMat: THREE.Material) {
    this.world = world;
    const pos = new Float32Array(GRID * GRID * 3);
    this.geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.receiveShadow = true; this.mesh.castShadow = true;
    this.skirt = new THREE.Mesh(new THREE.BufferGeometry(), cliffMat);
    this.skirt.receiveShadow = true;
    this.seabed = new THREE.Mesh(new THREE.BufferGeometry(), mat);
    this.seabed.receiveShadow = true;
    this.seabed.visible = false;

    this.paintTex = new THREE.DataTexture(world.paint, N, N, THREE.RGBAFormat);
    this.paintTex.magFilter = this.paintTex.minFilter = THREE.LinearFilter;
    this.waterData = new Uint8Array(GRID * GRID * 4);
    this.waterTex = new THREE.DataTexture(this.waterData, GRID, GRID, THREE.RGBAFormat);
    this.waterTex.magFilter = this.waterTex.minFilter = THREE.LinearFilter;
    this.waterTex.wrapS = this.waterTex.wrapT = THREE.ClampToEdgeWrapping;
    this.rebuild();
  }

  rebuild() {
    const w = this.world;
    const pos = this.geo.getAttribute("position") as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    const e = 0.18;
    this.vaults = [...w.props.values()].filter(p => p.type === "grotto").map(p => ({ x: p.x, z: p.z, c: Math.cos(p.rot), s: Math.sin(p.rot), g: grottoDims(p) }));
    const kind = this.kind;
    for (let j = 0; j < GRID; j++) for (let i = 0; i < GRID; i++) {
      const x = i / RES, z = j / RES, k = j * GRID + i;
      const sf = this.surface(x, z);
      kind[k] = sf.kind;
      if (sf.kind) { arr[k * 3] = x; arr[k * 3 + 1] = sf.y; arr[k * 3 + 2] = z; }
    }
    for (let j = 0; j < GRID; j++) for (let i = 0; i < GRID; i++) {
      const x = i / RES, z = j / RES;
      const k0 = j * GRID + i;
      if (kind[k0]) {
        // restored ground right behind the mouth lines up with the rock brow instead of sloping into the opening
        if (kind[k0] === 3 && this.besideMouth(i, j)) this.toBrow(arr, k0, x, z);
        const depth = Math.max(0, WATER_Y - w.height(x, z));
        this.waterData[k0 * 4] = Math.min(255, Math.round(depth / 4 * 255)); this.waterData[k0 * 4 + 3] = 255;
        continue;
      }
      let y = w.height(x, z);
      // rocky faces: push steep vertices around with noise so cliffs read as weathered stone
      const gx = w.height(x + e, z) - w.height(x - e, z), gz = w.height(x, z + e) - w.height(x, z - e);
      const g = Math.hypot(gx, gz) / (2 * e);
      let px = x, pz = z;
      // only real cliffs get rocky jitter: measure the slope over a wider span so single terrace steps stay crisp
      const E = 0.75;
      const G = Math.hypot(w.height(x + E, z) - w.height(x - E, z), w.height(x, z + E) - w.height(x, z - E)) / (2 * E);
      if (g > 0.9 && G > 1.1 && i > 0 && j > 0 && i < GRID - 1 && j < GRID - 1) {
        const s = Math.min(1, (g - 0.9) / 2.5) * Math.min(1, (G - 1.1) / 1.2);
        const n1 = fbm(x * 1.7 + y * 0.9, z * 1.7 - y * 0.6) - 0.5, n2 = fbm(z * 1.9 + 40, x * 1.9 + y) - 0.5;
        px += n1 * 0.34 * s; pz += n2 * 0.34 * s;
        y += (fbm(x * 3.1, z * 3.1 + y) - 0.5) * 0.25 * s;
      }
      const k = j * GRID + i;
      arr[k * 3] = px; arr[k * 3 + 1] = y; arr[k * 3 + 2] = pz;
      const depth = Math.max(0, WATER_Y - w.height(x, z));
      this.waterData[k * 4] = Math.min(255, Math.round(depth / 4 * 255));
      this.waterData[k * 4 + 3] = 255;
    }
    pos.needsUpdate = true;
    this.geo.setIndex(this.indices());
    this.geo.computeVertexNormals();
    this.geo.computeBoundingSphere(); this.geo.computeBoundingBox();
    this.waterTex.needsUpdate = true;
    this.buildSkirt();
  }

  /** What the ground looks like at (x,z): over a grotto the vault's cliff is shown uncarved, and cut where the shell rises out of it. */
  surface(x: number, z: number): { y: number; kind: number } {
    const w = this.world;
    let y = w.height(x, z), kind = 0;
    for (const v of this.vaults) {
      const dx = x - v.x, dz = z - v.z, lx = dx * v.c + dz * v.s, lz = -dx * v.s + dz * v.c, { a, T, D } = v.g;
      if (lz > 1 || lz < -D - 3 || Math.abs(lx) > a + T + 3) continue;
      if (lz > -0.05) { if (Math.abs(lx) < a + 0.5 * T && !kind) kind = 2; continue; }
      const o = w.height(x, z, true);
      if (o <= y + 1e-3) continue;
      if (lz >= -D - 0.2 && o - WATER_Y < grottoDome(v.g, lx, lz)) { if (kind !== 3) kind = 1; continue; }
      kind = 3; y = Math.max(y, o);
    }
    return { y, kind };
  }
  /** Ground height a pointer should land on: the visible surface, or the carved floor where the terrain is cut away. */
  private shown(x: number, z: number) { if (!this.vaults.length) return this.world.height(x, z); const s = this.surface(x, z); return s.kind === 1 ? this.world.height(x, z) : s.y; }
  private besideMouth(i: number, j: number) {
    for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) {
      const ii = i + a, jj = j + b;
      if (ii >= 0 && jj >= 0 && ii < GRID && jj < GRID && this.kind[jj * GRID + ii] === 2) return true;
    }
    return false;
  }
  private toBrow(arr: Float32Array, k: number, x: number, z: number) {
    for (const v of this.vaults) {
      const dx = x - v.x, dz = z - v.z, lx = dx * v.c + dz * v.s, lz = -dx * v.s + dz * v.c;
      if (lz > 0.5 || lz < -1 || Math.abs(lx) > v.g.a + v.g.T + 1) continue;
      const bz = -0.08, wx = v.x + lx * v.c - bz * v.s, wz = v.z + lx * v.s + bz * v.c;
      arr[k * 3] = wx; arr[k * 3 + 2] = wz; arr[k * 3 + 1] = Math.max(arr[k * 3 + 1], this.world.height(wx, wz, true));
      return;
    }
  }
  private indices() {
    const kind = this.kind, idx: number[] = [], pos = this.geo.getAttribute("position") as THREE.BufferAttribute;
    const bedPos: number[] = [], bedIdx: number[] = [];
    const back = (p: number, q: number, r: number) => {
      const base = bedPos.length / 3;
      for (const k of [p, q, r]) bedPos.push(pos.getX(k), levelY(2) - 0.05, pos.getZ(k));
      bedIdx.push(base, base + 1, base + 2);
    };
    const ok = (p: number, q: number, r: number) => {
      // Keep the seabed beneath the cave floor. Omitting these triangles exposes a hole through clear water.
      if ([p, q, r].every(k => pos.getY(k) < WATER_Y - 0.03)) return true;
      const a = kind[p], b = kind[q], c = kind[r];
      if (a === 1 || b === 1 || c === 1) return false;
      const has2 = a === 2 || b === 2 || c === 2, has3 = a === 3 || b === 3 || c === 3;
      return !(has2 && has3);
    };
    for (let j = 0; j < GRID - 1; j++) for (let i = 0; i < GRID - 1; i++) {
      const a = j * GRID + i, b = a + 1, c = a + GRID, d = c + 1;
      const t = (i + j) % 2 ? [a, c, b, b, c, d] : [a, c, d, a, d, b];
      if (ok(t[0], t[1], t[2])) idx.push(t[0], t[1], t[2]);
      else if ([t[0], t[1], t[2]].some(k => pos.getY(k) < WATER_Y)) back(t[0], t[1], t[2]);
      if (ok(t[3], t[4], t[5])) idx.push(t[3], t[4], t[5]);
      else if ([t[3], t[4], t[5]].some(k => pos.getY(k) < WATER_Y)) back(t[3], t[4], t[5]);
    }
    const bed = new THREE.BufferGeometry();
    if (bedIdx.length) {
      bed.setAttribute("position", new THREE.Float32BufferAttribute(bedPos, 3));
      bed.setIndex(bedIdx);
      bed.computeVertexNormals(); bed.computeBoundingSphere();
    }
    this.seabed.geometry.dispose(); this.seabed.geometry = bed;
    this.seabed.visible = bedIdx.length > 0;
    return idx;
  }

  updatePaint() { this.paintTex.needsUpdate = true; }

  /** Foam rings where posts, hulls and stilts meet the water. */
  setFoam(points: { x: number; z: number; r: number }[]) {
    const d = this.waterData;
    for (let k = 0; k < GRID * GRID; k++) d[k * 4 + 1] = 0;
    for (const p of points) {
      const R = p.r + 0.3;
      const i0 = Math.max(0, Math.floor((p.x - R) * RES)), i1 = Math.min(GRID - 1, Math.ceil((p.x + R) * RES));
      const j0 = Math.max(0, Math.floor((p.z - R) * RES)), j1 = Math.min(GRID - 1, Math.ceil((p.z + R) * RES));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const dd = Math.hypot(i / RES - p.x, j / RES - p.z);
        const f = Math.max(0, 1 - Math.max(0, dd - p.r) / 0.3) * 0.8;
        const k = (j * GRID + i) * 4 + 1;
        d[k] = Math.max(d[k], Math.round(f * 255));
      }
    }
    this.waterTex.needsUpdate = true;
  }

  /** The cove's outer walls: sandstone dropping to the seabed. */
  private buildSkirt() {
    const w = this.world;
    const pos: number[] = [], nrm: number[] = [], idx: number[] = [];
    const edge: [number, number, number, number][] = [];
    const L = N * RES;
    for (let i = 0; i < L; i++) edge.push([i / RES, 0, 0, -1]);
    for (let j = 0; j < L; j++) edge.push([N, j / RES, 1, 0]);
    for (let i = L; i > 0; i--) edge.push([i / RES, N, 0, 1]);
    for (let j = L; j > 0; j--) edge.push([0, j / RES, -1, 0]);
    const n = edge.length;
    for (let e = 0; e < n; e++) {
      const [x0, z0, nx, nz] = edge[e], [x1, z1] = edge[(e + 1) % n];
      const y0 = w.height(Math.min(N - 1e-3, Math.max(1e-3, x0)), Math.min(N - 1e-3, Math.max(1e-3, z0)));
      const y1 = w.height(Math.min(N - 1e-3, Math.max(1e-3, x1)), Math.min(N - 1e-3, Math.max(1e-3, z1)));
      const b = pos.length / 3;
      pos.push(x0, y0, z0, x1, y1, z1, x1, SKIRT_BOTTOM, z1, x0, SKIRT_BOTTOM, z0);
      for (let q = 0; q < 4; q++) nrm.push(nx, 0, nz);
      idx.push(b, b + 2, b + 1, b, b + 3, b + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
    g.setIndex(idx);
    // make sure the faces point outward whichever winding the edge walk produced
    const t = new THREE.Vector3(), a = new THREE.Vector3(), c = new THREE.Vector3();
    t.set(pos[3] - pos[0], pos[4] - pos[1], pos[5] - pos[2]); a.set(pos[9] - pos[0], pos[10] - pos[1], pos[11] - pos[2]);
    c.crossVectors(a, t);
    if (c.z * edge[0][3] < 0) { for (let i = 0; i < idx.length; i += 3) { const s = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = s; } g.setIndex(idx); }
    this.skirt.geometry.dispose();
    this.skirt.geometry = g;
  }

  /** Ray vs heightfield: march then bisect. Returns the hit point or null. */
  raycast(ray: THREE.Ray, maxDist = 400): THREE.Vector3 | null {
    const w = this.world, p = new THREE.Vector3();
    let prev = 0, t = 0;
    const dt = 0.2;
    // start where the ray enters the column above the cove
    for (; t < maxDist; t += dt) {
      ray.at(t, p);
      if (p.x < -2 || p.z < -2 || p.x > N + 2 || p.z > N + 2) { if (t > 0 && p.y < -3) break; prev = t; continue; }
      const h = this.shown(Math.min(N, Math.max(0, p.x)), Math.min(N, Math.max(0, p.z)));
      if (p.y <= h) {
        let lo = prev, hi = t;
        for (let k = 0; k < 18; k++) { const m = (lo + hi) / 2; ray.at(m, p); const hm = this.shown(Math.min(N, Math.max(0, p.x)), Math.min(N, Math.max(0, p.z))); if (p.y <= hm) hi = m; else lo = m; }
        ray.at(hi, p);
        if (p.x < 0 || p.z < 0 || p.x > N || p.z > N) return null;
        return p;
      }
      prev = t;
    }
    return null;
  }
}
