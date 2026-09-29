import * as THREE from "three/webgpu";
import type { App } from "./app";
import { World, N, snap, House, Volume, newVolume, uid, FLOOR_H, MAX_LEVEL, PaintType, PropType, WalkNode, WalkEdge, RoofType, WATER_Y, DECK_Y } from "./world";
import { MeshBuilder } from "./mesh";
import { buildHouse, houseLayout, makeHouse, nodeWall, sideLine, HouseBuild, Bay } from "./houses";
import { defaultDeckY, landingRadius, WALK_W } from "./walks";
import { buildOneProp, buildBoat, PROP_INFO } from "./props";
import { U } from "./materials";

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

type Drag =
  | { t: "side"; side: number; grab: number; plane: number; orig: House; extrude: boolean; wingVi?: number }
  | { t: "move"; start: THREE.Vector3; orig: House }
  | { t: "floors"; y0: number; floors0: number }
  | { t: "rect"; a: THREE.Vector3; b: THREE.Vector3 }
  | { t: "stroke"; last: number; flat?: number; changed: boolean }
  | { t: "nodeMove"; id: string; start: THREE.Vector3; ox: number; oz: number; changed: boolean }
  | { t: "nodeY"; id: string; y0: number; oy: number; changed: boolean }
  | { t: "propMove"; id: string; start: THREE.Vector3; ox: number; oz: number; changed: boolean }
  | { t: "walk"; down: THREE.Vector3; sx: number; sy: number };

const SIDE_N: [number, number][] = [[0, 1], [1, 0], [0, -1], [-1, 0]];

export class Tools {
  tool: ToolId = "select";
  brush = 2;
  terrainOp: TerrainOp = "raise";
  paintType: PaintType | "erase" = "path";
  propType: PropType = "palm";
  propRot = 0;
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
  private handles = new THREE.Group();
  private pointerId = -1;
  private downAt = { x: 0, y: 0 };
  private keys = new Set<string>();
  shift = false;

  constructor(private app: App, private dom: HTMLElement) {
    const m = app.d.mats;
    this.ghost = new THREE.Mesh(new THREE.BufferGeometry(), m.ghost);
    this.ghostBad = new THREE.Mesh(new THREE.BufferGeometry(), m.ghostBad);
    this.ghost.renderOrder = this.ghostBad.renderOrder = 8;
    this.ghost.frustumCulled = this.ghostBad.frustumCulled = false;
    this.handles.renderOrder = 10;
    app.d.scene.add(this.ghost, this.ghostBad, this.handles);
    dom.addEventListener("pointerdown", e => this.down(e));
    dom.addEventListener("pointermove", e => this.move(e));
    dom.addEventListener("pointerup", e => this.up(e));
    dom.addEventListener("pointercancel", () => this.cancelDrag());
    dom.addEventListener("pointerleave", () => { if (!this.drag) { this.hover = null; this.updateGhost(); } });
    dom.addEventListener("dblclick", () => { if (this.tool === "walk") this.endChain(); });
    dom.addEventListener("wheel", e => this.wheel(e), { passive: false });
    dom.addEventListener("contextmenu", e => { if (this.tool === "walk" && this.chain) { e.preventDefault(); this.endChain(); } });
    window.addEventListener("keydown", e => { this.shift = e.shiftKey; this.keys.add(e.key.toLowerCase()); });
    window.addEventListener("keyup", e => { this.shift = e.shiftKey; this.keys.delete(e.key.toLowerCase()); });
  }

  get world(): World { return this.app.world; }

  setTool(t: ToolId) {
    if (this.tool === "walk" && t !== "walk") this.endChain();
    this.tool = t;
    if (t !== "select") this.select(null);
    this.updateGhost(); this.onChange?.();
  }
  select(s: Selection | null) {
    this.sel = s;
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
  private pickHandle(): THREE.Object3D | null {
    this.handles.updateMatrixWorld(true);
    const hits = this.ray.intersectObjects(this.handles.children, true);
    for (const h of hits) { let o: THREE.Object3D | null = h.object; while (o && !o.userData.handle) o = o.parent; if (o) return o; }
    return null;
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
        if (s && (s.kind === "prop" || s.kind === "node") && this.sel && this.sel.kind === s.kind && this.sel.id === s.id) {
          const g = this.surface() ?? p!.point;
          app.begin();
          if (s.kind === "prop") { const pr = this.world.props.get(s.id)!; this.drag = { t: "propMove", id: s.id, start: g.clone(), ox: pr.x, oz: pr.z, changed: false }; }
          else { const n = this.world.nodes.get(s.id)!; this.drag = { t: "nodeMove", id: s.id, start: g.clone(), ox: n.x, oz: n.z, changed: false }; }
          this.dom.setPointerCapture(e.pointerId);
          return;
        }
        this.select(s);
        break;
      }
      case "house": {
        const g = this.ground(); if (!g) return;
        const a = new THREE.Vector3(snap(g.x), g.y, snap(g.z));
        this.drag = { t: "rect", a, b: a.clone() };
        this.dom.setPointerCapture(e.pointerId);
        break;
      }
      case "terrain": case "paint": {
        const g = this.ground(); if (!g) return;
        app.begin();
        this.drag = { t: "stroke", last: 0, changed: false, flat: this.world.level(Math.floor(g.x), Math.floor(g.z)) };
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
      if (this.tool === "select") { this.dom.style.cursor = this.pickHandle() ? "grab" : ""; return; }
      this.hover = this.tool === "walk" || this.tool === "prop" ? this.surface() : this.ground();
      this.updateGhost();
      return;
    }
    switch (d.t) {
      case "rect": { const g = this.ground(); if (g) { d.b.set(snap(g.x), g.y, snap(g.z)); this.updateGhost(); } break; }
      case "stroke": { const g = this.ground(); if (g) { this.hover = g; this.applyStroke(g, false); this.updateBrush(); } break; }
      case "walk": { this.hover = this.surface(); this.updateGhost(); break; }
      case "side": this.dragSide(d); break;
      case "move": this.dragMove(d); break;
      case "floors": this.dragFloors(d, e); break;
      case "nodeY": {
        const n = this.world.nodes.get(d.id); if (!n) break;
        const dy = (d.oy - e.clientY) / 40 * 0.25;
        const y = Math.round((d.y0 + dy) / 0.25) * 0.25;
        const g = this.world.height(n.x, n.z);
        const ny = Math.max(Math.max(g, WATER_Y) + 0.2, Math.min(12, y));
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
          p.x = Math.round(x * 10) / 10; p.z = Math.round(z * 10) / 10;
        }
        d.changed = true; this.app.changed({ structures: true }); this.refreshHandles();
        break;
      }
    }
  }

  private up(e: PointerEvent) {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    const d = this.drag;
    this.drag = null;
    this.app.endInteraction();
    try { this.dom.releasePointerCapture(this.pointerId); } catch { /* not captured */ }
    if (!d) return;
    this.setRay(e);
    const moved = Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y) > 6;
    switch (d.t) {
      case "rect": this.commitHouse(d.a, d.b, moved); break;
      case "stroke": if (!d.changed) this.app.cancel(); break;
      case "walk": {
        const g = this.surface() ?? d.down;
        if (moved && d.down.distanceTo(g) > 0.5) {
          // press-drag-release: a whole segment
          if (!this.chain) this.chain = this.walkPoint(d.down, null).node;
          this.walkTo(g);
        } else if (!this.chain) {
          const r = this.walkPoint(d.down, null);
          this.chain = r.node;
          if (r.created) this.world.nodes.delete(r.node.id); // don't keep a lone point until a segment exists
          this.chainTemp = r.created ? r.node : null;
          this.toast("Click to lay walkway · double-click or right-click to finish · [ ] to raise the next post");
        } else this.walkTo(g);
        this.updateGhost();
        break;
      }
      case "side": case "move": case "floors":
        if (!this.housesChanged) this.app.cancel();
        this.housesChanged = false;
        this.refreshHandles(); this.onChange?.();
        break;
      case "nodeY": case "nodeMove": case "propMove":
        if (!d.changed) this.app.cancel(); else if (d.t !== "propMove") this.world.pruneNodes();
        this.onChange?.();
        break;
    }
  }
  private chainTemp: WalkNode | null = null;
  private housesChanged = false;
  private cancelDrag() { if (this.drag && (this.drag.t === "stroke")) { /* keep */ } this.drag = null; }

  private wheel(e: WheelEvent) {
    if (this.tool === "prop" && e.shiftKey) { e.preventDefault(); this.propRot += Math.sign(e.deltaY) * Math.PI / 12; this.updateGhost(); }
    else if ((this.tool === "terrain" || this.tool === "paint") && e.shiftKey) { e.preventDefault(); this.setBrush(this.brush - Math.sign(e.deltaY) * 0.5); }
    else if (this.tool === "walk" && e.shiftKey) { e.preventDefault(); this.nudgeLift(-Math.sign(e.deltaY)); }
  }

  // ---------- keyboard-facing actions ----------
  setBrush(b: number) { this.brush = Math.max(0.5, Math.min(6, b)); this.updateBrush(); this.onChange?.(); }
  nudgeLift(dir: number) { this.walkLift = Math.max(-2, Math.min(8, this.walkLift + dir * 0.25)); this.updateGhost(); this.onChange?.(); }
  rotate() {
    if (this.tool === "prop") { this.propRot += Math.PI / 4; this.updateGhost(); return; }
    const s = this.sel;
    if (s?.kind === "prop") { const p = this.world.props.get(s.id); if (p) { this.app.begin(); p.rot += Math.PI / 4; this.app.changed({ structures: true }); } }
    else if (s?.kind === "house") this.houseEdit("ridge");
  }
  deleteSelection() {
    const s = this.sel; if (!s) return;
    this.app.begin();
    if (s.kind === "house") {
      const h = this.world.houses.get(s.id);
      if (h && h.volumes.length > 1 && s.vi > 0) { h.volumes.splice(s.vi, 1); this.select({ kind: "house", id: h.id, vi: 0 }); }
      else { this.world.houses.delete(s.id); this.select(null); }
    } else if (s.kind === "node") { this.world.removeNode(s.id); this.world.pruneNodes(); this.select(null); }
    else if (s.kind === "edge") { this.world.edges.delete(s.id); this.world.pruneNodes(); this.select(null); }
    else if (s.kind === "prop") { this.world.props.delete(s.id); this.select(null); }
    this.app.changed({ structures: true });
  }
  escape() {
    if (this.chain) { this.endChain(); return; }
    if (this.drag) { this.drag = null; this.updateGhost(); return; }
    if (this.sel) this.select(null); else if (this.tool !== "select") this.setTool("select");
  }
  endChain() { this.chain = null; this.chainTemp = null; this.walkLift = 0; this.world.pruneNodes(); this.updateGhost(); this.onChange?.(); }

  // ---------- houses ----------
  private rectFrom(a: THREE.Vector3, b: THREE.Vector3, moved: boolean) {
    const P = HOUSE_PRESETS[this.preset];
    let x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), z0 = Math.min(a.z, b.z), z1 = Math.max(a.z, b.z);
    if (!moved || x1 - x0 < 1 || z1 - z0 < 1) {
      const w = (this.propRot / (Math.PI / 2)) % 2 ? P.d : P.w, dd = (this.propRot / (Math.PI / 2)) % 2 ? P.w : P.d;
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
  private commitHouse(a: THREE.Vector3, b: THREE.Vector3, moved: boolean) {
    const r = this.rectFrom(a, b, moved);
    if (!this.world.footprintFree(r.x0, r.z0, r.x1, r.z1)) { this.toast("Not enough room there"); this.updateGhost(); return; }
    this.app.begin();
    const h = this.previewHouse(r);
    h.id = uid("h");
    this.world.houses.set(h.id, h);
    this.ghostSeed = Math.random();
    this.app.changed({ structures: true });
    this.setTool("select");
    this.select({ kind: "house", id: h.id, vi: 0 });
    this.toast("Pull the arrows to stretch · Shift-drag an arrow for a new wing · the diamond adds floors");
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
    const now = performance.now();
    if (!(live && this.lastLive.op === op && now - this.lastLive.t < 1500)) this.app.begin();
    this.lastLive = live ? { op, t: now } : { op: "", t: 0 };
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
  private lastLive = { op: "", t: 0 };
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
  refreshHandles() {
    for (const c of [...this.handles.children]) { this.handles.remove(c); (c as THREE.Mesh).geometry?.dispose(); }
    const s = this.sel; if (!s) return;
    const mat = this.app.d.mats.handle;
    const mk = (geo: THREE.BufferGeometry, col: string, pos: THREE.Vector3, data: any) => {
      const c = new THREE.Color(col);
      const cols = new Float32Array(geo.getAttribute("position").count * 3);
      for (let i = 0; i < cols.length; i += 3) { cols[i] = c.r; cols[i + 1] = c.g; cols[i + 2] = c.b; }
      geo.setAttribute("color", new THREE.BufferAttribute(cols, 3));
      const m = new THREE.Mesh(geo, mat);
      m.position.copy(pos); m.userData.handle = data; m.renderOrder = 10;
      this.handles.add(m); return m;
    };
    if (s.kind === "house") {
      const h = this.world.houses.get(s.id); if (!h) return;
      const v = h.volumes[s.vi] ?? h.volumes[0];
      const lay = houseLayout(this.world, h);
      const yMid = lay.base + Math.min(v.floors, 2) * FLOOR_H * 0.5;
      for (let side = 0; side < 4; side++) {
        const L = sideLine(v, side);
        const cx = (L.a[0] + L.b[0]) / 2 + L.n[0] * 0.55, cz = (L.a[1] + L.b[1]) / 2 + L.n[1] * 0.55;
        const g = new THREE.ConeGeometry(0.2, 0.42, 12);
        g.rotateX(Math.PI / 2);
        const m = mk(g, "#fff1c9", new THREE.Vector3(cx, yMid, cz), { t: "side", side });
        m.lookAt(cx + L.n[0], yMid, cz + L.n[1]);
      }
      const top = lay.base + v.floors * FLOOR_H + 1.6;
      const cx = (v.x0 + v.x1) / 2, cz = (v.z0 + v.z1) / 2;
      mk(new THREE.OctahedronGeometry(0.24), "#e6a676", new THREE.Vector3(cx, top + 0.7, cz), { t: "floors" });
      const ring = new THREE.TorusGeometry(0.3, 0.07, 8, 20); ring.rotateX(Math.PI / 2);
      mk(ring, "#6fdcc9", new THREE.Vector3(cx, top, cz), { t: "move" });
    } else if (s.kind === "node") {
      const n = this.world.nodes.get(s.id); if (!n) return;
      const g = new THREE.ConeGeometry(0.18, 0.4, 12);
      mk(g, "#e6a676", new THREE.Vector3(n.x, n.y + 1.1, n.z), { t: "nodeY" });
      const g2 = new THREE.ConeGeometry(0.18, 0.4, 12); g2.rotateX(Math.PI);
      mk(g2, "#e6a676", new THREE.Vector3(n.x, n.y + 0.6, n.z), { t: "nodeY" });
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
    this.app.begin();
    this.housesChanged = false;
    if (s.kind === "node") { const n = this.world.nodes.get(s.id)!; this.drag = { t: "nodeY", id: s.id, y0: n.y, oy: e.clientY, changed: false }; return; }
    if (s.kind !== "house") return;
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
      this.drag = { t: "side", side, grab: along - coord, plane, orig, extrude: e.shiftKey, wingVi };
    } else if (d.t === "move") {
      const g = this.ground() ?? new THREE.Vector3();
      this.drag = { t: "move", start: g.clone(), orig };
    } else if (d.t === "floors") {
      this.drag = { t: "floors", y0: e.clientY, floors0: h.volumes[s.vi].floors };
    }
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
    h.volumes = vols;
    this.housesChanged = true;
    this.app.changed({ structures: true });
    this.refreshHandles(); this.refreshHighlight();
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
  private walkPoint(p: THREE.Vector3, prev: WalkNode | null): { node: WalkNode; created: boolean } {
    const w = this.world;
    for (const n of w.nodes.values()) if (Math.hypot(n.x - p.x, n.z - p.z) < Math.max(0.6, landingRadius(w, n) * 0.8) && (w.edgesOf(n.id).length || n === this.chainTemp)) return { node: n, created: false };
    // split an edge
    for (const e of w.edges.values()) {
      const a = w.nodes.get(e.a), b = w.nodes.get(e.b); if (!a || !b) continue;
      const dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz; if (L2 < 1e-3) continue;
      const t = ((p.x - a.x) * dx + (p.z - a.z) * dz) / L2;
      if (t < 0.12 || t > 0.88) continue;
      const d = Math.abs((p.x - a.x) * dz - (p.z - a.z) * dx) / Math.sqrt(L2);
      if (d > e.width / 2 + 0.15) continue;
      const n = this.app.addNode(a.x + dx * t, a.z + dz * t, a.y + (b.y - a.y) * t);
      w.edges.delete(e.id);
      this.app.addEdge(a, n, e.style, e.width); this.app.addEdge(n, b, e.style, e.width);
      return { node: n, created: true };
    }
    // dock against a house wall, at the storey nearest the walkway's height
    let x = p.x, z = p.z;
    let y = defaultDeckY(w, x, z) + this.walkLift;
    if (prev && Math.abs(this.walkLift) < 1e-3 && prev.y > y && Math.hypot(prev.x - x, prev.z - z) < 8 && this.walkStyle === "rope") y = prev.y;
    for (const h of w.houses.values()) {
      const lay = houseLayout(w, h);
      for (const v of h.volumes) {
        if (p.x < v.x0 - 0.9 || p.x > v.x1 + 0.9 || p.z < v.z0 - 0.9 || p.z > v.z1 + 0.9) continue;
        // nearest side
        const ds = [v.z1 - p.z, v.x1 - p.x, p.z - v.z0, p.x - v.x0].map(Math.abs);
        const side = ds.indexOf(Math.min(...ds));
        const [nx, nz] = SIDE_N[side];
        if (side % 2 === 0) { z = (nz > 0 ? v.z1 : v.z0) + nz * 0.6; x = Math.min(v.x1 - 0.5, Math.max(v.x0 + 0.5, p.x)); }
        else { x = (nx > 0 ? v.x1 : v.x0) + nx * 0.6; z = Math.min(v.z1 - 0.5, Math.max(v.z0 + 0.5, p.z)); }
        const want = prev ? prev.y + this.walkLift : lay.base + this.walkLift;
        const f = Math.max(0, Math.min(v.floors - 1, Math.round((want - lay.base) / FLOOR_H)));
        y = lay.base + f * FLOOR_H;
        const n = this.app.addNode(x, z, y);
        if (!nodeWall(h, n, lay.base)) { w.nodes.delete(n.id); continue; }
        return { node: n, created: true };
      }
    }
    return { node: this.app.addNode(x, z, Math.max(y, Math.max(w.height(x, z), WATER_Y) + 0.2), this.walkPad ? 1.2 : 0), created: true };
  }
  private walkTo(p: THREE.Vector3) {
    if (!this.chain) return;
    this.app.begin();
    if (this.chainTemp && !this.world.nodes.has(this.chainTemp.id)) this.world.nodes.set(this.chainTemp.id, this.chainTemp);
    const r = this.walkPoint(p, this.chain);
    if (r.node === this.chain) { if (r.created) this.world.nodes.delete(r.node.id); this.app.cancel(); return; }
    if (Math.hypot(r.node.x - this.chain.x, r.node.z - this.chain.z) > 14) { if (r.created) this.world.nodes.delete(r.node.id); this.app.cancel(); this.toast("That's a long way — add a post in between"); return; }
    const dup = this.world.edgesOf(this.chain.id).some(e => e.a === r.node.id || e.b === r.node.id);
    if (!dup) this.app.addEdge(this.chain, r.node, this.walkStyle, this.walkStyle === "rope" ? 0.9 : WALK_W);
    this.chain = r.node; this.chainTemp = null;
    this.walkLift = 0;
    this.app.changed({ structures: true });
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
      const orig = cells.map(([i, j]) => w.level(i, j));
      cells.forEach(([i, j], k) => {
        const l = orig[k];
        let nl = l;
        if (this.terrainOp === "raise") nl = l + 1;
        else if (this.terrainOp === "lower") nl = l - 1;
        else if (this.terrainOp === "flatten") nl = l + Math.sign((d.flat ?? l) - l);
        else { let s = 0, c = 0; for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { s += w.level(i + di, j + dj); c++; } nl = Math.round(s / c); }
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
    const info = PROP_INFO[this.propType];
    const water = this.world.height(p.x, p.z) < WATER_Y - 0.25;
    if (info.water && !water) { this.toast("Boats need water"); return; }
    if (!info.water && !info.big && water && !this.onDeck(p.x, p.z)) { this.toast("That would sink — put it on land or a deck"); return; }
    this.app.begin();
    this.app.addProp(this.propType, Math.round(p.x * 10) / 10, Math.round(p.z * 10) / 10, this.propRot, Math.random());
    this.app.changed({ structures: true });
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
    const setG = (g: THREE.BufferGeometry | null, bad = false) => {
      this.ghost.geometry.dispose(); this.ghostBad.geometry.dispose();
      this.ghost.geometry = !bad && g ? g : new THREE.BufferGeometry();
      this.ghostBad.geometry = bad && g ? g : new THREE.BufferGeometry();
    };
    const w = this.world;
    if (this.tool === "house") {
      const d = this.drag;
      let r: ReturnType<Tools["rectFrom"]> | null = null;
      if (d?.t === "rect") r = this.rectFrom(d.a, d.b, true);
      else if (this.hover) r = this.rectFrom(this.hover, this.hover, false);
      if (!r) return setG(null);
      const h = this.previewHouse(r);
      const mb = new MeshBuilder();
      const out: HouseBuild = { mb, lights: [], anchors: [], foam: [] };
      buildHouse(w, h, out);
      return setG(mb.toGeometry(), !w.footprintFree(r.x0, r.z0, r.x1, r.z1));
    }
    if (this.tool === "prop" && this.hover) {
      const p = { id: "ghost", type: this.propType, x: this.hover.x, z: this.hover.z, rot: this.propRot, seed: 0.5 };
      if (PROP_INFO[this.propType].water) {
        const b = buildBoat(p, this.app.d.mats.ghost);
        const g = b.mesh.geometry;
        const m = new THREE.Matrix4().makeRotationY(-p.rot).setPosition(p.x, WATER_Y + 0.02, p.z);
        g.applyMatrix4(m);
        return setG(g, w.height(p.x, p.z) > WATER_Y - 0.25);
      }
      const mb = new MeshBuilder();
      buildOneProp(w, mb, p, { lights: [], foam: [] });
      return setG(mb.toGeometry());
    }
    if (this.tool === "walk" && this.hover) {
      const mb = new MeshBuilder();
      const h = this.hover;
      const y = (this.chain ? defaultDeckY(w, h.x, h.z) : defaultDeckY(w, h.x, h.z)) + this.walkLift;
      mb.paint([1, 1, 1], 0);
      mb.cyl(h.x, h.z, Math.max(w.height(h.x, h.z), WATER_Y) - 0.05, y + 0.05, 0.12, 0.12, 8);
      mb.cyl(h.x, h.z, y, y + 0.08, 0.5, 0.5, 12);
      if (this.chain) {
        const a = this.chain;
        const side: [number, number, number] = [-(h.z - a.z), 0, h.x - a.x];
        if (Math.hypot(side[0], side[2]) > 0.05) mb.beam([a.x, a.y, a.z], [h.x, y, h.z], side, WALK_W / 2, 0.04);
      }
      return setG(mb.toGeometry());
    }
    setG(null);
  }

  /** WASD / arrow keys pan the camera target; called every frame. */
  panCamera(dt: number) {
    const k = this.keys;
    if (document.activeElement && (document.activeElement as HTMLElement).tagName === "INPUT") return;
    if (k.has("control") || k.has("meta")) return;
    let fx = 0, fz = 0;
    if (k.has("w") || k.has("arrowup")) fz -= 1;
    if (k.has("s") || k.has("arrowdown")) fz += 1;
    if (k.has("a") || k.has("arrowleft")) fx -= 1;
    if (k.has("d") || k.has("arrowright")) fx += 1;
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
