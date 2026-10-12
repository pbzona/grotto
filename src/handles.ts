import * as THREE from "three/webgpu";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

/** What a handle shows in its centre. */
export type Glyph = "arrow" | "plus" | "updown" | "floors" | "move";
export type HandleOpts = {
  glyph: Glyph;
  color: string;
  /** radius on screen in CSS pixels */
  px?: number;
  /** world direction the arrow glyph points along (kept pointing that way on screen) */
  dir?: THREE.Vector3;
  /** stack this many handle-diameters above `at` on screen, so neighbours never overlap */
  slot?: number;
};

const INK = new THREE.Color("#2a2420");
const shapeGeo = (pts: [number, number][]) => new THREE.ShapeGeometry(new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y))));
const rect = (x0: number, y0: number, x1: number, y1: number) => shapeGeo([[x0, y0], [x1, y0], [x1, y1], [x0, y1]]);
const tri = (cx: number, cy: number, s: number, ang: number) => {
  const p = (a: number, r: number): [number, number] => [cx + Math.cos(ang + a) * r, cy + Math.sin(ang + a) * r];
  return shapeGeo([p(0, s), p(2.3, s * 0.85), p(-2.3, s * 0.85)]);
};
function glyphGeo(g: Glyph): THREE.BufferGeometry {
  switch (g) {
    case "arrow": return shapeGeo([[0.5, 0], [-0.2, 0.45], [-0.2, 0.16], [-0.5, 0.16], [-0.5, -0.16], [-0.2, -0.16], [-0.2, -0.45]]);
    case "plus": return mergeGeometries([rect(-0.13, -0.5, 0.13, 0.5), rect(-0.5, -0.13, 0.5, 0.13)]);
    case "updown": return mergeGeometries([tri(0, 0.26, 0.3, Math.PI / 2), tri(0, -0.26, 0.3, -Math.PI / 2)]);
    case "floors": return mergeGeometries([rect(-0.45, -0.46, 0.45, -0.24), rect(-0.45, -0.11, 0.45, 0.11), tri(0, 0.36, 0.22, Math.PI / 2)]);
    case "move": return mergeGeometries([0, 1, 2, 3].map(i => tri(Math.cos(i * Math.PI / 2) * 0.32, Math.sin(i * Math.PI / 2) * 0.32, 0.24, i * Math.PI / 2)).concat(rect(-0.09, -0.09, 0.09, 0.09)));
  }
}
function paint(geo: THREE.BufferGeometry, c: THREE.Color, z: number) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute("normal"); g.deleteAttribute("uv");
  g.translate(0, 0, z);
  const n = g.getAttribute("position").count, cols = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.toArray(cols, i * 3);
  g.setAttribute("color", new THREE.BufferAttribute(cols, 3));
  return g;
}
/** A camera-facing disc of radius 1: dark rim, coloured face, dark glyph. Built in front of its origin so it never sinks into the wall it sits on. */
function discGeo(glyph: Glyph, color: string): THREE.BufferGeometry {
  return mergeGeometries([
    paint(new THREE.CircleGeometry(1, 28), INK, 0.6),
    paint(new THREE.CircleGeometry(0.8, 28), new THREE.Color(color), 0.62),
    paint(glyphGeo(glyph).scale(0.9, 0.9, 1), INK, 0.64),
  ]);
}

const _v = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3(), _up = new THREE.Vector3();

/**
 * The one look for every edit handle: flat discs that face the camera, keep a
 * constant size on screen, hide behind whatever is in front of them, and swell
 * when hovered or held. Handle data rides on `userData.handle` for picking.
 */
export class HandleLayer {
  readonly group = new THREE.Group();
  private cache = new Map<string, THREE.BufferGeometry>();
  private lines: THREE.LineSegments;
  private wash: THREE.Mesh;
  hot: THREE.Object3D | null = null;
  held: THREE.Object3D | null = null;

  constructor(private mat: THREE.Material, private hotMat: THREE.Material, lineMat: THREE.Material, washMat: THREE.Material) {
    this.lines = new THREE.LineSegments(new THREE.BufferGeometry(), lineMat);
    this.lines.frustumCulled = false; this.lines.renderOrder = 9;
    this.wash = new THREE.Mesh(new THREE.BufferGeometry(), washMat);
    this.wash.frustumCulled = false; this.wash.renderOrder = 9;
  }
  get handles(): THREE.Object3D[] { return this.group.children.filter(c => c.userData.handle); }

  clear() {
    this.group.clear(); this.hot = null; this.held = null;
    this.setLines([]); this.setWash([]);
    this.group.add(this.lines, this.wash);
  }
  add(at: THREE.Vector3, data: Record<string, unknown>, o: HandleOpts): THREE.Mesh {
    const key = o.glyph + o.color;
    let geo = this.cache.get(key);
    if (!geo) { geo = discGeo(o.glyph, o.color); this.cache.set(key, geo); }
    const m = new THREE.Mesh(geo, this.mat);
    m.position.copy(at); m.renderOrder = 10; m.frustumCulled = false;
    m.userData = { handle: data, at: at.clone(), px: o.px ?? 12, dir: o.dir?.clone().normalize(), slot: o.slot ?? 0 };
    this.group.add(m);
    return m;
  }
  /** Outline segments, as pairs of points. */
  setLines(pts: THREE.Vector3[]) {
    this.lines.geometry.dispose();
    this.lines.geometry = new THREE.BufferGeometry().setFromPoints(pts);
    this.lines.visible = pts.length > 0;
  }
  /** Soft quads (four corners each) to light up a wall or roof. */
  setWash(quads: THREE.Vector3[][]) {
    this.wash.geometry.dispose();
    const pos: number[] = [];
    for (const [a, b, c, d] of quads) for (const p of [a, b, c, a, c, d]) pos.push(p.x, p.y, p.z);
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    this.wash.geometry = g; this.wash.visible = pos.length > 0;
  }
  setHot(o: THREE.Object3D | null) { this.hot = o; }

  /** Face the camera, hold screen size, point arrows. Call every frame. */
  frame(camera: THREE.PerspectiveCamera, viewH: number, viewW: number) {
    const k = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) / viewH;
    _up.set(0, 1, 0).applyQuaternion(camera.quaternion);
    for (const m of this.group.children) {
      const u = m.userData; if (!u.handle) continue;
      const lit = m === this.held || (m === this.hot && !this.held);
      (m as THREE.Mesh).material = lit ? this.hotMat : this.mat;
      const dist = Math.max(0.5, camera.position.distanceTo(u.at));
      const r = u.px * k * dist * (lit ? 1.25 : 1);
      m.position.copy(u.at).addScaledVector(_up, u.slot * r * 2.4);
      m.quaternion.copy(camera.quaternion);
      m.scale.setScalar(r);
      if (u.dir) {
        _a.copy(m.position).project(camera); _b.copy(m.position).add(_v.copy(u.dir)).project(camera);
        m.rotateZ(Math.atan2((_b.y - _a.y) * viewH, (_b.x - _a.x) * viewW));
      }
    }
  }
}
