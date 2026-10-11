import * as THREE from "three/webgpu";
import { N } from "./world";
import { MAX_VILLAGERS, type Villager } from "./villagers";

const SHIRTS = [0xe8dcc4, 0x3f6f8f, 0xb5523b, 0x6d8a5a, 0xd9a441, 0x2f3d55, 0xf2efe8, 0x8c5a7a];
const SKIN = [0xe9c4a2, 0xc99a74, 0x9a6b4a, 0x6e4a33];
const PANTS = [0x4a4038, 0x3b4656, 0x6b5a45, 0x2e2e33];

/**
 * Villagers drawn as tiny low-poly figures: three instanced meshes (body, head, legs) for everyone,
 * so the cost is a few draw calls however many there are. Appearing and leaving is a quick scale.
 */
/** What a figure needs to be drawn: villagers and the night's carriers both fit. */
export type Figure = Pick<Villager, "vis" | "seed" | "phase" | "stride" | "x" | "y" | "z" | "heading"> & { loaded?: boolean };

export class People {
  group = new THREE.Group();
  private body: THREE.InstancedMesh;
  private head: THREE.InstancedMesh;
  private legs: THREE.InstancedMesh;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private p = new THREE.Vector3();
  private s = new THREE.Vector3();
  private c = new THREE.Color();
  private leg = new THREE.Matrix4();
  constructor(private cap = MAX_VILLAGERS, private dress?: { shirt: number; pants: number }) {
    const mat = () => new THREE.MeshStandardNodeMaterial({ roughness: 0.85 });
    const bodyG = new THREE.CylinderGeometry(0.095, 0.13, 0.44, 7); bodyG.translate(0, 0.6, 0);
    const headG = new THREE.IcosahedronGeometry(0.085, 1); headG.translate(0, 0.91, 0);
    const legG = new THREE.BoxGeometry(0.075, 0.4, 0.08); legG.translate(0, -0.2, 0);
    this.body = new THREE.InstancedMesh(bodyG, mat(), cap);
    this.head = new THREE.InstancedMesh(headG, mat(), cap);
    this.legs = new THREE.InstancedMesh(legG, mat(), cap * 2);
    for (const im of [this.body, this.head, this.legs]) {
      im.count = 0; im.castShadow = true; im.frustumCulled = false;
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      for (let i = 0; i < im.instanceMatrix.count; i++) im.setColorAt(i, this.c.set(0xffffff));
      this.group.add(im);
    }
  }
  update(people: Figure[], t: number) {
    let n = 0;
    for (const v of people) {
      if (v.vis <= 0.001 || n >= this.cap) continue;
      const k = Math.floor(v.seed * 1e4);
      const ease = v.vis * v.vis * (3 - 2 * v.vis);
      const walking = v.phase === "walk";
      const swing = walking ? Math.sin(v.stride * 9) * (v.loaded ? 0.3 : 0.5) : 0;
      const bob = walking ? Math.abs(Math.cos(v.stride * 9)) * 0.025 : Math.sin(t * 1.3 + k) * 0.004;
      const sway = v.phase === "idle" ? Math.sin(t * 0.7 + k) * 0.25 : 0;
      this.p.set(v.x, v.y + bob, v.z);
      this.q.setFromEuler(this.e.set(0, v.heading + sway, 0));
      const sc = 0.92 + (k % 7) * 0.025;
      this.s.set(sc * (0.6 + 0.4 * ease), sc * ease, sc * (0.6 + 0.4 * ease));
      this.m.compose(this.p, this.q, this.s);
      this.body.setMatrixAt(n, this.m); this.body.setColorAt(n, this.c.set(this.dress?.shirt ?? SHIRTS[k % SHIRTS.length]));
      this.head.setMatrixAt(n, this.m); this.head.setColorAt(n, this.c.set(SKIN[(k >> 3) % SKIN.length]));
      for (let side = 0; side < 2; side++) {
        // hip pivot: offset sideways, swing about local x
        this.leg.makeRotationX(side ? swing : -swing).setPosition((side ? 1 : -1) * 0.05, 0.4, 0);
        this.legs.setMatrixAt(n * 2 + side, this.leg.premultiply(this.m));
        this.legs.setColorAt(n * 2 + side, this.c.set(this.dress?.pants ?? PANTS[(k >> 5) % PANTS.length]));
      }
      n++;
    }
    this.body.count = this.head.count = n; this.legs.count = n * 2;
    for (const im of [this.body, this.head, this.legs]) {
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }
  }
}

/** A handful of gulls wheeling over the cove: one tiny mesh each, wings flapped by rotation. Cheap. */
export class Gulls {
  group = new THREE.Group();
  private birds: { root: THREE.Object3D; l: THREE.Object3D; r: THREE.Object3D; cx: number; cz: number; rad: number; h: number; sp: number; ph: number }[] = [];
  constructor(count = 7) {
    const mat = new THREE.MeshStandardNodeMaterial({ color: 0xf2ece0, roughness: 0.8, side: THREE.DoubleSide });
    const tip = new THREE.MeshStandardNodeMaterial({ color: 0x3a3a3e, roughness: 0.8, side: THREE.DoubleSide });
    const body = new THREE.CapsuleGeometry(0.05, 0.22, 3, 6); body.rotateX(Math.PI / 2);
    const wing = new THREE.BufferGeometry();
    wing.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0.06, 0, 0, -0.07, 0.34, 0.02, -0.05, 0.34, 0.02, -0.05, 0.52, 0.0, -0.12, 0, 0, 0.06], 3));
    wing.computeVertexNormals();
    const wingTip = new THREE.BufferGeometry();
    wingTip.setAttribute("position", new THREE.Float32BufferAttribute([0.34, 0.02, -0.05, 0.52, 0.0, -0.12, 0.44, 0.01, -0.02], 3));
    wingTip.computeVertexNormals();
    for (let i = 0; i < count; i++) {
      const root = new THREE.Group();
      root.add(new THREE.Mesh(body, mat));
      const l = new THREE.Group(), r = new THREE.Group();
      l.add(new THREE.Mesh(wing, mat), new THREE.Mesh(wingTip, tip));
      r.add(new THREE.Mesh(wing, mat), new THREE.Mesh(wingTip, tip));
      r.scale.x = -1;
      root.add(l, r);
      root.scale.setScalar(1.3);
      this.group.add(root);
      this.birds.push({ root, l, r, cx: N / 2 + (Math.random() - 0.5) * 10, cz: N * 0.6 + (Math.random() - 0.5) * 10, rad: 7 + Math.random() * 10, h: 7 + Math.random() * 6, sp: (0.12 + Math.random() * 0.1) * (Math.random() < 0.5 ? 1 : -1), ph: Math.random() * 10 });
    }
  }
  update(t: number, night: number) {
    this.group.visible = night < 0.6;
    if (!this.group.visible) return;
    for (const b of this.birds) {
      const a = t * b.sp + b.ph;
      const x = b.cx + Math.cos(a) * b.rad, z = b.cz + Math.sin(a) * b.rad * 0.8;
      const y = b.h + Math.sin(t * 0.4 + b.ph) * 0.8;
      b.root.position.set(x, y, z);
      // face along the circle, bank into the turn
      const dx = -Math.sin(a) * Math.sign(b.sp), dz = Math.cos(a) * 0.8 * Math.sign(b.sp);
      b.root.rotation.set(0, Math.atan2(dx, dz), -0.35 * Math.sign(b.sp), "YXZ");
      // flap in bursts, glide in between
      const burst = Math.max(0, Math.sin(t * 0.7 + b.ph * 3));
      const flap = Math.sin(t * 9 + b.ph) * 0.55 * burst + 0.12;
      b.l.rotation.z = flap; b.r.rotation.z = -flap;
    }
  }
}
