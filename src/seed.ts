import type { App } from "./app";
import { N, DECK_Y, WATER_Y, SHOP_DIMS, STEP, levelY, newVolume, uid, isLandmark, landmarkSamples, grottoDims, grottoDocks, grottoTies, grottoTieAt, shopEntrance, World, type Prop, type RoofType, type PropType, type WalkNode } from "./world";
import { doorOf, houseLayout, makeHouse, villagerHomes } from "./houses";
import { fitLandmark, grottoSites, landmarkClash } from "./landmarks";
import { planSloop, seaRoute } from "./voyages";
import { rng } from "./mesh";
import { defaultDeckY, MAX_STAIR, slopeOf } from "./walks";

/**
 * Seeds a freshly generated cove with a small village: a straight pier from a beach with stilt houses
 * off square branches, a boardwalk along the shore with a house or two behind it, boats, clutter, and
 * a scatter of greenery. Every walkway runs along an axis; every house gets a door onto one.
 */
export function seedCove(app: App, seed: number) {
  // a pier that reaches the far shore can shut boats out of the grotto: if so, build the village again with it stopping short
  let r = rng(0), grotto: Prop | null = null;
  for (const gap of [0, 3]) {
    r = rng(seed * 7.31 + 0.13);
    seedVillage(app, r, gap);
    grotto = seedGrotto(app, r);
    if (grotto || gap) break;
    app.clearBuildings();
  }
  seedProps(app, r);
  app.settleWalks(); app.easeStairs(); app.mergeInline();
  const w = app.world;
  dropSteepDoors(w);
  for (const lm of [...w.props.values()].filter(p => isLandmark(p.type))) {
    const pts = landmarkSamples(lm);
    for (const o of [...w.props.values()]) if (!isLandmark(o.type) && pts.some(([x, z]) => Math.hypot(x - o.x, z - o.z) < 0.7)) w.props.delete(o.id);
  }
  w.pruneNodes();
  if (grotto) seedLookout(app, grotto);
  seedShops(app, seed);
}

/** Two distinct markets, close to the village where space permits; never cut off its boat routes. */
export function seedShops(app: App, seed: number) {
  const w = app.world, r = rng(seed * 11.37 + 0.91);
  const nodes = [...w.nodes.values()].filter(n => w.edgesOf(n.id).length);
  const cells: { x: number; z: number; near: number }[] = [];
  for (let z = 4; z < N - 3; z += 3) for (let x = 4; x < N - 3; x += 3) {
    if (!w.isWater(x, z)) continue;
    const near = Math.min(...nodes.map(n => Math.hypot(n.x - x, n.z - z)));
    cells.push({ x, z, near: near + r() * 1.1 });
  }
  cells.sort((a, b) => a.near - b.near);
  const markets: Prop[] = [], hadSloop = !!planSloop(w);
  const grotto = [...w.props.values()].find(p => p.type === "grotto");
  const place = (x: number, z: number, heading?: number, tie?: WalkNode) => {
    const variant = markets.length === 0 ? 0.06 : 0.38;
    const fit = fitLandmark(w, "market", x, z, variant, {}, false, "ghost", heading);
    if (!fit.ok || markets.some(p => Math.hypot(p.x - fit.x, p.z - fit.z) < 7)) return false;
    if (tie) {
      const door = shopEntrance({ type: "market", ...fit });
      if (Math.hypot(door.x - tie.x, door.z - tie.z) > 0.28 || Math.abs(tie.y - DECK_Y) > 0.35) return false;
    }
    const p = app.addProp("market", fit.x, fit.z, fit.rot, variant);
    if (hadSloop && !planSloop(w) || grotto && !seaReach(w, grotto)) { w.props.delete(p.id); return false; }
    markets.push(p);
    return true;
  };
  const center = nodes.reduce((a, n) => [a[0] + n.x / (nodes.length || 1), a[1] + n.z / (nodes.length || 1)], [0, 0]);
  const ends = nodes.filter(n => w.isWater(n.x, n.z) && w.edgesOf(n.id).length === 1)
    .sort((a, b) => Math.hypot(a.x - center[0], a.z - center[1]) - Math.hypot(b.x - center[0], b.z - center[1]));
  for (const n of ends) {
    if (markets.length === 2) break;
    const e = w.edgesOf(n.id)[0], other = w.nodes.get(e.a === n.id ? e.b : e.a)!;
    const rot = Math.atan2(n.x - other.x, other.z - n.z);
    for (let i = 0; i < 4; i++) {
      const heading = rot + i * Math.PI / 2, offset = SHOP_DIMS.market.d / 2 + 0.6;
      if (place(n.x + Math.sin(heading) * offset, n.z - Math.cos(heading) * offset, heading, n)) break;
    }
  }
  if (!markets.length) {
    const wetNodes = nodes.filter(n => w.isWater(n.x, n.z) && Math.abs(n.y - DECK_Y) < 0.1 && w.edgesOf(n.id).length <= 2 && !w.houseAt(n.x, n.z, 1.2))
      .sort((a, b) => Math.hypot(a.x - center[0], a.z - center[1]) - Math.hypot(b.x - center[0], b.z - center[1]));
    let attempts = 0, connected = false;
    for (const n of wetNodes) {
      if (connected || attempts >= 90) break;
      for (const [dx, dz] of DIRS) {
        if (connected || attempts >= 90) break;
        for (const dist of [3, 4, 5]) {
          if (connected || attempts >= 90) break;
          const door = { x: n.x + dx * dist, z: n.z + dz * dist };
          if (door.x < 3 || door.z < 3 || door.x > N - 3 || door.z > N - 3) continue;
          if (![0.25, 0.5, 0.75, 1].every(t => w.isWater(n.x + dx * dist * t, n.z + dz * dist * t))) continue;
          for (let i = 0; i < 4 && attempts++ < 90; i++) {
            const heading = i * Math.PI / 2, offset = SHOP_DIMS.market.d / 2 + 0.6;
            const x = door.x + Math.sin(heading) * offset, z = door.z - Math.cos(heading) * offset;
            if (!place(x, z, heading)) continue;
            const p = markets[markets.length - 1], entrance = shopEntrance(p);
            if (Math.hypot(entrance.x - door.x, entrance.z - door.z) > 0.2 || Math.abs(n.y - DECK_Y) > 0.1) { w.props.delete(p.id); markets.pop(); continue; }
            const target = app.addNode(entrance.x, entrance.z, DECK_Y);
            app.addEdge(n, target);
            if (landmarkClash(w, p) || hadSloop && !planSloop(w) || grotto && !seaReach(w, grotto)) {
              w.removeNode(target.id); w.props.delete(p.id); markets.pop(); continue;
            }
            connected = true; break;
          }
        }
      }
    }
  }
  for (const cell of cells) {
    if (markets.length === 2) break;
    place(cell.x, cell.z);
  }
}

/** A door the ground forced a too-steep flight onto: that house doesn't make the cut. Returns how many went. */
function dropSteepDoors(w: World) {
  let gone = 0;
  for (const e of [...w.edges.values()]) {
    const A = w.nodes.get(e.a), B = w.nodes.get(e.b); if (!A || !B || slopeOf(A, B) <= MAX_STAIR + 1e-6) continue;
    for (const d of [A, B]) {
      const h = w.edgesOf(d.id).length === 1 ? doorOf(w, d)?.house : null;
      if (h) { w.houses.delete(h.id); w.edges.delete(e.id); gone++; break; }
    }
  }
  return gone;
}

const DIRS: [number, number][] = [[0, 1], [1, 0], [0, -1], [-1, 0]];
const ROOFS: RoofType[] = ["gable", "hip", "gable", "flat", "shed"];

interface Site { i: number; j: number; d: number; run: number; s: number }

function seedVillage(app: App, r: () => number, gap = 0) {
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
      // a run that ends on the far shore: stop well short of it so the pier doesn't close the channel when asked
      if (gap && run < 14 && !wet(i + dx * (run + 1), j + dz * (run + 1))) run -= gap;
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
  // each site lays out from its own stream, so the village kept is the one that was counted
  const base = r(), from = (site: Site) => rng(base * 977 + site.i * 7.13 + site.j * 13.7 + site.d * 0.31);
  for (const site of sites) {
    if (tried.size >= 10) break;
    const key = `${site.d}:${Math.round(site.i / 3)}:${Math.round(site.j / 3)}`;
    if (tried.has(key)) continue;
    tried.add(key);
    const before = { h: new Set(w.houses.keys()), n: new Set(w.nodes.keys()), e: new Set(w.edges.keys()), p: new Set(w.props.keys()) };
    // count what survives the walkways settling onto the ground
    let n = buildVillage(app, site, from(site), false);
    app.settleWalks(); app.easeStairs();
    n -= dropSteepDoors(w); n += site.s * 0.01;
    for (const id of [...w.houses.keys()]) if (!before.h.has(id)) w.houses.delete(id);
    for (const id of [...w.edges.keys()]) if (!before.e.has(id)) w.edges.delete(id);
    for (const id of [...w.nodes.keys()]) if (!before.n.has(id)) w.nodes.delete(id);
    for (const id of [...w.props.keys()]) if (!before.p.has(id)) w.props.delete(id);
    if (n > most) { most = n; best = site; }
    if (n >= 5) break;
  }
  if (best && most >= 1) buildVillage(app, best, from(best), true);
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

  // --- the working end: a rowboat along the pier (the village sloop berths itself), clutter on the head, a lantern at the root ---
  const prop = (type: PropType, k: number, s: number, rot: number) => { const [x, z] = at(k, s); return app.addProp(type, x, z, rot, r()); };
  const along = Math.atan2(dx, dz);
  const free = (k: number, s: number, rad: number) => { const [x, z] = at(k, s); return wet(Math.floor(x), Math.floor(z)) && !w.houseAt(x, z, rad); };
  if (free(L - 0.3, 1.9, 1.2)) prop("rowboat", L - 0.3, 1.9, along + 0.15);
  else if (free(L - 0.3, -1.9, 1.2)) prop("rowboat", L - 0.3, -1.9, along - 0.15);
  prop("crates", L + 0.4, 0.5, r());
  prop("barrels", L - 0.3, -0.6, 0);
  // the lantern stands on dry ground at the root, beside the walkway
  for (const [k, sd] of [[-0.5, 0.85], [-0.5, -0.85], [-1.2, 0.85], [-1.2, -0.85]]) {
    const [x, z] = at(k, sd);
    if (w.height(x, z) > WATER_Y + 0.1 && !w.houseAt(x, z, 0.3)) { app.addProp("lantern", x, z, 0, r()); break; }
  }
  return count;
}

// ---------------- the grotto: every cove gets one, with a walkway home and a lookout ----------------

const toW = (p: Prop, lx: number, lz: number): [number, number] => {
  const c = Math.cos(p.rot), s = Math.sin(p.rot);
  return [p.x + lx * c - lz * s, p.z + lx * s + lz * c];
};
const toL = (p: Prop, x: number, z: number): [number, number] => {
  const c = Math.cos(p.rot), s = Math.sin(p.rot), dx = x - p.x, dz = z - p.z;
  return [dx * c + dz * s, -dx * s + dz * c];
};

/** Can a rowboat come in from the open sea to every dock? */
function seaReach(w: World, p: Prop) {
  const g = grottoDims(p);
  return grottoDocks(p).every(lx => {
    const bx = (Math.sign(lx) || 1) * Math.max(0, g.chan - 0.45), [ax, az] = toW(p, bx, 3);
    return !!seaRoute(w, false, ax, az, [toW(p, bx, 0.1)]);
  });
}

/** Where the village is (its walkways), or the map centre for an empty cove. */
function villageCentre(w: World): [number, number] {
  const ns = [...w.nodes.values()].filter(n => w.edgesOf(n.id).length);
  if (!ns.length) return [N / 2, N / 2];
  return [ns.reduce((a, n) => a + n.x, 0) / ns.length, ns.reduce((a, n) => a + n.z, 0) / ns.length];
}

/**
 * Put a grotto in the cove, tied to the village by a walkway: the best cliff near the village, else a
 * headland raised for it. Returns null when nothing works, leaving the cove as it was.
 */
export function seedGrotto(app: App, r: () => number): Prop | null {
  const w = app.world, near = villageCentre(w), seed = 0.2 + r() * 0.6;
  const sloop = !!planSloop(w);
  keepHomes = villagerHomes(w).length;
  // spare the village sloop its berth if at all possible; a grotto matters more than the sloop
  for (const strict of sloop ? [true, false] : [false]) {
    keepSloop = strict;
    for (const size of [1, 0] as const) {
      const opts = { size, dock: "left" as const };
      for (const f of grottoSites(w, seed, opts, near)) {
        const p = placeGrotto(app, f, seed, opts, near);
        if (p) return p;
      }
    }
    const p = raiseHeadland(app, seed, near);
    if (p) return p;
  }
  return null;
}

/** Set while seeding: the village sloop has a berth, and the grotto must not take it away. */
let keepSloop = false;
/** Set while seeding: carving the ledge or raising a headland can drop a house away from its door, and none may lose its walkway. */
let keepHomes = 0;

/** Tie the grotto on, and keep the walkway only if boats still reach the docks; prefer one that stays off the water. */
function tieOn(app: App, p: Prop, homes: number): boolean {
  const w = app.world;
  for (const water of [true, false]) {
    const nodes = new Set(w.nodes.keys()), edges = new Set(w.edges.keys()), ys = new Map([...w.nodes.values()].map(n => [n.id, n.y]));
    // every new stretch climbable, square to the map, and not a stub
    const fair = () => [...w.edges.values()].every(e => {
      if (edges.has(e.id)) return true;
      const A = w.nodes.get(e.a)!, B = w.nodes.get(e.b)!;
      return slopeOf(A, B) <= MAX_STAIR + 1e-6 && Math.hypot(A.x - B.x, A.z - B.z) >= 0.3 && (Math.abs(A.x - B.x) < 1e-6 || Math.abs(A.z - B.z) < 1e-6);
    });
    // settle the new stretch now: ground under it can push a post up past what a flight from the quay can climb
    if (linkGrotto(app, p, water)) app.settleWalks(new Set([...w.nodes.keys()].filter(id => !nodes.has(id))));
    if (fair() && [...w.edges.keys()].some(id => !edges.has(id)) && seaReach(w, p) && (!keepSloop || !!planSloop(w)) && villagerHomes(w).length >= homes) return true;
    for (const [id, y] of ys) { const n = w.nodes.get(id); if (n) n.y = y; }
    for (const id of [...w.edges.keys()]) if (!edges.has(id)) w.edges.delete(id);
    for (const id of [...w.nodes.keys()]) if (!nodes.has(id)) w.nodes.delete(id);
  }
  return false;
}

/** Try a site: face the dock toward the village, and keep the grotto only if boats can reach it. */
function placeGrotto(app: App, f: { x: number; z: number; rot: number }, seed: number, opts: Prop["opts"], near: [number, number]): Prop | null {
  const w = app.world;
  const probe: Prop = { id: "ghost", type: "grotto", x: f.x, z: f.z, rot: f.rot, seed, opts };
  const toward: "left" | "right" = toL(probe, near[0], near[1])[0] < 0 ? "left" : "right";
  for (const dock of [toward, toward === "left" ? "right" : "left"] as const) {
    probe.opts = { ...opts, dock };
    if (landmarkClash(w, probe)) continue;
    const p = app.addProp("grotto", f.x, f.z, f.rot, seed);
    p.opts = { ...probe.opts }; app.carveGrotto(p);
    if (seaReach(w, p) && tieOn(app, p, keepHomes)) return p;
    w.props.delete(p.id); app.carveGrotto(p);
  }
  return null;
}

/**
 * No cliff will take a grotto: pick a stretch of shore with open, reachable water in front and raise
 * a rocky headland behind it, stepped down to the ground around so it reads as part of the coast.
 */
function raiseHeadland(app: App, seed: number, near: [number, number]): Prop | null {
  const w = app.world, opts = { size: 0 as const, dock: "left" as const };
  const probe: Prop = { id: "ghost", type: "grotto", x: 0, z: 0, rot: 0, seed, opts };
  const g = grottoDims(probe), R = g.W + g.T + 1.4, back = g.D + 1.6;
  const top = Math.ceil((g.H + g.T + 0.9 - levelY(0)) / STEP);
  const cands: { x: number; z: number; rot: number; s: number }[] = [];
  for (let z = 4.5; z < N - 4.5; z += 1) for (let x = 4.5; x < N - 4.5; x += 1) for (let i = 0; i < 16; i++) {
    const rot = (i / 16) * Math.PI * 2, c = Math.cos(rot), sn = Math.sin(rot);
    const G = (lx: number, lz: number) => w.height(x + lx * c - lz * sn, z + lx * sn + lz * c, true);
    let wet = 0, n = 0;
    for (let lx = -g.W - 0.6; lx <= g.W + 0.6 + 1e-6; lx += (g.W + 0.6) / 2) for (let lz = 1; lz <= 5.6; lz += 0.9) { n++; if (G(lx, lz) < WATER_Y - 0.3) wet++; }
    if (wet < n) continue;
    // the shore: dry ground right behind the mouth, so the raised rock joins the land
    if (G(0, -1) < WATER_Y || G(0, -back) < WATER_Y) continue;
    cands.push({ x, z, rot, s: -Math.abs(Math.hypot(x - near[0], z - near[1]) - 9) });
  }
  cands.sort((a, b) => b.s - a.s);
  const tried: [number, number][] = [];
  for (const cd of cands) {
    if (tried.length >= 30) break;
    if (tried.some(([x, z]) => Math.hypot(x - cd.x, z - cd.z) < 3)) continue;
    Object.assign(probe, { x: cd.x, z: cd.z, rot: cd.rot });
    const [fx, fz] = toW(probe, 0, 3);
    if (!seaRoute(w, false, fx, fz, [], 1.5)) continue;
    tried.push([cd.x, cd.z]);
    // the cells the headland covers, with the level each should reach
    const lift: [number, number, number][] = [];
    let blocked = false;
    for (let j = 0; j < N && !blocked; j++) for (let i = 0; i < N; i++) {
      const [lx, lz] = toL(probe, i + 0.5, j + 0.5);
      if (lz > 0.2) continue;
      const out = Math.max(Math.abs(lx) - R, -lz - back, 0);
      const l = Math.round(top - out * 3.5);
      if (l <= w.baseLevel(i, j)) continue;
      // the core must be clear; the slope down from it just stops short of anything in the way
      const off = i < 1 || j < 1 || i > N - 2 || j > N - 2 || w.houseAt(i + 0.5, j + 0.5, 0.8)
        || [...w.nodes.values()].some(n => Math.abs(n.x - i - 0.5) < 1.3 && Math.abs(n.z - j - 0.5) < 1.3);
      if (off && out <= 0) { blocked = true; break; }
      if (off) continue;
      lift.push([i, j, l]);
    }
    if (blocked) continue;
    const was = lift.map(([i, j]) => w.baseLevel(i, j));
    for (const [i, j, l] of lift) w.setLevel(i, j, l);
    const fit = fitLandmark(w, "grotto", cd.x, cd.z, seed, opts, false);
    const p = fit.ok ? placeGrotto(app, fit, seed, opts, near) : null;
    if (p) { app.changed({ terrain: true }); return p; }
    lift.forEach(([i, j], k) => w.setLevel(i, j, was[k]));
  }
  return null;
}

/**
 * Lay a walkway from the grotto's quay to the village: a shortest square-cornered route over land and
 * water that keeps out of the mouth's boat lane, off houses and other walkways, and climbs no steeper
 * than stairs. Returns whether it reached.
 */
export function linkGrotto(app: App, p: Prop, water = true): boolean {
  const w = app.world, g = grottoDims(p), lane = g.W + 0.9;
  const goals = new Map<number, WalkNode>();
  const cell = (x: number, z: number) => Math.floor(z) * N + Math.floor(x);
  for (const n of w.nodes.values()) {
    const deg = w.edgesOf(n.id).length;
    if (!deg || grottoTieAt(w, n.x, n.z) || (deg === 1 && doorOf(w, n))) continue;
    goals.set(cell(n.x, n.z), n);
  }
  if (!goals.size) return false;
  const others = [...w.props.values()].filter(o => isLandmark(o.type) && o.id !== p.id).flatMap(o => landmarkSamples(o));
  const own = landmarkSamples(p);
  // walkways already laid are in the way, except right beside a node the link may join
  const gnodes = [...goals.values()];
  const edgeNear = (x: number, z: number, d: number) => {
    const g = gnodes.find(n => Math.hypot(n.x - x, n.z - z) < 1.5);
    return [...w.edges.values()].some(e => {
      const a = w.nodes.get(e.a)!, b = w.nodes.get(e.b)!, ex = b.x - a.x, ez = b.z - a.z, L2 = ex * ex + ez * ez || 1;
      const u = Math.max(0, Math.min(1, ((x - a.x) * ex + (z - a.z) * ez) / L2)), off = Math.hypot(a.x + ex * u - x, a.z + ez * u - z);
      if (g && (e.a === g.id || e.b === g.id)) return off < 0.6 && Math.hypot(ex * u + a.x - g.x, ez * u + a.z - g.z) > 0.3;
      return off < d + e.width / 2;
    });
  };
  const [cx, cz] = villageCentre(w);
  const tie = grottoTies(p).sort((a, b) => Math.hypot(a.x - cx, a.z - cz) - Math.hypot(b.x - cx, b.z - cz))[0];
  if (!tie) return false;
  const deck = new Float32Array(N * N), open = new Uint8Array(N * N);
  for (let j = 1; j < N - 1; j++) for (let i = 1; i < N - 1; i++) {
    const k = j * N + i, x = i + 0.5, z = j + 0.5;
    deck[k] = defaultDeckY(w, x, z);
    if (goals.has(k)) { open[k] = 1; continue; }
    const [lx, lz] = toL(p, x, z);
    if (Math.abs(lx) < lane && lz > -0.5 && lz < 6.5) continue; // the boat lane and the mouth
    if (!water && deck[k] <= DECK_Y + 1e-3 && Math.hypot(x - tie.x, z - tie.z) > 2.5) continue;
    if (w.houseAt(x, z, 0.75) || edgeNear(x, z, 0.75)) continue;
    if (others.some(([sx, sz]) => Math.hypot(sx - x, sz - z) < 1) || (Math.hypot(x - tie.x, z - tie.z) > 1.6 && own.some(([sx, sz]) => Math.hypot(sx - x, sz - z) < 0.8))) continue;
    open[k] = 1;
  }
  // Dijkstra over (cell, heading); a turn costs extra so the walkway runs in long straight stretches
  const D4: [number, number][] = [[1, 0], [0, 1], [-1, 0], [0, -1]];
  const S = N * N * 4, dist = new Float64Array(S).fill(Infinity), from = new Int32Array(S).fill(-1);
  const heap: [number, number][] = [];
  const push = (d: number, s: number) => {
    heap.push([d, s]); let c = heap.length - 1;
    while (c > 0) { const pa = (c - 1) >> 1; if (heap[pa][0] <= heap[c][0]) break; [heap[pa], heap[c]] = [heap[c], heap[pa]]; c = pa; }
  };
  const pop = () => {
    const top = heap[0], last = heap.pop()!;
    if (heap.length) {
      heap[0] = last; let c = 0;
      for (;;) { const l = c * 2 + 1, r2 = l + 1; let m = c; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r2 < heap.length && heap[r2][0] < heap[m][0]) m = r2; if (m === c) break; [heap[m], heap[c]] = [heap[c], heap[m]]; c = m; }
    }
    return top;
  };
  // start from the cells just off the quay
  for (let j = Math.floor(tie.z) - 2; j <= Math.floor(tie.z) + 2; j++) for (let i = Math.floor(tie.x) - 2; i <= Math.floor(tie.x) + 2; i++) {
    const k = j * N + i, ex = i + 0.5 - tie.x, ez = j + 0.5 - tie.z, L = Math.hypot(ex, ez);
    if (i < 1 || j < 1 || i > N - 2 || j > N - 2 || L > 1.3 || !open[k] || Math.abs(deck[k] - DECK_Y) > MAX_STAIR * Math.max(L, 0.5)) continue;
    const d = Math.abs(ex) > Math.abs(ez) ? (ex > 0 ? 0 : 2) : (ez > 0 ? 1 : 3);
    if (L < dist[k * 4 + d]) { dist[k * 4 + d] = L; push(L, k * 4 + d); }
  }
  let end = -1;
  while (heap.length) {
    const [d0, s] = pop(); if (d0 > dist[s]) continue;
    const k = s >> 2, h = s & 3;
    if (goals.has(k)) { end = s; break; }
    const i = k % N, j = (k / N) | 0;
    for (let nd = 0; nd < 4; nd++) {
      if (nd === (h + 2) % 4) continue;
      const ni = i + D4[nd][0], nj = j + D4[nd][1]; if (ni < 1 || nj < 1 || ni > N - 2 || nj > N - 2) continue;
      const nk = nj * N + ni; if (!open[nk] || Math.abs(deck[nk] - deck[k]) > MAX_STAIR) continue;
      const cost = d0 + 1 + (deck[nk] <= DECK_Y + 1e-3 ? 0.35 : 0) + (nd !== h ? 1.5 : 0) + Math.abs(deck[nk] - deck[k]) * 0.8;
      const ns = nk * 4 + nd;
      if (cost < dist[ns]) { dist[ns] = cost; from[ns] = s; push(cost, ns); }
    }
  }
  if (end < 0) return false;
  // walk back to the corners
  const cells: number[] = [];
  for (let s = end; s >= 0; s = from[s]) cells.push(s);
  cells.reverse();
  const goal = goals.get(end >> 2)!;
  // corners where the heading changes (a turn on the very first cell just bends off the quay)
  const qs: number[] = [];
  for (let q = 1; q < cells.length - 1; q++) if ((cells[q] & 3) !== (cells[q + 1] & 3)) qs.push(q);
  // square the first leg off the quay and the last onto the node it joins
  const along = (s: number) => (s & 3) % 2 === 0;
  let prev = app.addNode(tie.x, tie.z, DECK_Y);
  for (const [o, q] of qs.entries()) {
    const k = cells[q] >> 2;
    let x = (k % N) + 0.5, z = ((k / N) | 0) + 0.5;
    if (o === 0) { if (along(cells[q])) z = tie.z; else x = tie.x; }
    if (o === qs.length - 1) { if (along(cells[cells.length - 1])) z = goal.z; else x = goal.x; }
    const n = app.addNode(x, z, deck[k]);
    app.addEdge(prev, n); prev = n;
  }
  // a straight run that lands off-line from the node it joins turns once to meet it square
  if (!qs.length && Math.abs(prev.x - goal.x) > 1e-6 && Math.abs(prev.z - goal.z) > 1e-6) {
    const [x, z] = along(cells[cells.length - 1]) ? [goal.x, prev.z] : [prev.x, goal.z];
    const n = app.addNode(x, z, Math.max(DECK_Y, defaultDeckY(w, x, z)));
    app.addEdge(prev, n); prev = n;
  }
  app.addEdge(prev, goal);
  return true;
}

/** Make the connected house nearest the grotto a lookout, unless the village already has one. */
export function seedLookout(app: App, p: Prop) {
  const w = app.world;
  if ([...w.houses.values()].some(h => h.volumes.some(v => v.kind === "lookout"))) return;
  const homes = villagerHomes(w).map(hm => w.houses.get(hm.house)!).filter(Boolean);
  const dist = (h: (typeof homes)[number]) => Math.min(...h.volumes.map(v => Math.hypot((v.x0 + v.x1) / 2 - p.x, (v.z0 + v.z1) / 2 - p.z)));
  // the nearest house that still meets its walkway once it has grown a lookout storey
  for (const h of homes.sort((a, b) => dist(a) - dist(b))) {
    const v = h.volumes[0], was = { kind: v.kind, floors: v.floors };
    v.kind = "lookout"; v.floors = Math.max(2, v.floors);
    if (villagerHomes(w).some(hm => hm.house === h.id)) return;
    Object.assign(v, was); if (was.kind === undefined) delete v.kind;
  }
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
