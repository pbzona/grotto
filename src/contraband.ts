import * as THREE from "three/webgpu";
import { World, WATER_Y } from "./world";
import { People } from "./life";
import { buildBoat, updateBoat, boatFreeboard, type Boat } from "./props";
import { rng } from "./mesh";
import { CRATES, planRun, runAt, type RunPlan, type RunState, type Lookout } from "./smuggling";
import type { Home } from "./villagers";

/** A seed whose rowboat comes out in the dark green-black paint (index 3 of the boat colours). */
function darkSeed() {
  for (let i = 1; i < 500; i++) { const s = i * 0.0137; if (Math.floor(rng(s)() * 6) === 3) return s; }
  return 0.5;
}

const SLOTS = CRATES * 3; // in the boat, on heads, by the door

/**
 * Draws the night trade from a RunState: the lookout signal, the dark rowboat, two carriers in
 * dark clothes and the crates (in the boat, on their heads, stacked by the door). Replans when the
 * world changes; everything else is a pure function of the hour.
 */
export class Contraband {
  group = new THREE.Group();
  plan: RunPlan | null = null;
  state: RunState = { signal: 0, boat: null, carriers: [], stack: null };
  private boat: Boat;
  private carriers = new People(4, { shirt: 0x2b2f36, pants: 0x24211e });
  private crates: THREE.InstancedMesh;
  private glowMat: THREE.MeshBasicNodeMaterial;
  private haloMat: THREE.MeshBasicNodeMaterial;
  private glows = new THREE.Group();
  private glowGeo = new THREE.SphereGeometry(0.11, 10, 8);
  private haloGeo = new THREE.SphereGeometry(0.3, 12, 8);
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private p = new THREE.Vector3();
  private s = new THREE.Vector3();
  private lookoutKey = "";

  constructor(buildingMat: THREE.Material) {
    this.boat = buildBoat({ id: "smuggler", type: "rowboat", x: 0, z: 0, rot: 0, seed: darkSeed() }, buildingMat);
    this.boat.vis = 0; this.boat.mesh.visible = false;
    const box = new THREE.BoxGeometry(0.3, 0.24, 0.3); box.translate(0, 0.12, 0);
    this.crates = new THREE.InstancedMesh(box, new THREE.MeshStandardNodeMaterial({ color: 0x8a6440, roughness: 0.9 }), SLOTS);
    this.crates.count = 0; this.crates.castShadow = true; this.crates.frustumCulled = false;
    this.crates.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const warm = new THREE.Color().setRGB(5, 3.1, 1.3);
    this.glowMat = new THREE.MeshBasicNodeMaterial({ color: warm, transparent: true, depthWrite: false });
    this.haloMat = new THREE.MeshBasicNodeMaterial({ color: new THREE.Color().setRGB(1.6, 0.9, 0.35), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    this.group.add(this.boat.mesh, this.carriers.group, this.crates, this.glows);
  }

  /** Re-plan tonight's run from the world (call when it changes). */
  replan(world: World, lookouts: Lookout[], homes: Home[]) {
    this.plan = planRun(world, lookouts, homes);
    const key = lookouts.map(l => `${l.x.toFixed(2)},${l.y.toFixed(2)},${l.z.toFixed(2)}`).join(";");
    if (key === this.lookoutKey) return;
    this.lookoutKey = key;
    this.glows.clear();
    for (const l of lookouts) {
      const core = new THREE.Mesh(this.glowGeo, this.glowMat), halo = new THREE.Mesh(this.haloGeo, this.haloMat);
      core.position.set(l.x, l.y, l.z); halo.position.copy(core.position);
      core.renderOrder = halo.renderOrder = 3;
      this.glows.add(core, halo);
    }
  }

  update(hour: number, t: number) {
    const st = this.state = this.plan ? runAt(this.plan, hour) : { signal: 0, boat: null, carriers: [], stack: null };
    // the signal: the lookout lantern flares (bloom does the rest)
    this.glows.visible = st.signal > 0.01;
    this.glowMat.opacity = Math.min(1, st.signal * 1.2);
    this.haloMat.opacity = st.signal * 0.28;
    for (const g of this.glows.children) g.scale.setScalar(0.6 + 0.6 * st.signal);
    // the boat
    const b = this.boat;
    if (st.boat) { b.x = st.boat.x; b.z = st.boat.z; b.rot = st.boat.rot; b.vis = st.boat.vis; b.moving = st.boat.moving; }
    else b.vis = 0;
    updateBoat(b, t);
    this.carriers.update(st.carriers, t);
    // crates
    let n = 0;
    const put = (x: number, y: number, z: number, rot: number, sc: number) => {
      if (sc <= 0.001 || n >= SLOTS) return;
      this.p.set(x, y, z); this.q.setFromEuler(this.e.set(0, rot, 0)); this.s.setScalar(sc);
      this.crates.setMatrixAt(n++, this.m.compose(this.p, this.q, this.s));
    };
    if (st.boat && st.boat.vis > 0.01) {
      const c = Math.cos(-st.boat.rot), s = Math.sin(-st.boat.rot), y0 = WATER_Y + boatFreeboard("rowboat") - 0.08;
      const at = [[0, 0, -0.32], [0, 0, 0.12], [0, 0.24, -0.1]];
      for (let i = 0; i < st.boat.cargo; i++) {
        const [lx, ly, lz] = at[i];
        put(st.boat.x + lx * c + lz * s, y0 + ly, st.boat.z - lx * s + lz * c, -st.boat.rot + i * 0.2, st.boat.vis);
      }
    }
    for (const k of st.carriers) if (k.loaded) put(k.x, k.y + 0.98, k.z, k.heading, k.vis);
    if (st.stack) {
      const { x, y, z, rot, scales } = st.stack, c = Math.cos(rot), s = Math.sin(rot);
      const at = [[-0.17, 0, 0], [0.17, 0, 0.02], [0, 0.24, 0.01]];
      scales.forEach((sc, i) => {
        const [lx, ly, lz] = at[i % 3];
        put(x + lx * c + lz * s, y + ly, z - lx * s + lz * c, rot + i * 0.3, sc);
      });
    }
    this.crates.count = n;
    this.crates.instanceMatrix.needsUpdate = true;
  }
}
