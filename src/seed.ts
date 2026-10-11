import type { App } from "./app";
import { N, DECK_Y, WATER_Y, newVolume, uid, isLandmark, landmarkSamples, type RoofType, type PropType, type WalkNode } from "./world";
import { houseLayout, makeHouse } from "./houses";
import { fitLandmark } from "./landmarks";
import { rng } from "./mesh";
import { defaultDeckY, MAX_STAIR, slopeOf } from "./walks";

/**
 * Seeds a freshly generated cove with a small village: a straight pier from a beach with stilt houses
 * off square branches, a boardwalk along the shore with a house or two behind it, boats, clutter, and
 * a scatter of greenery. Every walkway runs along an axis; every house gets a door onto one.
 */
export function seedCove(app: App, seed: number) {
  const r = rng(seed * 7.31 + 0.13);
  seedVillage(app, r);
  seedProps(app, r);
  app.settleWalks(); app.easeStairs();
  const w = app.world;
  // a door the ground forced a too-steep flight onto: that house doesn't make the cut
  for (const e of [...w.edges.values()]) {
    const A = w.nodes.get(e.a), B = w.nodes.get(e.b); if (!A || !B || slopeOf(A, B) <= MAX_STAIR + 1e-6) continue;
    for (const d of [A, B]) {
      const h = w.edgesOf(d.id).length === 1 ? w.houseAt(d.x, d.z, 0.9) : null;
      if (h) { w.houses.delete(h.id); w.edges.delete(e.id); break; }
    }
  }
  for (const lm of [...w.props.values()].filter(p => isLandmark(p.type))) {
    const pts = landmarkSamples(lm);
    for (const o of [...w.props.values()]) if (!isLandmark(o.type) && pts.some(([x, z]) => Math.hypot(x - o.x, z - o.z) < 0.7)) w.props.delete(o.id);
  }
  w.pruneNodes();
}

const DIRS: [number, number][] = [[0, 1], [1, 0], [0, -1], [-1, 0]];
const ROOFS: RoofType[] = ["gable", "hip", "gable", "flat", "shed"];

interface Site { i: number; j: number; d: number; run: number; s: number }

function seedVillage(app: App, r: () => number) {
  const w = app.world;
  const lv = (i: number, j: number) => (i < 0 || j < 0 || i >= N || j >= N ? 0 : w.level(i, j));
  const wet = (i: number, j: number) => lv(i, j) <= 5;
  // --- pier sites: a beach cell with a long straight run of water in front of it ---
  const sites: Site[] = [];
  for (let j = 3; j < N - 3; j++) for (let i = 3; i < N - 3; i++) {
    const l = lv(i, j); if (l < 6 || l > 8) continue;
    for (let d = 0; d < 4; d++) {
      const [dx, dz] = DIRS[d];
      if (!wet(i + dx, j + dz) || wet(i - dx, j - dz)) continue;
      let run = 0;
      while (run < 14 && wet(i + dx * (run + 1), j + dz * (run + 1))) {
        const ii = i + dx * (run + 1), jj = j + dz * (run + 1);
        if (ii < 2 || jj < 2 || ii > N - 3 || jj > N - 3) break;
        run++;
      }
      if (run < 5) continue;
      // sheltered water (land around the pier head) and open beach to either side of the root
      let shelter = 0;
      const hx = i + dx * 6, hz = j + dz * 6;
      for (let b = -7; b <= 7; b += 2) for (let a = -7; a <= 7; a += 2) if (!wet(hx + a, hz + b)) shelter++;
      let shore = 0;
      for (let k = -5; k <= 5; k++) { const l2 = lv(i + dz * k, j + dx * k); if (l2 >= 6 && l2 <= 10) shore++; }
      sites.push({ i, j, d, run, s: Math.min(run, 11) + shelter * 0.12 + shore * 0.4 - Math.hypot(i - N / 2, j - N / 2) * 0.08 + r() * 1.5 });
    }
  }
  sites.sort((a, b) => b.s - a.s);
  // try the most promising few and keep the one that fits the most houses
  const tried = new Set<string>();
  let best: Site | null = null, most = 0;
  for (const site of sites) {
    if (tried.size >= 10) break;
    const key = `${site.d}:${Math.round(site.i / 3)}:${Math.round(site.j / 3)}`;
    if (tried.has(key)) continue;
    tried.add(key);
    const before = { h: new Set(w.houses.keys()), n: new Set(w.nodes.keys()), e: new Set(w.edges.keys()), p: new Set(w.props.keys()) };
    const n = buildVillage(app, site, r, false) + site.s * 0.01;
    for (const id of [...w.houses.keys()]) if (!before.h.has(id)) w.houses.delete(id);
    for (const id of [...w.edges.keys()]) if (!before.e.has(id)) w.edges.delete(id);
    for (const id of [...w.nodes.keys()]) if (!before.n.has(id)) w.nodes.delete(id);
    for (const id of [...w.props.keys()]) if (!before.p.has(id)) w.props.delete(id);
    if (n > most) { most = n; best = site; }
    if (n >= 5) break;
  }
  if (best && most >= 1) buildVillage(app, best, r, true);
}

/** Lay a village out from a pier site; returns how many houses it fitted. `dress` adds boats, clutter and paths. */
function buildVillage(app: App, site: Site, r: () => number, dress: boolean): number {
  const w = app.world;
  const lv = (i: number, j: number) => (i < 0 || j < 0 || i >= N || j >= N ? 0 : w.level(i, j));
  const wet = (i: number, j: number) => lv(i, j) <= 5;
  const [dx, dz] = DIRS[site.d], px = -dz, pz = dx; // along the pier, and square to it
  const ox = site.i + 0.5, oz = site.j + 0.5;
  const at = (k: number, s = 0): [number, number] => [ox + dx * k + px * s, oz + dz * k + pz * s];
  const node = (k: number, s: number, y?: number, pad = 0) => { const [x, z] = at(k, s); return app.addNode(x, z, y, pad); };
  const size = () => 2.5 + Math.round(r() * 2) * 0.5;
  let lastHouse = "";

  /** a house whose wall sits just past (cx, cz), extending away along (ax, az); its floor height, or null if it won't sit */
  const house = (cx: number, cz: number, ax: number, az: number, width: number, depth: number, floors: number, over: boolean) => {
    const near = [cx + ax * 0.35, cz + az * 0.35], far = [cx + ax * (0.35 + depth), cz + az * (0.35 + depth)];
    const tx = Math.abs(az), tz = Math.abs(ax); // along the wall
    const x0 = Math.min(near[0], far[0]) - tx * width / 2, x1 = Math.max(near[0], far[0]) + tx * width / 2;
    const z0 = Math.min(near[1], far[1]) - tz * width / 2, z1 = Math.max(near[1], far[1]) + tz * width / 2;
    if (x0 < 1.5 || z0 < 1.5 || x1 > N - 1.5 || z1 > N - 1.5 || !w.footprintFree(x0 - 0.8, z0 - 0.8, x1 + 0.8, z1 + 0.8)) return null;
    for (const p of w.props.values()) if (isLandmark(p.type) && Math.hypot(p.x - (x0 + x1) / 2, p.z - (z0 + z1) / 2) < 6) return null;
    // keep clear of walkways already laid
    for (const n of w.nodes.values()) if (n.x > x0 - 0.5 && n.x < x1 + 0.5 && n.z > z0 - 0.5 && n.z < z1 + 0.5 && Math.hypot(n.x - cx, n.z - cz) > 0.01) return null;
    const v = newVolume(x0, z0, x1, z1, floors, ROOFS[Math.floor(r() * ROOFS.length)]);
    v.ridgeX = tx > 0;
    const h = makeHouse(uid("h"), r(), [v]);
    w.houses.set(h.id, h); lastHouse = h.id;
    const L = houseLayout(w, h);
    // stilt houses must meet the deck; shore houses must stand on land and not tower over their steps
    const ok = over ? L.base - DECK_Y < 0.6 : !L.over && L.base - L.gmin < 1.8;
    if (!ok) { w.houses.delete(h.id); return null; }
    return L.base;
  };
  /** try a couple of sizes before giving up on a spot */
  const fit = (cx: number, cz: number, ax: number, az: number, over: boolean) => {
    const floors = r() < 0.35 ? 2 : 1;
    for (const [wd, dp] of [[size(), size()], [2.5, 2.5], [2, 2.5]]) { const b = house(cx, cz, ax, az, wd, dp, floors, over); if (b != null) return b; }
    return null;
  };

  let count = 0;
  const L = Math.min(site.run - 1, 11);
  const root = node(0, 0);
  // --- the pier: hubs every few cells, a branch to a stilt house on alternate sides ---
  let prev: WalkNode = root, side = r() < 0.5 ? 1 : -1, stilts = 0;
  for (const k of [2.5, 5.5, 8.5]) {
    if (k > L - 1.5) break;
    const hub = node(k, 0, DECK_Y);
    app.addEdge(prev, hub); prev = hub;
    for (const s of [side, -side]) {
      if (stilts >= 3) break;
      const [ex, ez] = at(k, s * 2);
      const base = fit(ex, ez, px * s, pz * s, true);
      if (base == null) continue;
      app.addEdge(hub, app.addNode(ex, ez, base)); stilts++;
      side = -side;
      break;
    }
  }
  const head = node(L, 0, DECK_Y, 1.5);
  app.addEdge(prev, head);
  count += stilts;
  // a boathouse off the end of the pier when the branches came up short
  if (stilts < 2) {
    const [ex, ez] = at(L + 1.5, 0);
    const base = fit(ex, ez, dx, dz, true);
    if (base != null) { app.addEdge(head, app.addNode(ex, ez, base)); count++; }
  }
  // --- the shore: a boardwalk either side of the root, houses behind it ---
  for (const s of [1, -1]) {
    let last: WalkNode = root, lastReach = 0, here = 0;
    for (const reach of [2.75, 3.5, 4.5, 5.5, 7, 8, 9.5]) {
      if (here >= 2 || reach - lastReach < 2.5 && here) continue;
      const [bx, bz] = at(0, s * reach), bi = Math.floor(bx), bj = Math.floor(bz);
      if (wet(bi, bj) || lv(bi, bj) > 10 || bi < 2 || bj < 2 || bi > N - 3 || bj > N - 3) break;
      // set the house further back until its steps are no steeper than MAX_STAIR
      const bwY = defaultDeckY(w, bx, bz);
      let door: [number, number, number] | null = null;
      for (const back of [1.25, 2, 2.75, 3.5]) {
        const [sx, sz] = at(-back, s * reach);
        const base = fit(sx, sz, -dx, -dz, false);
        if (base == null) continue;
        if (Math.abs(base - bwY) <= MAX_STAIR * back) { door = [sx, sz, base]; break; }
        w.houses.delete(lastHouse);
      }
      if (!door) continue;
      const bw = app.addNode(bx, bz);
      app.addEdge(last, bw); app.addEdge(bw, app.addNode(door[0], door[1], door[2]));
      if (dress) for (let t = lastReach; t <= reach; t += 1) { const [x, z] = at(0, s * t); app.paintDisc("path", x, z, 0.6, 0.7); }
      last = bw; lastReach = reach; here++; count++;
    }
  }
  if (!dress) return count;

  // --- the working end: boats along the pier, clutter on the head, a lantern at the root ---
  const prop = (type: PropType, k: number, s: number, rot: number) => { const [x, z] = at(k, s); return app.addProp(type, x, z, rot, r()); };
  const along = Math.atan2(dx, dz);
  const free = (k: number, s: number, rad: number) => { const [x, z] = at(k, s); return wet(Math.floor(x), Math.floor(z)) && !w.houseAt(x, z, rad); };
  if (free(L - 0.3, 1.9, 1.2)) prop("rowboat", L - 0.3, 1.9, along + 0.15);
  else if (free(L - 0.3, -1.9, 1.2)) prop("rowboat", L - 0.3, -1.9, along - 0.15);
  if (L >= 8 && free(L - 3, -2.6 * side, 2.2) && w.height(...at(L - 3, -2.6 * side)) < WATER_Y - 0.6) prop("sloop", L - 3, -2.6 * side, along + 0.1);
  prop("crates", L + 0.4, 0.5, r());
  prop("barrels", L - 0.3, -0.6, 0);
  { const [x, z] = at(0.6, 0.9); app.addProp("lantern", x, z, 0, r()); }
  return count;
}

/** A handful of palms, scrub, rocks, a rowboat and (where it fits) a lighthouse, clear of the village. */
function seedProps(app: App, r: () => number) {
  const w = app.world;
  const cells: [number, number, number][] = [];
  for (let j = 1; j < N - 1; j++) for (let i = 1; i < N - 1; i++) cells.push([i, j, w.level(i, j)]);
  for (let k = cells.length - 1; k > 0; k--) { const m = Math.floor(r() * (k + 1)); [cells[k], cells[m]] = [cells[m], cells[k]]; }
  const placed: [number, number][] = [...w.props.values()].map(p => [p.x, p.z]);
  const built = [...w.nodes.values()].map(n => [n.x, n.z]);
  const clear = (x: number, z: number, d: number) => !w.houseAt(x, z, d) && built.every(([nx, nz]) => Math.hypot(nx - x, nz - z) > d + 0.6) && !nearEdge(x, z, d);
  const nearEdge = (x: number, z: number, d: number) => [...w.edges.values()].some(e => {
    const a = w.nodes.get(e.a)!, b = w.nodes.get(e.b)!, ex = b.x - a.x, ez = b.z - a.z, L2 = ex * ex + ez * ez || 1;
    const u = Math.max(0, Math.min(1, ((x - a.x) * ex + (z - a.z) * ez) / L2));
    return Math.hypot(a.x + ex * u - x, a.z + ez * u - z) < d + e.width / 2;
  });
  const free = (x: number, z: number, d: number) => placed.every(([px, pz]) => Math.hypot(px - x, pz - z) > d);
  const flat = (i: number, j: number) => { const l = w.level(i, j); return [[1, 0], [-1, 0], [0, 1], [0, -1]].every(([a, b]) => Math.abs(w.level(i + a, j + b) - l) <= 1); };
  const nearWater = (i: number, j: number, R: number) => { for (let b = -R; b <= R; b++) for (let a = -R; a <= R; a++) if (w.level(i + a, j + b) <= 5) return true; return false; };
  const take = (type: PropType, count: number, ok: (i: number, j: number, l: number) => boolean, spacing: number, room = 0.6) => {
    let n = 0;
    for (const [i, j, l] of cells) {
      if (n >= count) break;
      const x = i + 0.2 + r() * 0.6, z = j + 0.2 + r() * 0.6;
      if (!ok(i, j, l) || !free(x, z, spacing) || !clear(x, z, room)) continue;
      app.addProp(type, x, z, r() * Math.PI * 2, r()); placed.push([x, z]); n++;
    }
  };
  // a lighthouse on the highest flat ground that still looks over the water, away from the houses
  const sites = cells.filter(([i, j, l]) => l >= 9 && flat(i, j) && nearWater(i, j, 4) && i > 2 && j > 2 && i < N - 3 && j < N - 3 && clear(i + 0.5, j + 0.5, 4)).sort((a, b) => b[2] - a[2]);
  for (const [i, j] of sites.slice(0, 12)) {
    const s = 0.2 + r() * 0.6, f = fitLandmark(w, "lighthouse", i + 0.5, j + 0.5, s, {}, false);
    if (f.ok && clear(f.x, f.z, 3)) { app.addProp("lighthouse", f.x, f.z, f.rot, s); placed.push([f.x, f.z]); break; }
  }
  take("palm", 7, (i, j, l) => l >= 6 && l <= 8 && flat(i, j), 2.2, 1.2);
  take("scrub", 5, (i, j, l) => l >= 8 && flat(i, j), 2.5);
  take("rock", 3, (i, j, l) => l === 6 && nearWater(i, j, 1), 3);
  take("bougainvillea", 3, (i, j, l) => l >= 7 && l <= 11 && flat(i, j), 4);
  take("rowboat", 1, (i, j, l) => l === 4 && nearWater(i, j, 0) && [[2, 0], [-2, 0], [0, 2], [0, -2]].some(([a, b]) => w.level(i + a, j + b) === 6) && w.height(i + 0.5, j + 0.5) < WATER_Y - 0.2, 4, 1.5);
}
