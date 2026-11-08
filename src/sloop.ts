import * as THREE from "three/webgpu";
import type { World } from "./world.ts";
import { buildBoat, updateBoat, type Boat } from "./props.ts";
import { planSloop, sloopAt, type SloopPlan, type SloopPose } from "./voyages.ts";

/** The village's own sloop (not a prop, so it can't be picked): see planSloop / sloopAt. */
export class VillageSloop {
  group = new THREE.Group();
  plan: SloopPlan | null = null;
  pose: SloopPose | null = null;
  private boat: Boat;

  constructor(buildingMat: THREE.Material) {
    this.boat = buildBoat({ id: "village-sloop", type: "sloop", x: 0, z: 0, rot: 0, seed: 0.37 }, buildingMat);
    this.boat.vis = 0; this.boat.mesh.visible = false;
    this.group.add(this.boat.mesh);
  }
  replan(world: World) { this.plan = planSloop(world); }
  /** Where she lies overnight (the smugglers keep clear of it). */
  get berth(): [number, number][] { return this.plan ? [[this.plan.berth.x, this.plan.berth.z]] : []; }
  /** Under way right now (for the soundscape). */
  get moving() { return !!this.pose?.moving && this.pose.vis > 0.05; }
  update(hour: number, t: number) {
    const b = this.boat, p = this.pose = this.plan ? sloopAt(this.plan, hour) : null;
    if (p) { b.x = p.x; b.z = p.z; b.rot = p.rot; b.vis = p.vis; b.moving = p.moving; }
    else b.vis = 0;
    updateBoat(b, t);
  }
}
