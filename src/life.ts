import * as THREE from "three/webgpu";
import { N } from "./world";

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
