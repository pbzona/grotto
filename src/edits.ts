import type { World } from "./world";

/** A gesture is provisional until commit. No-ops and cancellation preserve redo. */
export class Edits {
  private history: string[] = [];
  private future: string[] = [];
  private before: string | null = null;
  private world: World;
  constructor(world: World) { this.world = world; }
  get active() { return this.before !== null; }
  private snapshot() { return JSON.stringify(this.world.save()); }
  begin() { if (this.active) throw new Error("An edit is already active"); this.before = this.snapshot(); }
  commit() {
    if (this.before === null) return false;
    const before = this.before;
    // Check graph integrity before the provisional world becomes durable.
    for (const e of this.world.edges.values()) if (e.a === e.b || !this.world.nodes.has(e.a) || !this.world.nodes.has(e.b)) {
      this.cancel(); throw new Error("Invalid walkway edit");
    }
    this.before = null;
    if (before === this.snapshot()) return false;
    this.history.push(before); if (this.history.length > 80) this.history.shift();
    this.future.length = 0;
    return true;
  }
  cancel() {
    if (this.before === null) return false;
    const before = this.before; this.before = null;
    if (before === this.snapshot()) return false;
    this.world.load(JSON.parse(before)); return true;
  }
  undo() {
    if (this.active) this.cancel();
    const s = this.history.at(-1); if (!s) return false;
    const current = this.snapshot(); this.world.load(JSON.parse(s));
    this.history.pop(); this.future.push(current); return true;
  }
  redo() {
    if (this.active) this.cancel();
    const s = this.future.at(-1); if (!s) return false;
    const current = this.snapshot(); this.world.load(JSON.parse(s));
    this.future.pop(); this.history.push(current); return true;
  }
}
