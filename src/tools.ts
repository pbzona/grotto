import * as THREE from "three/webgpu";
import type { App } from "./app";
import { World, N, snap, House, Volume, newVolume, uid, FLOOR_H, MAX_LEVEL, PaintType, PropType, WalkNode, WalkEdge, RoofType, WATER_Y, DECK_Y, Prop, isLandmark, isShop, SHOP_DIMS, shopDoorAt, hullDims, grottoDims, grottoTies, grottoTieAt, QUAY_HALF, GROTTO_OPTS, propOpt } from "./world";
import { MeshBuilder } from "./mesh";
import { buildHouse, houseLayout, makeHouse, siteDrop, MAX_SITE_DROP, nodeWall, nearWalls, sideLine, HouseBuild, Bay } from "./houses";
import { defaultDeckY, landingRadius, WALK_W, MAX_STAIR, slopeOf, clampStair } from "./walks";
import { buildOneProp, buildBoat, PROP_INFO, boatFreeboard, isGreenery, palmPierces } from "./props";
import { fitLandmark, Fit } from "./landmarks";
import { U } from "./materials";
import { HandleLayer } from "./handles";

export type ToolId = "select" | "house" | "walk" | "terrain" | "paint" | "prop" | "erase";
export type TerrainOp = "raise" | "lower" | "flatten" | "smooth";
export type Selection =
  | { kind: "house"; id: string; vi: number }
  | { kind: "node"; id: string }
  | { kind: "edge"; id: string }
  | { kind: "prop"; id: string };

export const HOUSE_PRESETS: Record<string, { label: string; w: number; d: number; floors: number; roof: RoofType; kind?: Volume["kind"] }> = {
  cottage: { label: "Cottage", w: 3, d: 2.5, floors: 1, roof: "gable" },
  townhouse: { label: "Townhouse", w: 2.5, d: 3, floors: 2, roof: "gable" },
  terrace: { label: "Flat-roof", w: 3, d: 2.5, floors: 1, roof: "flat" },
  longhouse: { label: "Longhouse", w: 5, d: 2.5, floors: 1, roof: "hip" },
  lookout: { label: "Lookout", w: 2, d: 2, floors: 3, roof: "hip", kind: "lookout" },
  tower: { label: "Tower", w: 2, d: 2, floors: 3, roof: "hip", kind: "tower" },
};

/** A walkway end opening a door in a house wall, remembered so it can follow the wall while the house is reshaped. */
type DoorEnd = { id: string; vi: number; side: number; t: number; d: number; floor: number };

type Drag =
  | { t: "side"; side: number; grab: number; plane: number; orig: House; extrude: boolean; wingVi?: number; doors: DoorEnd[] }
  | { t: "move"; start: THREE.Vector3; orig: House; doors: DoorEnd[] }
  | { t: "floors"; y0: number; floors0: number }
  | { t: "rect"; a: THREE.Vector3; b: THREE.Vector3 }
  | { t: "stroke"; last: number; flat?: number; changed: boolean }
  | { t: "nodeMove"; id: string; start: THREE.Vector3; ox: number; oz: number; changed: boolean }
  | { t: "nodeY"; id: string; y0: number; oy: number; changed: boolean }
  | { t: "propMove"; id: string; start: THREE.Vector3; ox: number; oz: number; changed: boolean }
  | { t: "walk"; down: THREE.Vector3; sx: number; sy: number }
  | { t: "seg"; side: number; a: number; b: number; orig: House; vi: number; wall: number }
  | { t: "lift"; alongX: boolean; a: number; b: number; orig: House; vi: number; y0: number; df: number }
  | { t: "extend"; from: string; node: WalkNode | null; changed: boolean };

const SIDE_N: [number, number][] = [[0, 1], [1, 0], [0, -1], [-1, 0]];
/** Split a span into segments of about a unit each (multiples of 0.5). */
export function segments(lo: number, hi: number): [number, number][] {
  const len = hi - lo;
  const k = Math.max(1, Math.floor(len / 1.0 + 1e-6));
  const halves = Math.round(len * 2);
  const out: [number, number][] = [];
  let at = lo, used = 0;
  for (let i = 0; i < k; i++) {
    const rest = halves - used, left = k - i;
    const w = Math.max(1, Math.round(rest / left)) ;
    out.push([at, at + w * 0.5]); at += w * 0.5; used += w;
  }
  out[out.length - 1][1] = hi;
  return out;
}

export class Tools {
  tool: ToolId = "select";
  brush = 2;
  terrainOp: TerrainOp = "raise";
  paintType: PaintType | "erase" = "path";
  propType: PropType = "palm";
  propRot = 0;
  shopHeading: number | null = null;
  buildingChoice = "cottage";
  get placingSpecial() { return this.tool === "house" && !(this.buildingChoice in HOUSE_PRESETS); }
  get placingType(): PropType { return this.tool === "house" ? this.buildingChoice as PropType : this.propType; }
  /** the seed the ghost shows, so what you see is what gets placed */
  propSeed = Math.random();
  /** hull tavern end-for-end; grotto dock side for the next placement */
  landFlip = false;
  ghostOpts: Prop["opts"] = {};
  private fitCache: { key: string; fit: Fit } | null = null;
  fitAt(type: PropType, x: number, z: number, selfId = "ghost", seed = this.propSeed, opts = this.ghostOpts, flip = this.landFlip): Fit {
    const key = [type, Math.round(x * 4), Math.round(z * 4), selfId, seed, JSON.stringify(opts), flip, this.shopHeading, this.world.version].join("|");
    if (this.fitCache?.key === key) return this.fitCache.fit;
    const fit = fitLandmark(this.world, type, x, z, seed, opts, flip, selfId, isShop(type) ? this.shopHeading ?? undefined : undefined);
    this.fitCache = { key, fit };
    return fit;
  }
  preset = "cottage";
  walkStyle: WalkEdge["style"] = "deck";
  walkPad = false;
  /** height nudge applied to the next walkway node (for stairs and bridges) */
  walkLift = 0;
  sel: Selection | null = null;
  chain: WalkNode | null = null;
  onChange: (() => void) | null = null;
  toast: (msg: string) => void = () => {};

  private ray = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  private drag: Drag | null = null;
  private hover: THREE.Vector3 | null = null;
  private ghost: THREE.Mesh;
  private ghostBad: THREE.Mesh;
  private ghostX: THREE.Mesh;
  private ghostBadX: THREE.Mesh;
  private foot: THREE.Mesh;
  private layer: HandleLayer;
  /** for tests and the panel: the live handle group */
  get handles() { return this.layer.group; }
  private hoverBox = new THREE.Box3();
  private pointerId = -1;
  private downAt = { x: 0, y: 0 };
  private keys = new Set<string>();
  shift = false;

  constructor(private app: App, private dom: HTMLElement) {
    const m = app.d.mats;
    this.ghost = new THREE.Mesh(new THREE.BufferGeometry(), m.ghost);
    this.ghostBad = new THREE.Mesh(new THREE.BufferGeometry(), m.ghostBad);
    this.ghostX = new THREE.Mesh(new THREE.BufferGeometry(), m.ghostX);
    this.ghostBadX = new THREE.Mesh(new THREE.BufferGeometry(), m.ghostBadX);
    this.foot = new THREE.Mesh(new THREE.BufferGeometry(), m.footOk);
    this.ghostX.renderOrder = this.ghostBadX.renderOrder = 7;
    this.ghost.renderOrder = this.ghostBad.renderOrder = 8;
    this.foot.renderOrder = 9;
    for (const g of [this.ghost, this.ghostBad, this.ghostX, this.ghostBadX, this.foot]) { g.frustumCulled = false; g.visible = false; }
    this.layer = new HandleLayer(m.handle, m.handleHot, m.handleLine, m.handleWash);
    app.d.scene.add(this.ghostX, this.ghostBadX, this.ghost, this.ghostBad, this.foot, this.layer.group);
    dom.addEventListener("pointerdown", e => {
      // Clicking the world takes focus back from any panel control.
      const f = document.activeElement as HTMLElement | null;
      if (f && f !== document.body) f.blur();
      this.down(e);
    });
    dom.addEventListener("pointermove", e => this.move(e));
    dom.addEventListener("pointerup", e => this.up(e));
    dom.addEventListener("pointercancel", () => this.cancelDrag());
    dom.addEventListener("pointerleave", () => { if (!this.drag) { this.hover = null; this.updateGhost(); } });
    dom.addEventListener("dblclick", () => { if (this.tool === "walk") this.endChain(); });
    dom.addEventListener("wheel", e => this.wheel(e), { passive: false });
    dom.addEventListener("contextmenu", e => { if (this.tool === "walk" && this.chain) { e.preventDefault(); this.endChain(); } });
    // Held pan keys, by physical code. macOS never sends keyup for keys
    // released while Cmd is down, and Cmd+Tab swallows Cmd's own keyup, so
    // a chord never latches a key and losing focus forgets everything.
    window.addEventListener("keydown", e => {
      this.shift = e.shiftKey;
      if (e.metaKey || e.ctrlKey || e.altKey) { this.keys.clear(); return; }
      if (PAN_KEYS.has(e.code)) this.keys.add(e.code);
    });
    window.addEventListener("keyup", e => {
      this.shift = e.shiftKey;
      if (e.key === "Meta" || e.key === "Control" || e.key === "Alt") this.keys.clear();
      else this.keys.delete(e.code);
    });
    const forget = () => { this.keys.clear(); this.shift = false; };
    window.addEventListener("blur", forget);
    document.addEventListener("visibilitychange", () => { if (document.hidden) forget(); });
  }

  get world(): World { return this.app.world; }

  setTool(t: ToolId) {
    if (this.drag) this.cancelDrag();
    if (this.tool === "walk" && t !== "walk") this.endChain();
    this.tool = t;
    if (t !== "select") this.select(null);
    this.updateGhost(); this.onChange?.();
  }
  select(s: Selection | null) {
    const same = JSON.stringify(s) === JSON.stringify(this.sel);
    this.sel = s;
    if (!same) { clearTimeout(this.revealTimer); this.revealTimer = 0; this.reveal = null; }
    this.refreshHandles(); this.refreshHighlight(); this.onChange?.();
  }

  // ---------- picking ----------
  private setRay(e: PointerEvent | WheelEvent | MouseEvent) {
    const r = this.dom.getBoundingClientRect();
    this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.app.d.camera);
  }
  private ground(): THREE.Vector3 | null { return this.app.d.terrain.raycast(this.ray.ray); }
  /** Where a pointer lands for placing things: the terrain, or the sea surface over water. */
  private surface(): THREE.Vector3 | null {
    const g = this.ground();
    const r = this.ray.ray;
    if (Math.abs(r.direction.y) > 1e-4) {
      const t = (WATER_Y - r.origin.y) / r.direction.y;
      if (t > 0) {
        const p = r.at(t, new THREE.Vector3());
        if (p.x >= 0 && p.z >= 0 && p.x <= N && p.z <= N && (!g || g.y < WATER_Y)) return p;
      }
    }
    return g;
  }
  private pick(): { owner: string; point: THREE.Vector3; normal: THREE.Vector3 } | null {
    for (const b of this.app.boats) b.mesh.updateMatrixWorld();
    const objs: THREE.Object3D[] = [this.app.structures, ...this.app.boats.map(b => b.mesh)];
    const hits = this.ray.intersectObjects(objs, false);
    const g = this.ground();
    for (const h of hits) {
      if (g && g.distanceTo(this.ray.ray.origin) < h.distance - 0.05) return null;
      const ud = (h.object as THREE.Mesh).userData;
      const owner = ud.owners?.[ud.triOwner?.[h.faceIndex ?? -1]];
      if (!owner || owner === "strings" || owner === "scatter") continue;
      return { owner, point: h.point.clone(), normal: h.face?.normal.clone() ?? new THREE.Vector3(0, 1, 0) };
    }
    return null;
  }
  private ownerToSel(owner: string): Selection | null {
    const [k, a, b] = owner.split(":");
    if (k === "h") return { kind: "house", id: a, vi: +b || 0 };
    if (k === "w" && a === "n") return { kind: "node", id: b };
    if (k === "w" && a === "e") return { kind: "edge", id: b };
    if (k === "p") return { kind: "prop", id: a };
    return null;
  }
  /** The handle under the pointer, unless something stands in front of it. */
  private pickHandle(): THREE.Object3D | null {
    const hs = this.layer.handles; if (!hs.length) return null;
    this.frame(); this.layer.group.updateMatrixWorld(true);
    const hit = this.ray.intersectObjects(hs, false)[0]; if (!hit) return null;
    const g = this.ground();
    if (g && g.distanceTo(this.ray.ray.origin) < hit.distance) return null;
    const wall = this.ray.intersectObject(this.app.structures, false)[0];
    // a post just in front of the disc (its own walkway's end post, say) shouldn't swallow the click
    if (wall && wall.distance < hit.distance - hit.object.scale.x) return null;
    return hit.object;
  }

  // ---------- pointer ----------
  private down(e: PointerEvent) {
    if (e.button !== 0) return;
    this.setRay(e);
    this.pointerId = e.pointerId;
    this.downAt = { x: e.clientX, y: e.clientY };
    const app = this.app;
    if (this.tool === "select" || this.sel) {
      const hnd = this.pickHandle();
      if (hnd) { this.startHandle(hnd, e); this.dom.setPointerCapture(e.pointerId); return; }
    }
    switch (this.tool) {
      case "select": {
        const p = this.pick();
        const s = p ? this.ownerToSel(p.owner) : null;
        // a click on a wall of the selected house toggles a window there
        if (s && s.kind === "house" && this.sel?.kind === "house" && this.sel.id === s.id && p) {
          if (this.toggleBay(s.id, p.point, p.normal)) return;
        }
        // a click on a walkway near one of its ends grabs that post
        let s2: Selection | null = s;
        if (s2?.kind === "edge" && p) {
          const e0 = this.world.edges.get(s2.id);
          const ends = e0 ? [this.world.nodes.get(e0.a), this.world.nodes.get(e0.b)].filter(Boolean) as WalkNode[] : [];
          const near = ends.find(n => Math.hypot(n.x - p.point.x, n.z - p.point.z) < 0.85);
          if (near) s2 = { kind: "node", id: near.id };
        }
        // posts and props can be dragged straight away
        if (s2 && (s2.kind === "prop" || s2.kind === "node") && p) {
          this.select(s2);
          const g = this.surface() ?? p.point;
          app.begin(true);
          if (s2.kind === "prop") { const pr = this.world.props.get(s2.id)!; this.drag = { t: "propMove", id: s2.id, start: g.clone(), ox: pr.x, oz: pr.z, changed: false }; }
          else { const n = this.world.nodes.get(s2.id)!; this.drag = { t: "nodeMove", id: s2.id, start: g.clone(), ox: n.x, oz: n.z, changed: false }; }
          this.dom.setPointerCapture(e.pointerId);
          return;
        }
        if (s && (s.kind === "prop" || s.kind === "node") && this.sel && this.sel.kind === s.kind && this.sel.id === s.id) {
          const g = this.surface() ?? p!.point;
          app.begin(true);
          if (s.kind === "prop") { const pr = this.world.props.get(s.id)!; this.drag = { t: "propMove", id: s.id, start: g.clone(), ox: pr.x, oz: pr.z, changed: false }; }
          else { const n = this.world.nodes.get(s.id)!; this.drag = { t: "nodeMove", id: s.id, start: g.clone(), ox: n.x, oz: n.z, changed: false }; }
          this.dom.setPointerCapture(e.pointerId);
          return;
        }
        this.select(s);
        break;
      }
      case "house": {
        if (this.placingSpecial) { this.placeProp(); break; }
        const g = this.ground(); if (!g) return;
        const a = new THREE.Vector3(snap(g.x), g.y, snap(g.z));
        this.drag = { t: "rect", a, b: a.clone() };
        this.dom.setPointerCapture(e.pointerId);
        break;
      }
      case "terrain": case "paint": {
        const g = this.ground(); if (!g) return;
        app.begin(true);
        this.drag = { t: "stroke", last: 0, changed: false, flat: this.world.baseLevel(Math.floor(g.x), Math.floor(g.z)) };
        this.applyStroke(g, true);
        this.dom.setPointerCapture(e.pointerId);
        break;
      }
      case "walk": {
        const g = this.surface(); if (!g) return;
        this.drag = { t: "walk", down: g.clone(), sx: e.clientX, sy: e.clientY };
        this.dom.setPointerCapture(e.pointerId);
        break;
      }
      case "prop": this.placeProp(); break;
      case "erase": this.eraseAt(); break;
    }
  }

  private move(e: PointerEvent) {
    this.setRay(e);
    const d = this.drag;
    if (d && d.t !== "walk" && d.t !== "rect") this.app.interacting = true;
    if (!d) {
      if (this.tool === "select") { this.hoverHandles(); return; }
      this.hover = this.tool === "walk" || this.tool === "prop" || this.placingSpecial ? this.surface() : this.ground();
      this.updateGhost();
      return;
    }
    switch (d.t) {
      case "rect": { const g = this.ground(); if (g) { d.b.set(snap(g.x), g.y, snap(g.z)); this.updateGhost(); } break; }
      case "stroke": { const g = this.ground(); if (g) { this.hover = g; this.applyStroke(g, false); this.updateBrush(); } break; }
      case "walk": { this.hover = this.surface(); this.updateGhost(); break; }
      case "side": this.dragSide(d); break;
      case "seg": this.dragSeg(d); break;
      case "lift": this.dragLift(d, e); break;
      case "extend": this.dragExtend(d); break;
      case "move": this.dragMove(d); break;
      case "floors": this.dragFloors(d, e); break;
      case "nodeY": {
        const n = this.world.nodes.get(d.id); if (!n) break;
        const dy = (d.oy - e.clientY) / 40 * 0.25;
        const y = Math.round((d.y0 + dy) / 0.25) * 0.25;
        const g = this.world.height(n.x, n.z);
        const ny = Math.max(Math.max(g, WATER_Y) + 0.2, clampStair(this.world, n, Math.min(12, y)));
        if (ny !== n.y) { n.y = ny; d.changed = true; this.app.changed({ structures: true }); this.refreshHandles(); }
        break;
      }
      case "nodeMove": case "propMove": {
        const g = this.surface(); if (!g) break;
        const x = Math.min(N - 0.3, Math.max(0.3, d.ox + g.x - d.start.x)), z = Math.min(N - 0.3, Math.max(0.3, d.oz + g.z - d.start.z));
        if (d.t === "nodeMove") {
          const n = this.world.nodes.get(d.id); if (!n) break;
          n.x = Math.round(x * 4) / 4; n.z = Math.round(z * 4) / 4;
        } else {
          const p = this.world.props.get(d.id); if (!p) break;
          if (isLandmark(p.type)) {
            const f = fitLandmark(this.world, p.type, x, z, p.seed, p.opts, false, p.id, p.rot);
            if (!f.ok) break;
            p.x = f.x; p.z = f.z;
            if (p.type !== "lighthouse") p.rot = f.rot + (p.type === "hull" && Math.cos(f.rot - p.rot) < 0 ? Math.PI : 0);
          } else { p.x = Math.round(x * 10) / 10; p.z = Math.round(z * 10) / 10; }
        }
        d.changed = true; this.app.changed({ structures: true, terrain: d.t === "propMove" && this.world.props.get(d.id)?.type === "grotto" }); this.refreshHandles();
        break;
      }
    }
  }
  private up(e: PointerEvent) {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    const d = this.drag;
    this.drag = null;
    this.layer.held = null;
    this.app.endInteraction();
    try { this.dom.releasePointerCapture(this.pointerId); } catch { /* not captured */ }
    if (!d) return;
    this.setRay(e);
    const moved = Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y) > 6;
    switch (d.t) {
      case "rect": this.commitHouse(d.a, d.b, moved); break;
      case "stroke": if (!d.changed) this.app.cancel(); else if (this.tool === "terrain") { const a = this.app.settleWalks(), b = this.app.mergeInline(); if (a || b) this.app.changed({ structures: true }); } break;
      case "walk": {
        const g = this.surface() ?? d.down;
        if (moved && d.down.distanceTo(g) > 0.5) {
          // press-drag-release: a whole segment
          if (!this.chain) { this.app.begin(true); this.chain = this.walkPoint(d.down, null).node; }
          this.walkTo(g);
        } else if (!this.chain) {
          this.app.begin(true);
          const r = this.walkPoint(d.down, null);
          this.chain = r.node;
          const lone = r.created && !this.world.edgesOf(r.node.id).length;
          if (lone) this.world.nodes.delete(r.node.id);
          this.chainTemp = lone ? r.node : null;
          this.app.changed({ structures: true });
        } else this.walkTo(g);
        this.updateGhost();
        break;
      }
      case "extend":
        if (!d.changed) this.app.cancel();
        else if (d.node) { this.world.pruneNodes(); this.app.settleWalks(new Set([d.from, d.node.id])); this.app.changed({ structures: true }); this.select({ kind: "node", id: d.node.id }); }
        this.onChange?.();
        break;
      case "seg": case "lift":
        if (!this.housesChanged) this.app.cancel();
        this.housesChanged = false;
        this.refreshHandles(); this.refreshHighlight(); this.onChange?.();
        break;
      case "side": case "move": case "floors":
        if (!this.housesChanged) this.app.cancel();
        this.housesChanged = false;
        this.refreshHandles(); this.onChange?.();
        break;
      case "nodeY": case "nodeMove": case "propMove":
        if (!d.changed) this.app.cancel(); else if (d.t !== "propMove") { this.world.pruneNodes(); if (this.app.settleWalks(new Set([d.id]))) this.app.changed({ structures: true }); }
        this.onChange?.();
        break;
    }
    if (d.t !== "walk") this.app.commit();
  }
  private chainTemp: WalkNode | null = null;
  snapped = false;
  private housesChanged = false;
  cancelDrag() {
    if (!this.drag) return;
    if (this.drag.t === "walk") { this.chain = null; this.chainTemp = null; this.walkLift = 0; }
    this.drag = null; this.housesChanged = false;
    this.layer.held = null;
    try { this.dom.releasePointerCapture(this.pointerId); } catch { /* not captured */ }
    this.app.cancel(); this.pointerId = -1;
    if (this.sel?.kind === "house") { const h = this.world.houses.get(this.sel.id); if (h && this.sel.vi >= h.volumes.length) this.sel.vi = 0; }
    this.refreshHandles(); this.refreshHighlight(); this.updateGhost(); this.onChange?.();
  }

  private wheel(e: WheelEvent) {
    if (this.tool === "prop" && e.shiftKey) { e.preventDefault(); this.propRot += Math.sign(e.deltaY) * Math.PI / 12; this.updateGhost(); }
    else if ((this.tool === "terrain" || this.tool === "paint") && e.shiftKey) { e.preventDefault(); this.setBrush(this.brush - Math.sign(e.deltaY) * 0.5); }
    else if (this.tool === "walk" && e.shiftKey) { e.preventDefault(); this.nudgeLift(-Math.sign(e.deltaY)); }
  }

  // ---------- keyboard-facing actions ----------
  setBrush(b: number) { this.brush = Math.max(0.5, Math.min(6, b)); this.updateBrush(); this.onChange?.(); }
  nudgeLift(dir: number) { this.walkLift = Math.max(-2, Math.min(8, this.walkLift + dir * 0.25)); this.updateGhost(); this.onChange?.(); }
  rotate() {
    if (this.tool === "prop" || this.placingSpecial) {
      if (this.placingType === "hull") this.landFlip = !this.landFlip;
      else if (this.placingType === "grotto") { const d = GROTTO_OPTS.dock; const cur = propOpt({ seed: this.propSeed, opts: this.ghostOpts }, "dock", d); this.ghostOpts = { ...this.ghostOpts, dock: d[(d.indexOf(cur) + 1) % d.length] }; }
      else if (isShop(this.placingType)) {
        const h = this.hover;
        const rot = this.shopHeading ?? (h ? this.fitAt(this.placingType, h.x, h.z).rot : 0);
        this.shopHeading = (rot + Math.PI / 2) % (Math.PI * 2);
      } else this.propRot += Math.PI / 4;
      this.updateGhost(); this.onChange?.(); return;
    }
    if (this.tool === "house") { this.houseTurn = !this.houseTurn; this.updateGhost(); return; }
    const s = this.sel;
    if (s?.kind === "prop") { const p = this.world.props.get(s.id); if (p && p.type !== "grotto") { this.app.begin(); const old = p.rot; p.rot += p.type === "hull" ? Math.PI : isShop(p.type) ? Math.PI / 2 : Math.PI / 4; if (isShop(p.type)) { const f = fitLandmark(this.world, p.type, p.x, p.z, p.seed, p.opts, false, p.id, p.rot); if (!f.ok || Math.cos(f.rot - p.rot) < 0.99) { p.rot = old; this.app.cancel(); this.toast("That entrance won't fit here"); return; } p.x = f.x; p.z = f.z; } this.app.changed({ structures: true }); } }
    else if (s?.kind === "house") this.houseEdit("ridge");
  }
  deleteSelection() {
    const s = this.sel; if (!s) return;
    this.app.begin();
    if (s.kind === "house") {
      const h = this.world.houses.get(s.id);
      if (h && h.volumes.length > 1 && s.vi > 0) { h.volumes.splice(s.vi, 1); this.select({ kind: "house", id: h.id, vi: 0 }); }
      else { this.world.houses.delete(s.id); this.select(null); }
    } else if (s.kind === "node") { this.app.removePost(s.id); this.select(null); }
    else if (s.kind === "edge") { this.world.edges.delete(s.id); this.world.pruneNodes(); this.select(null); }
    else if (s.kind === "prop") {
      const pr = this.world.props.get(s.id);
      this.world.props.delete(s.id); this.select(null);
      if (pr?.type === "grotto") this.app.changed({ terrain: true });
    }
    this.app.changed({ structures: true });
  }
  escape() {
    if (this.drag) { this.cancelDrag(); return; }
    if (this.chain) { this.endChain(); return; }
    if (this.sel) this.select(null); else if (this.tool !== "select") this.setTool("select");
  }
  endChain() { this.app.cancel(); this.chain = null; this.chainTemp = null; this.walkLift = 0; this.updateGhost(); this.onChange?.(); }

  // ---------- houses ----------
  private rectFrom(a: THREE.Vector3, b: THREE.Vector3, moved: boolean) {
    const P = HOUSE_PRESETS[this.preset];
    let x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), z0 = Math.min(a.z, b.z), z1 = Math.max(a.z, b.z);
    if (!moved || x1 - x0 < 1 || z1 - z0 < 1) {
      const w = this.houseTurn ? P.d : P.w, dd = this.houseTurn ? P.w : P.d;
      x0 = snap(a.x - w / 2); z0 = snap(a.z - dd / 2); x1 = x0 + w; z1 = z0 + dd;
    }
    return { x0, z0, x1, z1 };
  }
  private previewHouse(r: { x0: number; z0: number; x1: number; z1: number }): House {
    const P = HOUSE_PRESETS[this.preset];
    const v = newVolume(r.x0, r.z0, r.x1, r.z1, P.floors, P.roof);
    if (P.kind) v.kind = P.kind;
    return makeHouse("ghost", this.ghostSeed, [v]);
  }
  private ghostSeed = Math.random();
  /** placing turned a quarter: the preset's width and depth swap */
  private houseTurn = false;
  /** Would this house hang off a drop too steep to stand on? A house already there may still move to somewhere no worse. */
  private steep(h: House, before?: number) {
    const d = siteDrop(this.world, h);
    return d > MAX_SITE_DROP + 1e-6 && (before === undefined || d > before + 1e-6);
  }
  private commitHouse(a: THREE.Vector3, b: THREE.Vector3, moved: boolean) {
    const r = this.rectFrom(a, b, moved);
    if (!this.world.footprintFree(r.x0, r.z0, r.x1, r.z1)) { this.toast("Not enough room there"); this.updateGhost(); return; }
    const h = this.previewHouse(r);
    if (this.steep(h)) { this.toast("Too steep here"); this.updateGhost(); return; }
    this.app.begin();
    h.id = uid("h");
    this.world.houses.set(h.id, h);
    this.ghostSeed = Math.random();
    this.app.changed({ structures: true });
    this.setTool("select");
    this.select({ kind: "house", id: h.id, vi: 0 });
  }
  private toggleBay(id: string, point: THREE.Vector3, normal: THREE.Vector3) {
    const h = this.world.houses.get(id); if (!h) return false;
    if (Math.abs(normal.y) > 0.5) return false;
    const lay = houseLayout(this.world, h);
    let best: Bay | null = null, bd = 0.25;
    for (const b of lay.bays) {
      const [ax, az] = b.a, [bx, bz] = b.b;
      const len = Math.hypot(bx - ax, bz - az);
      const t = ((point.x - ax) * (bx - ax) + (point.z - az) * (bz - az)) / len;
      if (t < 0 || t > len || point.y < b.y0 - 0.05 || point.y > b.y0 + FLOOR_H + 0.05) continue;
      const off = Math.abs((point.x - ax) * b.n[0] + (point.z - az) * b.n[1]);
      if (off < bd) { bd = off; best = b; }
    }
    if (!best) return false;
    this.app.begin();
    const v = h.volumes[best.vi];
    v.openings = v.openings ?? {};
    const next = best.kind === "window" ? "wall" : best.kind === "wall" ? (best.floor === 0 ? "door" : "window") : "window";
    v.openings[best.key] = next;
    this.app.changed({ structures: true });
    this.toast(next === "door" ? "Door" : next === "window" ? "Window" : "Plain wall");
    return true;
  }
  /** Panel/keyboard edits on the selected house. */
  houseEdit(op: string, val?: any) {
    const s = this.sel; if (s?.kind !== "house") return;
    const h = this.world.houses.get(s.id); if (!h) return;
    const v = h.volumes[s.vi] ?? h.volumes[0];
    const live = op === "pitch" || op === "curve" || op === "overhang";
    if (!this.app.edits.active) this.app.begin();
    switch (op) {
      case "roof": v.roof = val; break;
      case "pitch": v.pitch = val; break;
      case "curve": v.curve = val; break;
      case "overhang": v.overhang = val; break;
      case "ridge": v.ridgeX = !(v.ridgeX ?? (v.x1 - v.x0 >= v.z1 - v.z0)); break;
      case "floors": v.floors = Math.max(1, Math.min(4, v.floors + val)); break;
      case "palette": h.palette = val; break;
      case "style": h.style = val; break;
      case "foundation": h.foundation = val; break;
      case "toggle": (h as any)[val] = !(h as any)[val]; break;
      case "reroll": h.seed = Math.random(); for (const vv of h.volumes) delete vv.openings; break;
      case "kind": v.kind = val === "room" ? undefined : val; break;
      case "wing": { if (!this.addWing(h, val)) { this.app.cancel(); this.toast("No free side for a wing"); return; } break; }
      default: this.app.cancel(); return;
    }
    this.app.changed({ structures: true });
    this.refreshHandles();
    if (!live) this.onChange?.();
  }
  private addWing(h: House, kind: "room" | "tower" | "lookout" | "shed") {
    const main = h.volumes[this.sel?.kind === "house" ? this.sel.vi : 0] ?? h.volumes[0];
    const size = kind === "shed" ? [2, 1.5] : kind === "room" ? [2.5, 2] : [2, 2];
    for (let s = 0; s < 4; s++) {
      const [nx, nz] = SIDE_N[s];
      const alongX = nz !== 0;
      const len = size[0], dep = size[1];
      const mid = alongX ? snap((main.x0 + main.x1) / 2) : snap((main.z0 + main.z1) / 2);
      for (const shift of [0, -1, 1, -1.5, 1.5]) {
        const c = mid + shift;
        let r: { x0: number; z0: number; x1: number; z1: number };
        if (alongX) { const z = nz > 0 ? main.z1 : main.z0 - dep; r = { x0: snap(c - len / 2), x1: snap(c - len / 2) + len, z0: z, z1: z + dep }; }
        else { const x = nx > 0 ? main.x1 : main.x0 - dep; r = { z0: snap(c - len / 2), z1: snap(c - len / 2) + len, x0: x, x1: x + dep }; }
        if (!this.world.footprintFree(r.x0, r.z0, r.x1, r.z1)) continue;
        if (h.volumes.some(o => r.x0 < o.x1 - 0.01 && r.x1 > o.x0 + 0.01 && r.z0 < o.z1 - 0.01 && r.z1 > o.z0 + 0.01)) continue;
        const v = newVolume(r.x0, r.z0, r.x1, r.z1, kind === "shed" ? 1 : kind === "room" ? Math.max(1, main.floors - 1) : main.floors + 1, kind === "shed" ? "shed" : kind === "room" ? "gable" : "hip");
        if (this.steep({ ...h, volumes: [...h.volumes, v] }, siteDrop(this.world, h))) continue;
        if (kind === "shed") v.ridgeX = !alongX;
        if (kind === "tower" || kind === "lookout") v.kind = kind;
        h.volumes.push(v);
        this.sel = { kind: "house", id: h.id, vi: h.volumes.length - 1 };
        return true;
      }
    }
    return false;
  }

  // ---------- handles ----------
  /** Which part of the selected house the pointer is over: a wall reveals its wing handles, the roof its lift handles. */
  reveal: { side: number } | { roof: true } | null = null;
  private revealTimer = 0;
  /** Show the wing (side) or lift ("roof") handles of a selected volume, as hovering would. */
  revealFor(part: number | "roof" | null) { clearTimeout(this.revealTimer); this.revealTimer = 0; this.reveal = part === null ? null : part === "roof" ? { roof: true } : { side: part }; this.refreshHandles(); }
  private setReveal(r: Tools["reveal"]) {
    if (r === null && this.reveal) {
      // a short grace so moving from the wall to a handle doesn't drop it
      if (!this.revealTimer) this.revealTimer = window.setTimeout(() => { this.revealTimer = 0; this.reveal = null; this.refreshHandles(); }, 300);
      return;
    }
    clearTimeout(this.revealTimer); this.revealTimer = 0;
    if (JSON.stringify(r) === JSON.stringify(this.reveal)) return;
    this.reveal = r; this.refreshHandles();
  }
  /** Hover tracking for the select tool: light the handle under the pointer, reveal wing/lift handles for the wall or roof under it. */
  private hoverHandles() {
    const hnd = this.pickHandle();
    this.layer.setHot(hnd);
    this.dom.style.cursor = hnd ? "grab" : "";
    const s = this.sel;
    if (s?.kind !== "house") return;
    if (hnd) { this.setReveal(this.reveal); return; }
    // cheap box test first: the full structure raycast only runs over the selected part
    const hb = this.world.houses.get(s.id), vb = hb?.volumes[s.vi];
    if (!hb || !vb) return;
    const lb = houseLayout(this.world, hb).base, box = this.hoverBox.set(new THREE.Vector3(vb.x0 - 0.3, lb, vb.z0 - 0.3), new THREE.Vector3(vb.x1 + 0.3, lb + vb.floors * FLOOR_H + Math.max(vb.x1 - vb.x0, vb.z1 - vb.z0) * 1.5, vb.z1 + 0.3));
    if (!this.ray.ray.intersectsBox(box)) { this.setReveal(null); return; }
    const p = this.pick();
    const o = p && this.ownerToSel(p.owner);
    const h = this.world.houses.get(s.id), v = h?.volumes[s.vi];
    if (!p || !h || !v || o?.kind !== "house" || o.id !== s.id || o.vi !== s.vi) { this.setReveal(null); return; }
    const eave = houseLayout(this.world, h).base + v.floors * FLOOR_H;
    if (p.point.y > eave - 0.05) { this.setReveal({ roof: true }); return; }
    const d = [v.z1 - p.point.z, v.x1 - p.point.x, p.point.z - v.z0, p.point.x - v.x0].map(Math.abs);
    this.setReveal({ side: d.indexOf(Math.min(...d)) });
  }
  frame() {
    const c = this.app.d.camera as THREE.PerspectiveCamera;
    this.layer.frame(c, this.dom.clientHeight || window.innerHeight, this.dom.clientWidth || window.innerWidth);
  }
  refreshHandles() {
    const L = this.layer;
    const held = L.held?.userData.handle ? JSON.stringify(L.held.userData.handle) : null;
    L.clear();
    const s = this.sel;
    if (s) this.buildHandles(s);
    if (held && this.drag) L.held = L.handles.find(m => JSON.stringify(m.userData.handle) === held) ?? null;
    this.frame();
  }
  private buildHandles(s: Selection) {
    const L = this.layer, V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    const C = { stretch: "#fff1c9", wing: "#6fdcc9", lift: "#f2a65a", move: "#8fd3f0", height: "#e6a676" };
    const cam = this.app.d.camera.position;
    if (s.kind === "house") {
      const h = this.world.houses.get(s.id); if (!h) return;
      const v = h.volumes[s.vi] ?? h.volumes[0];
      const lay = houseLayout(this.world, h);
      const base = lay.base, eave = base + v.floors * FLOOR_H;
      // outline of the selected part
      const e = 0.12, x0 = v.x0 - e, x1 = v.x1 + e, z0 = v.z0 - e, z1 = v.z1 + e;
      const ring = (y: number) => [V(x0, y, z0), V(x1, y, z0), V(x1, y, z0), V(x1, y, z1), V(x1, y, z1), V(x0, y, z1), V(x0, y, z1), V(x0, y, z0)];
      L.setLines([...ring(base), ...ring(eave), ...[[x0, z0], [x1, z0], [x1, z1], [x0, z1]].flatMap(([x, z]) => [V(x, base, z), V(x, eave, z)])]);
      // stretch: one arrow per wall
      const yMid = base + Math.min(v.floors, 2) * FLOOR_H * 0.5;
      for (let side = 0; side < 4; side++) {
        const S = sideLine(v, side);
        // sit on a stretch of wall that another part of the house does not cover
        const at = (f: number, out: number) => [S.a[0] + (S.b[0] - S.a[0]) * f + S.n[0] * out, S.a[1] + (S.b[1] - S.a[1]) * f + S.n[1] * out];
        const covers = (f: number) => h.volumes.filter((o, oi) => { const [x, z] = at(f, 0.1); return oi !== s.vi && x > o.x0 && x < o.x1 && z > o.z0 && z < o.z1; });
        const f = [0.5, 0.35, 0.65, 0.2, 0.8, 0.08, 0.92].find(f => !covers(f).length);
        const [cx, cz] = at(f ?? 0.5, 0.55);
        const y = f !== undefined ? yMid : Math.max(...covers(0.5).map(o => base + o.floors * FLOOR_H)) + 0.5;
        L.add(V(cx, y, cz), { t: "side", side }, { glyph: "arrow", color: C.stretch, dir: V(S.n[0], 0, S.n[1]) });
      }
      const rv = this.reveal;
      // wing: each stretch of the hovered wall can be pulled out
      if (rv && "side" in rv) {
        const side = rv.side, S = sideLine(v, side), along = side % 2 === 0;
        const lo = along ? v.x0 : v.z0, hi = along ? v.x1 : v.z1, yT = base + 0.28;
        for (const [a, b] of segments(lo, hi)) {
          const c = (a + b) / 2;
          const ox = along ? c : S.a[0] + S.n[0] * 0.1, oz = along ? S.a[1] + S.n[1] * 0.1 : c;
          if (h.volumes.some((o, oi) => oi !== s.vi && ox > o.x0 && ox < o.x1 && oz > o.z0 && oz < o.z1)) continue;
          const px = along ? c : S.a[0] + S.n[0] * 0.32, pz = along ? S.a[1] + S.n[1] * 0.32 : c;
          L.add(V(px, yT, pz), { t: "seg", side, a, b }, { glyph: "plus", color: C.wing, px: 9 });
        }
        const o = 0.04, [ax, az] = [S.a[0] + S.n[0] * o, S.a[1] + S.n[1] * o], [bx, bz] = [S.b[0] + S.n[0] * o, S.b[1] + S.n[1] * o];
        L.setWash([[V(ax, base, az), V(bx, base, bz), V(bx, eave, bz), V(ax, eave, az)]]);
      }
      // lift: each stretch along the ridge can be raised, from the eave nearest the camera
      if (rv && "roof" in rv && (v.kind ?? "room") === "room") {
        const alongX = v.x1 - v.x0 >= v.z1 - v.z0;
        const lo = alongX ? v.x0 : v.z0, hi = alongX ? v.x1 : v.z1;
        const segs = segments(lo, hi);
        const near = alongX ? (cam.z > (v.z0 + v.z1) / 2 ? v.z1 + 0.3 : v.z0 - 0.3) : (cam.x > (v.x0 + v.x1) / 2 ? v.x1 + 0.3 : v.x0 - 0.3);
        if (segs.length > 1) for (const [a, b] of segs) {
          const c = (a + b) / 2;
          L.add(alongX ? V(c, eave + 0.25, near) : V(near, eave + 0.25, c), { t: "lift", alongX, a, b }, { glyph: "updown", color: C.lift, px: 9 });
        }
      }
      // move and floors sit just over the roof
      const kind = v.kind ?? "room", w = v.x1 - v.x0, d = v.z1 - v.z0;
      const span = (v.ridgeX ?? w >= d) ? d : w, pitch = kind === "tower" ? Math.max(1.4, v.pitch) : v.pitch;
      const rise = v.roof === "flat" && kind !== "tower" ? 0.2 : span * (v.roof === "shed" && kind !== "tower" ? 0.42 : 0.5) * 0.95 * pitch + 0.06;
      const top = V((v.x0 + v.x1) / 2, eave + rise + 0.3, (v.z0 + v.z1) / 2);
      L.add(top, { t: "move" }, { glyph: "move", color: C.move });
      L.add(top, { t: "floors" }, { glyph: "floors", color: C.height, slot: 1 });
    } else if (s.kind === "node") {
      const n = this.world.nodes.get(s.id); if (!n) return;
      const at = V(n.x, n.y + 0.2, n.z);
      L.add(at, { t: "nodeXZ", id: n.id }, { glyph: "move", color: C.move });
      L.add(at, { t: "nodeY" }, { glyph: "updown", color: C.height, slot: 1 });
      // a dead end can be pulled onward
      const es = this.world.edgesOf(n.id);
      if (es.length === 1) {
        const o = this.world.nodes.get(es[0].a === n.id ? es[0].b : es[0].a);
        if (o) {
          const dx = n.x - o.x, dz = n.z - o.z, l = Math.hypot(dx, dz) || 1;
          L.add(V(n.x + dx / l * 0.55, n.y + 0.2, n.z + dz / l * 0.55), { t: "extend", id: n.id }, { glyph: "arrow", color: C.stretch, dir: V(dx, 0, dz) });
        }
      }
    } else if (s.kind === "edge") {
      const e = this.world.edges.get(s.id); if (!e) return;
      for (const id of [e.a, e.b]) {
        const n = this.world.nodes.get(id); if (!n) continue;
        L.add(V(n.x, n.y + 0.2, n.z), { t: "nodeXZ", id: n.id }, { glyph: "move", color: C.move });
      }
    } else if (s.kind === "prop") {
      const p = this.world.props.get(s.id); if (!p) return;
      // in front of the prop, toward the camera, so the prop itself never hides it
      const r = PROP_INFO[p.type].r + 0.2, dx = cam.x - p.x, dz = cam.z - p.z, l = Math.hypot(dx, dz) || 1;
      const x = p.x + dx / l * r, z = p.z + dz / l * r;
      L.add(V(x, Math.max(this.world.height(x, z), WATER_Y) + 0.25, z), { t: "propXZ", id: p.id }, { glyph: "move", color: C.move });
    }
  }
  private refreshHighlight() {
    const s = this.sel;
    let r = [-100, -100, -100, -100];
    if (s?.kind === "house") { const h = this.world.houses.get(s.id); const v = h?.volumes[s.vi]; if (v) r = [v.x0 - 0.02, v.z0 - 0.02, v.x1 + 0.02, v.z1 + 0.02]; }
    else if (s?.kind === "prop") { const p = this.world.props.get(s.id); if (p) { const rr = PROP_INFO[p.type].r; r = [p.x - rr, p.z - rr, p.x + rr, p.z + rr]; } }
    else if (s?.kind === "node") { const n = this.world.nodes.get(s.id); if (n) { const rr = landingRadius(this.world, n); r = [n.x - rr, n.z - rr, n.x + rr, n.z + rr]; } }
    else if (s?.kind === "edge") { const e = this.world.edges.get(s.id); const a = e && this.world.nodes.get(e.a), b = e && this.world.nodes.get(e.b); if (a && b) r = [Math.min(a.x, b.x) - 0.3, Math.min(a.z, b.z) - 0.3, Math.max(a.x, b.x) + 0.3, Math.max(a.z, b.z) + 0.3]; }
    U.highlight.value.set(r[0], r[1], r[2], r[3]);
  }
  private startHandle(o: THREE.Object3D, e: PointerEvent) {
    const d = o.userData.handle as { t: string; side?: number };
    const s = this.sel!;
    this.app.begin(true);
    this.housesChanged = false;
    this.layer.held = o;
    const hd = o.userData.handle as { t: string; id?: string; side?: number; a?: number; b?: number; alongX?: boolean };
    if (hd.t === "nodeXZ") {
      const n = this.world.nodes.get(hd.id!)!; const g = this.surface() ?? new THREE.Vector3(n.x, n.y, n.z);
      this.drag = { t: "nodeMove", id: n.id, start: g.clone(), ox: n.x, oz: n.z, changed: false }; return;
    }
    if (hd.t === "propXZ") {
      const pr = this.world.props.get(hd.id!)!; const g = this.surface() ?? new THREE.Vector3(pr.x, 0, pr.z);
      this.drag = { t: "propMove", id: pr.id, start: g.clone(), ox: pr.x, oz: pr.z, changed: false }; return;
    }
    if (hd.t === "extend") { this.drag = { t: "extend", from: hd.id!, node: null, changed: false }; return; }
    if (s.kind === "node") { const n = this.world.nodes.get(s.id)!; this.drag = { t: "nodeY", id: s.id, y0: n.y, oy: e.clientY, changed: false }; return; }
    if (s.kind !== "house") return;
    if (hd.t === "seg" || hd.t === "lift") {
      const h0 = this.world.houses.get(s.id)!;
      const orig0: House = JSON.parse(JSON.stringify(h0));
      const v0 = h0.volumes[s.vi];
      if (hd.t === "seg") {
        const side = hd.side!;
        const wall = side === 0 ? v0.z1 : side === 1 ? v0.x1 : side === 2 ? v0.z0 : v0.x0;
        this.drag = { t: "seg", side, a: hd.a!, b: hd.b!, orig: orig0, vi: s.vi, wall };
      } else this.drag = { t: "lift", alongX: hd.alongX!, a: hd.a!, b: hd.b!, orig: orig0, vi: s.vi, y0: e.clientY, df: 0 };
      return;
    }
    const h = this.world.houses.get(s.id)!;
    const orig: House = JSON.parse(JSON.stringify(h));
    if (d.t === "side") {
      const v = h.volumes[s.vi];
      const side = d.side!;
      const plane = o.position.y;
      const hit = this.planeHit(plane);
      const coord = side === 0 ? v.z1 : side === 1 ? v.x1 : side === 2 ? v.z0 : v.x0;
      const along = hit ? (side % 2 ? hit.x : hit.z) : coord;
      let wingVi: number | undefined;
      if (e.shiftKey) {
        // extrude a new wing from the middle of this side
        const L = sideLine(v, side);
        const len = Math.hypot(L.b[0] - L.a[0], L.b[1] - L.a[1]);
        const wl = Math.max(1, snap(len * 0.6));
        const mx = snap((L.a[0] + L.b[0]) / 2 - (side % 2 ? 0 : wl / 2)), mz = snap((L.a[1] + L.b[1]) / 2 - (side % 2 ? wl / 2 : 0));
        let nv: Volume;
        if (side === 0) nv = newVolume(mx, v.z1, mx + wl, v.z1 + 0.5, Math.max(1, v.floors - 1), v.roof === "flat" ? "flat" : "gable");
        else if (side === 2) nv = newVolume(mx, v.z0 - 0.5, mx + wl, v.z0, Math.max(1, v.floors - 1), v.roof === "flat" ? "flat" : "gable");
        else if (side === 1) nv = newVolume(v.x1, mz, v.x1 + 0.5, mz + wl, Math.max(1, v.floors - 1), v.roof === "flat" ? "flat" : "gable");
        else nv = newVolume(v.x0 - 0.5, mz, v.x0, mz + wl, Math.max(1, v.floors - 1), v.roof === "flat" ? "flat" : "gable");
        h.volumes.push(nv);
        wingVi = h.volumes.length - 1;
        this.sel = { kind: "house", id: h.id, vi: wingVi };
      }
      this.drag = { t: "side", side, grab: along - coord, plane, orig, extrude: e.shiftKey, wingVi, doors: this.doorEnds(h) };
    } else if (d.t === "move") {
      const g = this.ground() ?? new THREE.Vector3();
      this.drag = { t: "move", start: g.clone(), orig, doors: this.doorEnds(h) };
    } else if (d.t === "floors") {
      this.drag = { t: "floors", y0: e.clientY, floors0: h.volumes[s.vi].floors };
    }
  }
  /** Pull one wall segment out into a new wing (or push an existing wing on that segment further). */
  private dragSeg(d: Extract<Drag, { t: "seg" }>) {
    const s = this.sel; if (s?.kind !== "house") return;
    const h = this.world.houses.get(s.id); if (!h) return;
    const lay = houseLayout(this.world, h);
    const hit = this.planeHit(lay.base + 0.28); if (!hit) return;
    const [nx, nz] = SIDE_N[d.side];
    const out = (hit.x - (d.side % 2 ? d.wall : 0)) * nx + (hit.z - (d.side % 2 ? 0 : d.wall)) * nz;
    const depth = Math.max(0, Math.min(6, snap(out)));
    const base = d.orig;
    const vols = base.volumes.map(v => ({ ...v }));
    const par = vols[d.vi];
    if (depth >= 0.5) {
      let r: { x0: number; z0: number; x1: number; z1: number };
      if (d.side === 0) r = { x0: d.a, x1: d.b, z0: par.z1, z1: par.z1 + depth };
      else if (d.side === 2) r = { x0: d.a, x1: d.b, z0: par.z0 - depth, z1: par.z0 };
      else if (d.side === 1) r = { z0: d.a, z1: d.b, x0: par.x1, x1: par.x1 + depth };
      else r = { z0: d.a, z1: d.b, x0: par.x0 - depth, x1: par.x0 };
      // if a wing already fills this segment, grow that one instead of stacking a new one
      const hitWing = vols.findIndex((o, oi) => oi !== d.vi && o.x0 <= r.x0 + 1e-3 && o.x1 >= r.x1 - 1e-3 && o.z0 <= r.z0 + 1e-3 && o.z1 >= r.z1 - 1e-3);
      if (hitWing >= 0) { this.toast("That stretch already has a wing — select it to reshape"); return; }
      if (!this.world.footprintFree(r.x0, r.z0, r.x1, r.z1, h, 0.5)) return;
      if (vols.some(o => r.x0 < o.x1 - 0.01 && r.x1 > o.x0 + 0.01 && r.z0 < o.z1 - 0.01 && r.z1 > o.z0 + 0.01)) return;
      const nv = newVolume(r.x0, r.z0, r.x1, r.z1, par.floors, par.roof === "flat" ? "flat" : par.roof === "shed" ? "shed" : "gable");
      nv.ridgeX = d.side % 2 === 1; // gable end faces out
      nv.pitch = par.pitch; nv.curve = par.curve; nv.overhang = Math.min(par.overhang, 0.18);
      if (this.steep({ ...h, volumes: [...vols, nv] }, siteDrop(this.world, base))) return;
      vols.push(nv);
    }
    const key = JSON.stringify(vols);
    if (key === JSON.stringify(h.volumes)) return;
    h.volumes = vols;
    this.housesChanged = true;
    this.app.changed({ structures: true });
    this.refreshHighlight();
  }
  /** Raise or lower one stretch of a volume: it splits into up to three parts; the parts left lower become flat roof terraces. */
  private dragLift(d: Extract<Drag, { t: "lift" }>, e: PointerEvent) {
    const s = this.sel; if (s?.kind !== "house") return;
    const h = this.world.houses.get(s.id); if (!h) return;
    const ov = d.orig.volumes[d.vi];
    const df = Math.max(1 - ov.floors, Math.min(3, Math.round((d.y0 - e.clientY) / 45)));
    if (df === d.df) return;
    d.df = df;
    const vols = d.orig.volumes.map(v => ({ ...v }));
    if (df !== 0) {
      const lo = d.alongX ? ov.x0 : ov.z0, hi = d.alongX ? ov.x1 : ov.z1;
      const piece = (p0: number, p1: number) => d.alongX ? { ...ov, x0: p0, x1: p1, openings: undefined } : { ...ov, z0: p0, z1: p1, openings: undefined };
      const parts: Volume[] = [];
      if (d.a - lo > 1e-3) parts.push(piece(lo, d.a));
      const mid = piece(d.a, d.b);
      mid.floors = ov.floors + df;
      parts.push(mid);
      if (hi - d.b > 1e-3) parts.push(piece(d.b, hi));
      for (const p of parts) {
        if (p === mid) { if (df < 0) p.roof = "flat"; continue; }
        if (df > 0) p.roof = "flat"; // the lower parts become a terrace to step out onto
        p.ridgeX = ov.ridgeX ?? (ov.x1 - ov.x0 >= ov.z1 - ov.z0);
      }
      mid.ridgeX = df > 0 ? !(ov.ridgeX ?? (ov.x1 - ov.x0 >= ov.z1 - ov.z0)) : mid.ridgeX;
      vols.splice(d.vi, 1, ...parts);
      this.sel = { kind: "house", id: h.id, vi: d.vi + parts.indexOf(mid) };
    } else this.sel = { kind: "house", id: h.id, vi: d.vi };
    h.volumes = vols;
    this.housesChanged = true;
    this.app.changed({ structures: true });
    this.refreshHighlight(); this.onChange?.();
  }
  /** Pull a new walkway segment out of a dead end. */
  private dragExtend(d: Extract<Drag, { t: "extend" }>) {
    const from = this.world.nodes.get(d.from); if (!from) return;
    const g = this.surface(); if (!g) return;
    // pulled up to a house it docks at the wall, so it really opens a door
    const dock = this.wallDock(g, () => from.y);
    const x = dock?.x ?? Math.round(g.x * 4) / 4, z = dock?.z ?? Math.round(g.z * 4) / 4;
    if (Math.hypot(x - from.x, z - from.z) < 0.6) return;
    if (!d.node) {
      d.node = this.app.addNode(x, z, from.y);
      const e0 = this.world.edgesOf(from.id)[0];
      this.app.addEdge(from, d.node, e0?.style ?? "deck", e0?.width ?? WALK_W);
    }
    d.node.x = x; d.node.z = z;
    // follow the ground up and down gently; over water stay at deck height
    const want = defaultDeckY(this.world, x, z);
    const most = MAX_STAIR * Math.hypot(x - from.x, z - from.z);
    d.node.y = dock ? dock.y : Math.abs(want - from.y) < 0.6 ? from.y : from.y + Math.max(-most, Math.min(most, want - from.y));
    d.changed = true;
    this.app.changed({ structures: true });
  }
  private planeHit(y: number) {
    const r = this.ray.ray;
    if (Math.abs(r.direction.y) < 1e-4) return null;
    const t = (y - r.origin.y) / r.direction.y;
    return t > 0 ? r.at(t, new THREE.Vector3()) : null;
  }
  private dragSide(d: Extract<Drag, { t: "side" }>) {
    const s = this.sel; if (s?.kind !== "house") return;
    const h = this.world.houses.get(s.id); if (!h) return;
    const hit = this.planeHit(d.plane); if (!hit) return;
    const vi = d.wingVi ?? s.vi;
    const v = h.volumes[vi];
    const side = d.side;
    const along = (side % 2 ? hit.x : hit.z) - (d.extrude ? 0 : d.grab);
    const val = snap(along);
    const ov = d.orig.volumes[s.vi] ?? d.orig.volumes[0];
    const test: Volume = { ...v };
    const minSize = 1;
    if (d.extrude) {
      if (side === 0) test.z1 = Math.max(ov.z1 + minSize, val);
      else if (side === 2) test.z0 = Math.min(ov.z0 - minSize, val);
      else if (side === 1) test.x1 = Math.max(ov.x1 + minSize, val);
      else test.x0 = Math.min(ov.x0 - minSize, val);
    } else {
      if (side === 0) test.z1 = Math.max(v.z0 + minSize, val);
      else if (side === 2) test.z0 = Math.min(v.z1 - minSize, val);
      else if (side === 1) test.x1 = Math.max(v.x0 + minSize, val);
      else test.x0 = Math.min(v.x1 - minSize, val);
    }
    if (test.x0 === v.x0 && test.x1 === v.x1 && test.z0 === v.z0 && test.z1 === v.z1) return;
    if (test.x1 - test.x0 > 9 || test.z1 - test.z0 > 9) return;
    if (!this.world.footprintFree(test.x0, test.z0, test.x1, test.z1, h)) return;
    if (h.volumes.some((o, oi) => oi !== vi && test.x0 < o.x1 - 0.01 && test.x1 > o.x0 + 0.01 && test.z0 < o.z1 - 0.01 && test.z1 > o.z0 + 0.01)) return;
    if (this.steep({ ...h, volumes: h.volumes.map((o, oi) => (oi === vi ? { ...o, ...test } : o)) }, siteDrop(this.world, h))) return;
    // wings attached to the moving side ride along with it
    if (!d.extrude) {
      const oldC = side === 0 ? v.z1 : side === 1 ? v.x1 : side === 2 ? v.z0 : v.x0;
      const newC = side === 0 ? test.z1 : side === 1 ? test.x1 : side === 2 ? test.z0 : test.x0;
      const delta = newC - oldC;
      h.volumes.forEach((o, oi) => {
        if (oi === vi) return;
        const touches = side === 0 ? Math.abs(o.z0 - oldC) < 1e-3 : side === 2 ? Math.abs(o.z1 - oldC) < 1e-3 : side === 1 ? Math.abs(o.x0 - oldC) < 1e-3 : Math.abs(o.x1 - oldC) < 1e-3;
        const overlap = side % 2 ? o.z0 < v.z1 && o.z1 > v.z0 : o.x0 < v.x1 && o.x1 > v.x0;
        if (touches && overlap) { if (side % 2) { o.x0 += delta; o.x1 += delta; } else { o.z0 += delta; o.z1 += delta; } }
      });
    }
    Object.assign(v, { x0: test.x0, x1: test.x1, z0: test.z0, z1: test.z1 });
    this.followDoors(h, d.orig, d.doors);
    this.housesChanged = true;
    this.app.changed({ structures: true });
    this.refreshHandles(); this.refreshHighlight();
  }
  private dragMove(d: Extract<Drag, { t: "move" }>) {
    const s = this.sel; if (s?.kind !== "house") return;
    const h = this.world.houses.get(s.id); if (!h) return;
    const g = this.ground(); if (!g) return;
    const dx = snap(g.x - d.start.x), dz = snap(g.z - d.start.z);
    const vols = d.orig.volumes.map(v => ({ ...v, x0: v.x0 + dx, x1: v.x1 + dx, z0: v.z0 + dz, z1: v.z1 + dz }));
    if (vols.every((v, i) => v.x0 === h.volumes[i].x0 && v.z0 === h.volumes[i].z0)) return;
    if (!vols.every(v => this.world.footprintFree(v.x0, v.z0, v.x1, v.z1, h))) return;
    if (this.steep({ ...h, volumes: vols }, siteDrop(this.world, d.orig))) return;
    h.volumes = vols;
    this.followDoors(h, d.orig, d.doors);
    this.housesChanged = true;
    this.app.changed({ structures: true });
    this.refreshHandles(); this.refreshHighlight();
  }
  /** The walkway ends that open doors in this house. */
  private doorEnds(h: House): DoorEnd[] {
    const w = this.world, base = houseLayout(w, h).base, out: DoorEnd[] = [];
    for (const n of w.nodes.values()) {
      if (!w.edgesOf(n.id).length || !nearWalls(h, n.x, n.z)) continue;
      const hit = nodeWall(h, n, base);
      if (hit) out.push({ id: n.id, vi: hit.vi, side: hit.side, t: hit.t, d: hit.d, floor: hit.floor });
    }
    return out;
  }
  /**
   * Keep door ends on their walls after the house moved or a side was pulled: the same storey, the same distance out,
   * and the same spot along the wall (carried with the wall when the whole volume shifted, clamped when it shrank).
   */
  private followDoors(h: House, orig: House, doors: DoorEnd[]) {
    if (!doors.length) return;
    const w = this.world, base = houseLayout(w, h).base;
    for (const dr of doors) {
      const n = w.nodes.get(dr.id), v = h.volumes[dr.vi], ov = orig.volumes[dr.vi]; if (!n || !v || !ov) continue;
      const alongX = dr.side % 2 === 0;
      const lo = alongX ? v.x0 : v.z0, hi = alongX ? v.x1 : v.z1;
      const olo = alongX ? ov.x0 : ov.z0, ohi = alongX ? ov.x1 : ov.z1;
      const shift = Math.abs((lo - olo) - (hi - ohi)) < 1e-6 ? lo - olo : 0;
      const L0 = sideLine(ov, dr.side), L0t = [L0.b[0] - L0.a[0], L0.b[1] - L0.a[1]], L0len = Math.hypot(L0t[0], L0t[1]);
      const at = (alongX ? L0.a[0] + L0t[0] / L0len * dr.t : L0.a[1] + L0t[1] / L0len * dr.t) + shift;
      const c = Math.min(hi - 0.5, Math.max(lo + 0.5, at));
      const L = sideLine(v, dr.side);
      if (alongX) { n.x = c; n.z = L.a[1] + L.n[1] * dr.d; } else { n.z = c; n.x = L.a[0] + L.n[0] * dr.d; }
      n.y = base + Math.min(v.floors - 1, dr.floor) * FLOOR_H;
    }
  }
  private dragFloors(d: Extract<Drag, { t: "floors" }>, e: PointerEvent) {
    const s = this.sel; if (s?.kind !== "house") return;
    const h = this.world.houses.get(s.id); if (!h) return;
    const v = h.volumes[s.vi];
    const f = Math.max(1, Math.min(4, d.floors0 + Math.round((d.y0 - e.clientY) / 45)));
    if (f !== v.floors) { v.floors = f; this.housesChanged = true; this.app.changed({ structures: true }); this.refreshHandles(); this.onChange?.(); }
  }

  // ---------- walkways ----------
  /** Resolve a pointer point to a walkway node: reuse a node, split an edge, dock against a house wall, or make a new one. */
  /** Magnetic snapping for walkways: an existing post nearby wins, then a point along an existing stretch. */
  snapWalk(p: { x: number; z: number }, skip?: WalkNode | null):
    | { kind: "node"; node: WalkNode; x: number; z: number; y: number }
    | { kind: "edge"; edge: WalkEdge; a: WalkNode; b: WalkNode; t: number; x: number; z: number; y: number } | null {
    const w = this.world;
    let best: WalkNode | null = null, bd = Infinity;
    for (const n of w.nodes.values()) {
      if (n === skip || !(w.edgesOf(n.id).length || n === this.chainTemp)) continue;
      const d = Math.hypot(n.x - p.x, n.z - p.z);
      if (d < Math.max(1.25, landingRadius(w, n) + 0.5) && d < bd) { bd = d; best = n; }
    }
    if (best) return { kind: "node", node: best, x: best.x, z: best.z, y: best.y };
    let be: { e: WalkEdge; a: WalkNode; b: WalkNode; t: number; d: number } | null = null;
    for (const e of w.edges.values()) {
      const a = w.nodes.get(e.a), b = w.nodes.get(e.b); if (!a || !b) continue;
      if (skip && (a === skip || b === skip)) continue;
      const dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz; if (L2 < 1e-3) continue;
      const t = ((p.x - a.x) * dx + (p.z - a.z) * dz) / L2;
      if (t < 0.08 || t > 0.92) continue;
      const d = Math.abs((p.x - a.x) * dz - (p.z - a.z) * dx) / Math.sqrt(L2);
      if (d > e.width / 2 + 0.45 || (be && d >= be.d)) continue;
      be = { e, a, b, t, d };
    }
    if (be) { const { a, b, t } = be; return { kind: "edge", edge: be.e, a, b, t, x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, y: a.y + (b.y - a.y) * t }; }
    return null;
  }
  private walkPoint(p: THREE.Vector3, prev: WalkNode | null): { node: WalkNode; created: boolean } {
    const w = this.world;
    const sn = this.snapWalk(p, prev);
    if (sn?.kind === "node") return { node: sn.node, created: false };
    // anywhere on (or just off) a grotto's quay ties on at its middle
    const q = this.quayAt(p);
    if (q) return { node: this.app.addNode(q.x, q.z, DECK_Y), created: true };
    // Shop entrances are exact thresholds outside the body; only a connected path makes a visit possible.
    const shop = shopDoorAt(w, p.x, p.z);
    if (shop) return { node: this.app.addNode(shop.x, shop.z, shop.y), created: true };
    if (sn?.kind === "edge") {
      const n = this.app.addNode(sn.x, sn.z, sn.y);
      w.splitEdge(sn.edge.id, n);
      return { node: n, created: true };
    }
    // dock against a house wall, at the storey nearest the walkway's height
    const dock = this.wallDock(p, (base) => prev ? prev.y + this.walkLift : base + this.walkLift);
    if (dock) return { node: this.app.addNode(dock.x, dock.z, dock.y), created: true };
    const x = p.x, z = p.z;
    let y = defaultDeckY(w, x, z) + this.walkLift;
    if (prev && Math.abs(this.walkLift) < 1e-3 && prev.y > y && Math.hypot(prev.x - x, prev.z - z) < 8 && this.walkStyle === "rope") y = prev.y;
    return { node: this.app.addNode(x, z, Math.max(y, Math.max(w.height(x, z), WATER_Y) + 0.2), this.walkPad ? 1.2 : 0), created: true };
  }
  /** The tie point of the grotto quay p is on or just beside, if any. */
  quayAt(p: { x: number; z: number }, margin = 0.6): { x: number; z: number; prop: Prop; half: number } | null {
    for (const g of this.world.props.values()) {
      if (g.type !== "grotto" || Math.hypot(g.x - p.x, g.z - p.z) > 10) continue;
      const ties = grottoTies(g);
      for (const t of ties) {
        const dx = p.x - t.x, dz = p.z - t.z, c = Math.cos(g.rot), s = Math.sin(g.rot);
        if (Math.max(Math.abs(dx * c + dz * s), Math.abs(-dx * s + dz * c)) < QUAY_HALF + margin) return { x: t.x, z: t.z, prop: g, half: QUAY_HALF };
      }
    }
    return null;
  }
  /** Where a walkway ending near p would open a door: 0.6 out from the nearest wall, at the storey nearest want(base). */
  private wallDock(p: { x: number; z: number }, want: (base: number) => number) {
    const w = this.world;
    for (const h of w.houses.values()) {
      if (!nearWalls(h, p.x, p.z, 0.9)) continue;
      const lay = houseLayout(w, h);
      for (const v of h.volumes) {
        if (p.x < v.x0 - 0.9 || p.x > v.x1 + 0.9 || p.z < v.z0 - 0.9 || p.z > v.z1 + 0.9) continue;
        // nearest side
        const ds = [v.z1 - p.z, v.x1 - p.x, p.z - v.z0, p.x - v.x0].map(Math.abs);
        const side = ds.indexOf(Math.min(...ds));
        const [nx, nz] = SIDE_N[side];
        let x: number, z: number;
        if (side % 2 === 0) { z = (nz > 0 ? v.z1 : v.z0) + nz * 0.6; x = Math.min(v.x1 - 0.5, Math.max(v.x0 + 0.5, p.x)); }
        else { x = (nx > 0 ? v.x1 : v.x0) + nx * 0.6; z = Math.min(v.z1 - 0.5, Math.max(v.z0 + 0.5, p.z)); }
        const f = Math.max(0, Math.min(v.floors - 1, Math.round((want(lay.base) - lay.base) / FLOOR_H)));
        const y = lay.base + f * FLOOR_H;
        if (nodeWall(h, { x, z, y } as WalkNode, lay.base)) return { x, z, y, house: h };
      }
    }
    return null;
  }
  /** Join two posts; where it meets other walkways at a sharp angle the post simply becomes a landing. */
  joinWalk(a: WalkNode, b: WalkNode) {
    const style = this.walkStyle, width = style === "rope" ? 0.9 : WALK_W;
    this.addFollowing(a, b, style, width, 0);
  }
  /** Add a stretch; if the ground rises through its deck line, put a post on the high point so it rides over instead of through. */
  /** Add a stretch, then let it settle over any ground it would cut through. */
  private addFollowing(a: WalkNode, b: WalkNode, style: WalkEdge["style"], width: number, _depth: number) {
    this.app.addEdge(a, b, style, width);
    this.app.settleWalks(new Set([a.id, b.id]));
  }
  /** Does any walkway stretch added since `before` climb steeper than MAX_STAIR? */
  private tooSteep(before: Set<string>) {
    for (const e of this.world.edges.values()) {
      if (before.has(e.id)) continue;
      const a = this.world.nodes.get(e.a), b = this.world.nodes.get(e.b);
      if (a && b && slopeOf(a, b) > MAX_STAIR + 1e-6) return true;
    }
    return false;
  }
  private walkTo(p: THREE.Vector3) {
    if (!this.chain) return;
    if (!this.app.edits.active) this.app.begin(true);
    if (this.chainTemp && !this.world.nodes.has(this.chainTemp.id)) this.world.nodes.set(this.chainTemp.id, this.chainTemp);
    const nodesBefore = new Set(this.world.nodes.keys());
    const r = this.walkPoint(p, this.chain);
    if (r.node === this.chain || Math.hypot(r.node.x - this.chain.x, r.node.z - this.chain.z) > 14) {
      const long = r.node !== this.chain;
      this.app.cancel(); this.chain = null; this.chainTemp = null;
      if (long) this.toast("That's a long way — add a post in between"); return;
    }
    const dup = this.world.edgesOf(this.chain.id).some(e => e.a === r.node.id || e.b === r.node.id);
    if (!dup) {
      const before = new Set(this.world.edges.keys());
      this.joinWalk(this.chain, r.node);
      if (this.tooSteep(before)) {
        this.app.cancel(); this.chain = null; this.chainTemp = null; this.walkLift = 0;
        this.toast("Too steep for stairs — start them further out, or lift the post with [ ]"); return;
      }
    }
    const fresh = [...this.world.nodes.keys()].filter(id => !nodesBefore.has(id));
    this.app.mergeInline([this.chain.id, ...fresh].filter(id => id !== r.node.id));
    this.chain = r.node; this.chainTemp = null;
    this.walkLift = 0;
    this.app.changed({ structures: true });
    this.app.commit();
    this.onChange?.();
  }

  // ---------- terrain + paint ----------
  private applyStroke(p: THREE.Vector3, first: boolean) {
    const d = this.drag as Extract<Drag, { t: "stroke" }>;
    const now = performance.now();
    if (this.tool === "terrain") {
      if (!first && now - d.last < (this.terrainOp === "smooth" || this.terrainOp === "flatten" ? 60 : 170)) return;
      d.last = now;
      const w = this.world, r = this.brush;
      const cells: [number, number][] = [];
      for (let j = Math.floor(p.z - r); j <= Math.ceil(p.z + r); j++) for (let i = Math.floor(p.x - r); i <= Math.ceil(p.x + r); i++) {
        if (i < 0 || j < 0 || i >= N || j >= N) continue;
        if (Math.hypot(i + 0.5 - p.x, j + 0.5 - p.z) <= r) cells.push([i, j]);
      }
      const orig = cells.map(([i, j]) => w.baseLevel(i, j));
      cells.forEach(([i, j], k) => {
        const l = orig[k];
        let nl = l;
        if (this.terrainOp === "raise") nl = l + 1;
        else if (this.terrainOp === "lower") nl = l - 1;
        else if (this.terrainOp === "flatten") nl = l + Math.sign((d.flat ?? l) - l);
        else { let s = 0, c = 0; for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { s += w.baseLevel(i + di, j + dj); c++; } nl = Math.round(s / c); }
        nl = Math.max(0, Math.min(MAX_LEVEL, nl));
        if (nl !== l) { w.setLevel(i, j, nl); d.changed = true; }
      });
      if (d.changed) this.app.changed({ terrain: true });
    } else {
      if (!first && now - d.last < 30) return;
      d.last = now;
      this.app.paintDisc(this.paintType, p.x, p.z, this.brush * 0.8, this.paintType === "erase" ? 0.5 : 1);
      d.changed = true;
      this.app.changed({ paint: true });
    }
  }

  // ---------- props + erase ----------
  private placeProp() {
    const p = this.hover ?? this.surface(); if (!p) return;
    const type = this.placingType;
    if (isLandmark(type)) {
      const f = this.fitAt(type, p.x, p.z);
      if (!f.ok) { this.toast(f.why ?? "Won't fit here"); return; }
      this.app.begin();
      const np = this.app.addProp(type, f.x, f.z, f.rot, this.propSeed);
      if (Object.keys(this.ghostOpts ?? {}).length) { np.opts = { ...this.ghostOpts }; if (np.type === "grotto") this.app.carveGrotto(np); }
      this.propSeed = Math.random(); this.ghostOpts = {};
      this.app.changed({ structures: true, terrain: np.type === "grotto" });
      this.onChange?.();
      return;
    }
    const chk = this.propCheck(type, p.x, p.z);
    if (!chk.ok) { this.toast(chk.why ?? "Won't fit there"); return; }
    this.app.begin();
    this.app.addProp(type, Math.round(p.x * 10) / 10, Math.round(p.z * 10) / 10, this.propRot, this.propSeed);
    this.propSeed = Math.random();
    this.app.changed({ structures: true });
  }
  /** Is a walkway within r of this point (edges as capsules, landings as discs)? */
  private nearWalk(x: number, z: number, r: number) {
    const w = this.world;
    for (const n of w.nodes.values()) if (w.edgesOf(n.id).length && Math.hypot(n.x - x, n.z - z) < landingRadius(w, n) + r) return true;
    for (const e of w.edges.values()) {
      const a = w.nodes.get(e.a), b = w.nodes.get(e.b); if (!a || !b) continue;
      const dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz; if (L2 < 1e-3) continue;
      const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / L2));
      if (Math.hypot(a.x + dx * t - x, a.z + dz * t - z) < e.width / 2 + r) return true;
    }
    return false;
  }
  private onDeck(x: number, z: number) {
    for (const n of this.world.nodes.values()) if (Math.hypot(n.x - x, n.z - z) < landingRadius(this.world, n)) return true;
    for (const e of this.world.edges.values()) {
      const a = this.world.nodes.get(e.a), b = this.world.nodes.get(e.b); if (!a || !b) continue;
      const dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz; if (L2 < 1e-3) continue;
      const t = ((x - a.x) * dx + (z - a.z) * dz) / L2;
      if (t >= 0 && t <= 1 && Math.abs((x - a.x) * dz - (z - a.z) * dx) / Math.sqrt(L2) < e.width / 2) return true;
    }
    return false;
  }
  private eraseAt() {
    const p = this.pick(); if (!p) return;
    const s = this.ownerToSel(p.owner); if (!s) return;
    this.sel = s;
    this.deleteSelection();
  }

  // ---------- ghost previews ----------
  updateBrush() {
    const h = this.hover;
    const on = (this.tool === "terrain" || this.tool === "paint") && h ? 1 : 0;
    U.brush.value.set(h?.x ?? 0, h?.z ?? 0, this.tool === "paint" ? this.brush * 0.8 + 0.4 : this.brush, on);
  }
  updateGhost() {
    this.updateBrush();
    type Foot = { circle: [number, number, number]; y?: number } | { rect: [number, number, number, number]; y?: number } | { poly: [number, number][]; y?: number };
    const setG = (g: THREE.BufferGeometry | null, bad = false, foot?: Foot) => {
      // never hand these meshes an empty geometry: node materials would compile against missing attributes
      const prev = new Set([this.ghost, this.ghostBad, this.ghostX, this.ghostBadX, this.foot].map(m => m.geometry));
      const show = (m: THREE.Mesh, on: boolean, geo: THREE.BufferGeometry | null) => { if (on && geo) { m.geometry = geo; m.visible = true; } else m.visible = false; };
      show(this.ghost, !bad, g); show(this.ghostX, !bad, g);
      show(this.ghostBad, bad, g); show(this.ghostBadX, bad, g);
      show(this.foot, !!(foot && g), foot && g ? this.footprint(foot) : null);
      this.foot.material = bad ? this.app.d.mats.footBad : this.app.d.mats.footOk;
      const now = new Set([this.ghost, this.ghostBad, this.ghostX, this.ghostBadX, this.foot].map(m => m.geometry));
      for (const old of prev) if (!now.has(old)) old.dispose();
    };
    const w = this.world;
    if (this.tool === "house" && !this.placingSpecial) {
      const d = this.drag;
      let r: ReturnType<Tools["rectFrom"]> | null = null;
      if (d?.t === "rect") r = this.rectFrom(d.a, d.b, true);
      else if (this.hover) r = this.rectFrom(this.hover, this.hover, false);
      if (!r) return setG(null);
      const h = this.previewHouse(r);
      const mb = new MeshBuilder();
      const out: HouseBuild = { mb, lights: [], anchors: [], foam: [] };
      buildHouse(w, h, out);
      return setG(mb.toGeometry(), !w.footprintFree(r.x0, r.z0, r.x1, r.z1) || this.steep(h), { rect: [r.x0, r.z0, r.x1, r.z1], y: houseLayout(w, h).base + 0.03 });
    }
    if ((this.tool === "prop" || this.placingSpecial) && this.hover) {
      const type = this.placingType;
      if (isLandmark(type)) {
        const f = this.fitAt(type, this.hover.x, this.hover.z);
        const gp: Prop = { id: "ghost", type, x: f.x, z: f.z, rot: f.rot, seed: this.propSeed, opts: this.ghostOpts };
        const mb = new MeshBuilder();
        buildOneProp(w, mb, gp, { lights: [], foam: [] });
        if (!f.ok) this.toastSoft(f.why ?? "Won't fit here");
        return setG(mb.toGeometry(), !f.ok, { poly: landmarkOutline(gp) });
      }
      const p = { id: "ghost", type, x: this.hover.x, z: this.hover.z, rot: this.propRot, seed: this.propSeed };
      if (PROP_INFO[type].water) {
        const b = buildBoat(p, this.app.d.mats.ghost);
        const g = b.mesh.geometry;
        const m = new THREE.Matrix4().makeRotationY(-p.rot).setPosition(p.x, WATER_Y + boatFreeboard(p.type), p.z);
        g.applyMatrix4(m);
        return setG(g, !this.propCheck(p.type, p.x, p.z).ok, { circle: [p.x, p.z, PROP_INFO[p.type].r * 0.8] });
      }
      const mb = new MeshBuilder();
      buildOneProp(w, mb, p, { lights: [], foam: [] });
      return setG(mb.toGeometry(), !this.propCheck(p.type, p.x, p.z).ok, { circle: [p.x, p.z, PROP_INFO[p.type].r] });
    }
    if (this.tool === "walk" && this.hover) {
      const mb = new MeshBuilder();
      const h0 = this.hover;
      let sn = this.snapWalk(h0, this.chain);
      // a grotto quay wins over splitting a walkway, as it does on click
      const q = sn?.kind === "node" ? null : this.quayAt(h0);
      const shop = sn?.kind === "node" || q ? null : shopDoorAt(w, h0.x, h0.z);
      if (q || shop) sn = null;
      const hx = q ? q.x : shop ? shop.x : sn ? sn.x : h0.x, hz = q ? q.z : shop ? shop.z : sn ? sn.z : h0.z;
      const y = q ? DECK_Y : shop ? shop.y : sn ? sn.y : defaultDeckY(w, hx, hz) + this.walkLift;
      mb.paint([1, 1, 1], 0);
      // every quay in view gets a faint outline, so there's an obvious place to tie on
      for (const p of w.props.values()) {
        if (p.type !== "grotto") continue;
        const c = Math.cos(p.rot), s = Math.sin(p.rot);
        for (const t of grottoTies(p)) {
          const k = QUAY_HALF + 0.12, sq: [number, number, number][] = [];
          for (const [a, b] of [[-k, -k], [k, -k], [k, k], [-k, k], [-k, -k]]) sq.push([t.x + a * c - b * s, DECK_Y + 0.12, t.z + a * s + b * c]);
          mb.tube(sq, q && Math.hypot(q.x - t.x, q.z - t.z) < 0.01 ? 0.05 : 0.025, 4);
        }
      }
      mb.cyl(hx, hz, Math.max(w.height(hx, hz), WATER_Y) - 0.05, y + 0.05, 0.12, 0.12, 8);
      mb.cyl(hx, hz, y, y + 0.08, 0.5, 0.5, 12);
      if (this.chain) {
        const a = this.chain;
        const side: [number, number, number] = [-(hz - a.z), 0, hx - a.x];
        if (Math.hypot(side[0], side[2]) > 0.05) mb.beam([a.x, a.y, a.z], [hx, y, hz], side, WALK_W / 2, 0.04);
      }
      // a snapped target gets a bigger ring around the post (or join point) it will connect to
      const r = q ? QUAY_HALF * 1.2 : sn?.kind === "node" ? landingRadius(w, sn.node) + 0.3 : sn || shop ? 0.85 : 0.55;
      if (sn || shop) { // a second, raised ring so a snap reads at a glance
        const ring: [number, number, number][] = [];
        for (let i = 0; i <= 32; i++) { const a = i / 32 * Math.PI * 2; ring.push([hx + Math.cos(a) * (r + 0.16), y + 0.1, hz + Math.sin(a) * (r + 0.16)]); }
        mb.tube(ring, 0.045, 4);
      }
      this.snapped = !!sn || !!q;
      return setG(mb.toGeometry(), false, { circle: [hx, hz, r], y: y + 0.1 });
    }
    setG(null);
  }
  /** A footprint outline that follows the ground (or sits on the water). */
  private footprint(f: { circle: [number, number, number]; y?: number } | { rect: [number, number, number, number]; y?: number } | { poly: [number, number][]; y?: number }) {
    const w = this.world;
    const pts: [number, number][] = [];
    if ("poly" in f) {
      const P = f.poly;
      for (let k = 0; k < P.length; k++) { const [ax, az] = P[k], [bx, bz] = P[(k + 1) % P.length]; const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 0.3)); for (let i = 0; i < n; i++) pts.push([ax + (bx - ax) * i / n, az + (bz - az) * i / n]); }
      pts.push(P[0]);
    } else if ("circle" in f) {
      const [x, z, r] = f.circle;
      for (let i = 0; i <= 40; i++) { const a = i / 40 * Math.PI * 2; pts.push([x + Math.cos(a) * r, z + Math.sin(a) * r]); }
    } else {
      const [x0, z0, x1, z1] = f.rect;
      const edge = (ax: number, az: number, bx: number, bz: number) => { const n = Math.max(2, Math.ceil(Math.hypot(bx - ax, bz - az) / 0.25)); for (let i = 0; i < n; i++) pts.push([ax + (bx - ax) * i / n, az + (bz - az) * i / n]); };
      edge(x0, z0, x1, z0); edge(x1, z0, x1, z1); edge(x1, z1, x0, z1); edge(x0, z1, x0, z0); pts.push([x0, z0]);
    }
    const mb = new MeshBuilder();
    mb.paint([1, 1, 1], 0);
    const fixed = f.y;
    const y = (x: number, z: number) => fixed ?? Math.max(w.height(Math.min(N, Math.max(0, x)), Math.min(N, Math.max(0, z))), WATER_Y) + 0.06;
    mb.tube(pts.map(([x, z]) => [x, y(x, z), z] as [number, number, number]), 0.035, 4);
    return mb.toGeometry();
  }
  private softT = 0;
  /** A quiet reason while hovering a spot a landmark can't use (rate-limited so it doesn't flicker). */
  private toastSoft(msg: string) { const now = performance.now(); if (now - this.softT > 1800) { this.softT = now; this.toast(msg); } }
  /** Can this prop go here? The ghost turns coral when not, and placing is refused with the same reason. */
  propCheck(type: PropType, x: number, z: number): { ok: boolean; why?: string } {
    const w = this.world, info = PROP_INFO[type];
    if (x < 0.3 || z < 0.3 || x > N - 0.3 || z > N - 0.3) return { ok: false, why: "Too close to the edge" };
    const water = w.height(x, z) < WATER_Y - 0.25;
    if (info.water) {
      if (!water) return { ok: false, why: "Boats need water" };
      if (w.houseAt(x, z, info.r * 0.5)) return { ok: false, why: "A house is in the way" };
      if (this.nearWalk(x, z, info.r * 0.55)) return { ok: false, why: "A dock is in the way" };
      for (const p of w.props.values()) if (PROP_INFO[p.type]?.water && Math.hypot(p.x - x, p.z - z) < (info.r + PROP_INFO[p.type].r) * 0.6) return { ok: false, why: "Another boat is moored there" };
      return { ok: true };
    }
    if (info.big) {
      if (w.houseAt(x, z, info.r * 0.6)) return { ok: false, why: "A house is in the way" };
      if (this.nearWalk(x, z, info.r * 0.5)) return { ok: false, why: "A walkway is in the way" };
      for (const p of w.props.values()) if (PROP_INFO[p.type]?.big && Math.hypot(p.x - x, p.z - z) < (info.r + PROP_INFO[p.type].r) * 0.6) return { ok: false, why: "Too close to another landmark" };
      return { ok: true };
    }
    if (isGreenery(type)) {
      if (water) return { ok: false, why: "Needs land to grow on" };
      if (w.houseAt(x, z, 0.2) || this.onDeck(x, z) || this.nearWalk(x, z, 0.15)) return { ok: false, why: "Won't grow through a walkway or house" };
      const e = 0.35, sl = Math.max(Math.abs(w.height(x + e, z) - w.height(x - e, z)), Math.abs(w.height(x, z + e) - w.height(x, z - e))) / (2 * e);
      if (sl > 1.4) return { ok: false, why: "Too steep to take root" };
      if (type === "palm" && palmPierces(w, { id: "ghost", type, x, z, rot: this.propRot, seed: this.propSeed })) return { ok: false, why: "It would lean through the walkway — turn it (R)" };
      return { ok: true };
    }
    if (water && !this.onDeck(x, z)) return { ok: false, why: "That would sink — put it on land or a deck" };
    if (w.houseAt(x, z, 0.05)) return { ok: false, why: "A house is in the way" };
    return { ok: true };
  }

  /** WASD / arrow keys pan the camera target; called every frame. */
  panCamera(dt: number) {
    const k = this.keys;
    if (!k.size) return;
    const typing = typingIn(document.activeElement);
    if (typing === "text") return;
    // A focused slider or dial keeps its arrow keys; WASD still pans.
    const arrows = typing === null;
    let fx = 0, fz = 0;
    if (k.has("KeyW") || (arrows && k.has("ArrowUp"))) fz -= 1;
    if (k.has("KeyS") || (arrows && k.has("ArrowDown"))) fz += 1;
    if (k.has("KeyA") || (arrows && k.has("ArrowLeft"))) fx -= 1;
    if (k.has("KeyD") || (arrows && k.has("ArrowRight"))) fx += 1;
    if (!fx && !fz) return;
    const cam = this.app.d.camera, ctl = this.app.d.controls;
    const fwd = new THREE.Vector3().subVectors(ctl.target, cam.position); fwd.y = 0; fwd.normalize();
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const dist = cam.position.distanceTo(ctl.target);
    const mv = new THREE.Vector3().addScaledVector(right, fx).addScaledVector(fwd, -fz).multiplyScalar(dt * (6 + dist * 0.5));
    ctl.target.add(mv); cam.position.add(mv);
    ctl.target.x = Math.min(N + 4, Math.max(-4, ctl.target.x)); ctl.target.z = Math.min(N + 4, Math.max(-4, ctl.target.z));
  }
}
void DECK_Y;

const PAN_KEYS = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);

/** What the focused element does with keys: "text" swallows everything,
 *  "control" (sliders, the dial) swallows arrows, null leaves them to us. */
function typingIn(el: Element | null): "text" | "control" | null {
  if (!el || el === document.body) return null;
  const h = el as HTMLElement;
  if (h.isContentEditable || h.tagName === "TEXTAREA" || h.tagName === "SELECT") return "text";
  if (h.tagName === "INPUT") {
    const t = (h as HTMLInputElement).type;
    return t === "range" || t === "checkbox" || t === "button" || t === "color" ? "control" : "text";
  }
  return h.getAttribute("role") === "slider" ? "control" : null;
}

/** Outline of a landmark's footprint for the placement ghost. */
function landmarkOutline(p: Prop): [number, number][] {
  const c = Math.cos(p.rot), s = Math.sin(p.rot), out: [number, number][] = [];
  const W = (lx: number, lz: number): [number, number] => [p.x + lx * c - lz * s, p.z + lx * s + lz * c];
  if (p.type === "hull") {
    const { len, wid } = hullDims(p);
    for (let k = 0; k < 32; k++) { const a = (k / 32) * Math.PI * 2; out.push(W(Math.cos(a) * wid * 0.55, Math.sin(a) * len * 0.52)); }
  } else if (p.type === "grotto") {
    const { a: R, D, T } = grottoDims(p);
    for (const [lx, lz] of [[-R - T, 0.8], [-R - 0.6, 0.8], [-R - 0.6, 5], [R + 0.6, 5], [R + 0.6, 0.8], [R + T, 0.8], [R + T, -D], [-R - T, -D]]) out.push(W(lx, lz));
  } else if (isShop(p.type)) {
    const { w, d } = SHOP_DIMS[p.type];
    for (const [x, z] of [[-w / 2, -d / 2], [w / 2, -d / 2], ...(p.type === "bakery" ? [[w / 2 + 0.8, -d / 2], [w / 2 + 0.8, 0]] : []), [w / 2, d / 2], [-w / 2, d / 2]]) out.push(W(x, z));
  } else for (let k = 0; k < 24; k++) { const a = (k / 24) * Math.PI * 2; out.push(W(Math.cos(a) * 1.25, Math.sin(a) * 1.25)); }
  return out;
}
