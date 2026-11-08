import type { World } from "./world.ts";

interface EditMetadata {
  capture(includeHour: boolean): unknown;
  restore(value: unknown): void;
}
interface Entry { before: string; after: string }

/** A gesture is provisional until commit. No-ops and cancellation preserve redo. */
export class Edits {
  private history: Entry[] = [];
  private future: Entry[] = [];
  private before: { state: string; includeHour: boolean } | null = null;
  private world: World;
  private metadata?: EditMetadata;
  constructor(world: World, metadata?: EditMetadata) { this.world = world; this.metadata = metadata; }
  get active() { return this.before !== null; }
  private snapshot(includeHour: boolean) { return JSON.stringify({ world: this.world.save(), metadata: this.metadata?.capture(includeHour) }); }
  private restore(state: string) {
    const { world, metadata } = JSON.parse(state);
    this.world.load(world);
    this.metadata?.restore(metadata);
  }
  begin(includeHour = false) {
    if (this.active) throw new Error("An edit is already active");
    this.before = { state: this.snapshot(includeHour), includeHour };
  }
  commit() {
    if (this.before === null) return false;
    const { state: before, includeHour } = this.before;
    // Check graph integrity before the provisional world becomes durable.
    for (const e of this.world.edges.values()) if (e.a === e.b || !this.world.nodes.has(e.a) || !this.world.nodes.has(e.b)) {
      this.cancel(); throw new Error("Invalid walkway edit");
    }
    const after = this.snapshot(includeHour);
    this.before = null;
    if (before === after) return false;
    this.history.push({ before, after }); if (this.history.length > 80) this.history.shift();
    this.future.length = 0;
    return true;
  }
  cancel() {
    if (this.before === null) return false;
    const { state: before, includeHour } = this.before; this.before = null;
    if (before === this.snapshot(includeHour)) return false;
    this.restore(before); return true;
  }
  undo() {
    if (this.active) this.cancel();
    const entry = this.history.pop(); if (!entry) return false;
    this.restore(entry.before); this.future.push(entry); return true;
  }
  redo() {
    if (this.active) this.cancel();
    const entry = this.future.pop(); if (!entry) return false;
    this.restore(entry.after); this.history.push(entry); return true;
  }
}
