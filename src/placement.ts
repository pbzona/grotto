import { WATER_Y, N, grottoDims, hullDims, landmarkSamples, quaySamples, grottoTies, isLandmark, isShop, isGreenery, shopHouseOverlap, shopShopOverlap, shopNodeClash, houseRoofReach, SHOP_DIMS, BOATYARD_SLIP, shopEntrance, bakeryDock, type World, type Prop, type PropType } from "./world.ts";

const clampN = (v: number) => Math.min(N - 0.01, Math.max(0.01, v));
const H = (w: World, x: number, z: number) => w.height(clampN(x), clampN(z));

export interface Fit { x: number; z: number; rot: number; ok: boolean; why?: string }

/** Does this landmark (at its current x/z/rot) collide with houses, walkways or other props? */
export function landmarkClash(w: World, p: Prop): string | null {
  const pts = landmarkSamples(p);
  if (isShop(p.type)) for (const h of w.houses.values()) for (const v of h.volumes)
    if (shopHouseOverlap(p, v, houseRoofReach(v))) return "Too close to a house roof";
  for (const [x, z] of pts) {
    if (x < 0.4 || z < 0.4 || x > N - 0.4 || z > N - 0.4) return "Too close to the edge";
    if (w.houseAt(x, z, 0.2)) return "A house is in the way";
  }
  if (isShop(p.type)) for (const n of w.nodes.values()) if (shopNodeClash(w, p, n)) return "A dock landing is in the way";
  const quay = p.type === "grotto" ? quaySamples(p) : [];
  for (const [x, z] of quay) {
    if (x < 0.4 || z < 0.4 || x > N - 0.4 || z > N - 0.4) return "The quay would run off the edge";
    if (w.houseAt(x, z, 0.1)) return "A house is in the way of the quay";
  }
  // walkways may already be tied onto the quay; anything else crossing it is in the way
  const ties = p.type === "grotto" ? grottoTies(p) : [];
  const tied = (n: { x: number; z: number }) => ties.some(t => Math.hypot(t.x - n.x, t.z - n.z) < 0.35);
  for (const e of w.edges.values()) {
    const a = w.nodes.get(e.a), b = w.nodes.get(e.b); if (!a || !b) continue;
    if (quay.length && !tied(a) && !tied(b)) for (const [x, z] of quay) {
      const dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz || 1e-6, t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / L2));
      if (Math.hypot(a.x + dx * t - x, a.z + dz * t - z) < e.width / 2 + 0.1) return "A walkway is in the way of the quay";
    }
    const dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz || 1e-6;
    for (const [x, z] of pts) {
      const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / L2));
      if (Math.hypot(a.x + dx * t - x, a.z + dz * t - z) < e.width / 2 + 0.25) {
        if (isShop(p.type)) {
          const { d } = SHOP_DIMS[p.type];
          const c = Math.cos(p.rot), s = Math.sin(p.rot);
          const lx = (x - p.x) * c + (z - p.z) * s, lz = -(x - p.x) * s + (z - p.z) * c;
          // Split approach edges may no longer touch the door node. Keep their central corridor open.
          if ((p.type === "boatyard" ? lz < -d / 2 + 0.32 : lz > d / 2 - 0.32) && Math.abs(lx) < Math.max(0.9, e.width / 2 + 0.35)) continue;
        }
        return "A walkway is in the way";
      }
    }
  }
  for (const o of w.props.values()) {
    if (o.id === p.id) continue;
    if (isLandmark(o.type)) {
      if (isShop(p.type) && isShop(o.type) && shopShopOverlap(p, o)) return "Too close to another roof";
      const op = landmarkSamples(o);
      for (const [x, z] of pts) for (const [ox, oz] of op) if (Math.abs(x - ox) < 0.6 && Math.abs(z - oz) < 0.6) return "Too close to another landmark";
    } else if (o.type === "rowboat" || o.type === "sloop") {
      for (const [x, z] of pts) if (Math.hypot(o.x - x, o.z - z) < (o.type === "sloop" ? 1.4 : 0.8)) return "A boat is moored there";
    } else if (!isGreenery(o.type)) { // trees and shrubs just get covered
      for (const [x, z] of pts) if (Math.hypot(o.x - x, o.z - z) < 0.45) return "Something is in the way";
    }
  }
  return null;
}

/** Terrain score for a site; -Infinity when the ground can't take it. */
function siteScore(w: World, p: Prop): { s: number; why?: string } {
  const c = Math.cos(p.rot), sn = Math.sin(p.rot);
  const G = (lx: number, lz: number) => w.height(clampN(p.x + lx * c - lz * sn), clampN(p.z + lx * sn + lz * c), p.type === "grotto");
  if (p.type === "grotto") {
    const { W: R, D } = grottoDims(p);
    // the mouth must open onto water and the vault must run back into a cliff
    let wet = 0, n = 0, back = 0, nb = 0, minBack = Infinity;
    for (let lx = -R - 0.6; lx <= R + 0.6 + 1e-6; lx += (R + 0.6) / 3) for (let lz = 1; lz <= 5.6; lz += 0.9) { n++; if (G(lx, lz) < WATER_Y - 0.3) wet++; }
    for (let lx = -R; lx <= R + 1e-6; lx += R / 2) for (let lz = -1.4; lz >= -D; lz -= 1.1) { const g = G(lx, lz); nb++; back += Math.min(g, WATER_Y + 5); minBack = Math.min(minBack, g); }
    back /= nb;
    if (wet / n < 0.85) return { s: -Infinity, why: "Needs open water in front of the mouth" };
    if (minBack < WATER_Y + 0.9 || back < WATER_Y + 2) return { s: -Infinity, why: "Needs a cliff to cut into" };
    return { s: back * 0.6 + (wet / n) * 3 };
  }
  if (p.type === "hull") {
    const { len, wid } = hullDims(p);
    const gs: number[] = [];
    for (let lz = -len * 0.45; lz <= len * 0.45 + 1e-6; lz += len * 0.15) for (const lx of [-wid * 0.4, 0, wid * 0.4]) gs.push(G(lx, lz));
    const lo = Math.min(...gs), hi = Math.max(...gs), mean = gs.reduce((a, b) => a + b, 0) / gs.length;
    if (mean < WATER_Y - 1.1) return { s: -Infinity, why: "Too deep — beach it on sand or shallows" };
    if (hi - lo > 1.6) return { s: -Infinity, why: "Too steep for a beached hull" };
    return { s: -(hi - lo) * 2 - Math.abs(mean - (WATER_Y + 0.15)) * 1.2 };
  }
  if (isShop(p.type)) {
    const { w: wid, d } = SHOP_DIMS[p.type], gs: number[] = [];
    for (const x of [-wid * 0.43, 0, wid * 0.43, ...(p.type === "bakery" ? [wid / 2 + 0.7] : [])]) for (const z of [-d * 0.43, 0, d * 0.43]) gs.push(G(x, z));
    const lo = Math.min(...gs), hi = Math.max(...gs);
    if (p.type === "market") {
      if (lo < WATER_Y - 3.1 || hi - lo > 3.2 || G(0, d / 2 + 0.6) < WATER_Y - 3.1) return { s: -Infinity, why: "Too deep or steep for market stilts" };
      return { s: -(hi - lo) * 0.8 - Math.abs(hi - WATER_Y) * 0.05 };
    }
    const dock = p.type === "bakery" && w.isWater(p.x, p.z) ? bakeryDock(w, p) : undefined;
    if (dock) {
      if (lo < WATER_Y - 3.1 || hi - lo > 3.2 || hi > dock.y + 0.7 || H(w, dock.x, dock.z) > dock.y + 0.15) return { s: -Infinity, why: "The quay needs clear water and a steady dock" };
      return { s: -(hi - lo) * 0.8 };
    }
    if (p.type === "boatyard" ? [-wid * 0.43, 0, wid * 0.43].some(x => G(x, -d * 0.43) < WATER_Y + 0.05) : G(0, 0) < WATER_Y + 0.05 || gs.filter(g => g >= WATER_Y).length < 5) return { s: -Infinity, why: p.type === "bakery" && w.isWater(p.x, p.z) ? "Needs a connected dock for a stone quay" : "Needs mostly dry land beneath it" };
    if (hi - lo > (p.type === "boatyard" ? 2.7 : 2.65) || lo < WATER_Y - 1) return { s: -Infinity, why: "Too steep for this building" };
    const door = shopEntrance(p), entry = H(w, door.x, door.z);
    if (entry < WATER_Y + 0.05 || Math.abs(entry - hi) > (p.type === "boatyard" ? 1.5 : 1.55)) return { s: -Infinity, why: "The entrance needs dry, reachable ground" };
    if (p.type === "boatyard") {
      const lip = G(0, d / 2 + 0.35);
      if (lip < WATER_Y - 1 || hi - lip > 2.5) return { s: -Infinity, why: "The slipway needs a gentle shore" };
      let wet = 0;
      for (const x of [-0.65, 0, 0.65]) {
        const sea = G(x, d / 2 + BOATYARD_SLIP - 0.2);
        if (sea < WATER_Y - 0.15 && sea > WATER_Y - 2.3) wet++;
      }
      if (wet < 2) return { s: -Infinity, why: "The boatyard needs shallow water in front" };
      return { s: -(hi - lo) * 1.1 - Math.abs(entry - hi) - Math.abs(lip - WATER_Y) * 0.45 };
    }
    return { s: -(hi - lo) * 1.1 - Math.abs(entry - hi) };
  }
  // lighthouse: prefers level, high ground
  const gs = [G(0, 0), G(1, 0), G(-1, 0), G(0, 1), G(0, -1)];
  const lo = Math.min(...gs), hi = Math.max(...gs);
  if (lo < WATER_Y - 0.6) return { s: -Infinity, why: "Needs land to stand on" };
  if (hi - lo > 1.3) return { s: -Infinity, why: "Too steep here" };
  return { s: lo * 0.3 - (hi - lo) * 2 };
}

/**
 * Search around (hx, hz) for the best site. `flip` turns the hull end-for-end.
 * Headings are free: the grotto faces out of its cliff, the hull lies along the shore.
 */
export function fitLandmark(w: World, type: PropType, hx: number, hz: number, seed: number, opts: Prop["opts"], flip: boolean, selfId = "ghost", heading?: number, exact = false): Fit {
  const probe: Prop = { id: selfId, type, x: hx, z: hz, rot: 0, seed, opts };
  let best: Fit | null = null, bestS = -Infinity, why = "Won't fit here";
  const rots = type === "lighthouse" ? [0] : isShop(type) && heading !== undefined ? [heading] : Array.from({ length: isShop(type) ? 4 : 16 }, (_, i) => (i / (isShop(type) ? 4 : 16)) * Math.PI * 2);
  const R = exact ? 0 : type === "boatyard" ? 3 : type === "lighthouse" || isShop(type) ? 2.5 : 3;
  const consider = (x: number, z: number, rot: number) => {
    const d = Math.hypot(x - hx, z - hz); if (d > R + 1e-6) return;
    const px = Math.round(x * 10) / 10, pz = Math.round(z * 10) / 10;
    probe.x = px; probe.z = pz; probe.rot = rot;
    const sc = siteScore(w, probe);
    if (sc.s === -Infinity) { if (d < 1e-6 && rot === rots[0]) why = sc.why ?? why; return; }
    const score = sc.s - d * 0.35;
    if (score <= bestS) return;
    const clash = landmarkClash(w, probe);
    if (clash) { if (d < 1e-6) why = clash; return; }
    bestS = score; best = { x: px, z: pz, rot, ok: true };
  };
  for (let dz = -R; dz <= R + 1e-6; dz += 0.5) for (let dx = -R; dx <= R + 1e-6; dx += 0.5)
    for (const rot of rots) consider(hx + dx, hz + dz, rot);
  if (type === "bakery") for (const n of w.nodes.values()) {
    if (!w.edgesOf(n.id).length || w.height(n.x, n.z) >= WATER_Y) continue;
    for (const rot of rots) {
      const offset = SHOP_DIMS.bakery.d / 2 + 0.6;
      consider(n.x + Math.sin(rot) * offset, n.z - Math.cos(rot) * offset, rot);
    }
  }
  const selected = best as Fit | null;
  if (!selected) return { x: hx, z: hz, rot: 0, ok: false, why };
  if (flip && type === "hull") selected.rot += Math.PI;
  return selected;
}

/**
 * Search the whole map for grotto sites: cliffs with open water in front, clear of everything else.
 * Best first; `near` (when given) pulls the ranking toward a point, e.g. the village.
 */
export function grottoSites(w: World, seed: number, opts: Prop["opts"], near?: [number, number], limit = 12): Fit[] {
  const probe: Prop = { id: "ghost", type: "grotto", x: 0, z: 0, rot: 0, seed, opts };
  const found: (Fit & { s: number })[] = [];
  for (let z = 1.5; z < N - 1.5; z += 1) for (let x = 1.5; x < N - 1.5; x += 1) for (let i = 0; i < 16; i++) {
    const rot = (i / 16) * Math.PI * 2, c = Math.cos(rot), sn = Math.sin(rot);
    // cheap gate: dry behind, wet in front
    const G = (lx: number, lz: number) => w.height(clampN(x + lx * c - lz * sn), clampN(z + lx * sn + lz * c), true);
    if (G(0, -1.6) < WATER_Y + 0.9 || G(0, 2.5) > WATER_Y - 0.3) continue;
    probe.x = x; probe.z = z; probe.rot = rot;
    const sc = siteScore(w, probe);
    if (sc.s === -Infinity) continue;
    found.push({ x, z, rot, ok: true, s: sc.s - (near ? Math.hypot(x - near[0], z - near[1]) * 0.25 : 0) });
  }
  found.sort((a, b) => b.s - a.s);
  const out: Fit[] = [];
  for (const f of found) {
    if (out.length >= limit) break;
    if (out.some(o => Math.hypot(o.x - f.x, o.z - f.z) < 2.5)) continue;
    probe.x = f.x; probe.z = f.z; probe.rot = f.rot;
    if (landmarkClash(w, probe)) continue;
    out.push({ x: f.x, z: f.z, rot: f.rot, ok: true });
  }
  return out;
}

// ---------------- sea grotto ----------------
