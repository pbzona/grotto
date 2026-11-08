import { test } from "node:test";
import assert from "node:assert/strict";
import { World, N, grottoCells, type Prop } from "../src/world.ts";
import { Edits } from "../src/edits.ts";

test("valid saves round-trip without sharing record objects", () => {
  const w = new World(); w.setLevel(2, 3, 12);
  w.nodes.set("a", { id: "a", x: -0.6, z: N + 0.6, y: 1, pad: 0 });
  const save = w.save(), copy = new World(); copy.load(save);
  assert.deepEqual(copy.save(), save); save.nodes[0].x = 9;
  assert.equal(copy.nodes.get("a")!.x, -0.6);
  const exported = copy.save();
  exported.nodes[0].x = 11;
  assert.equal(copy.nodes.get("a")!.x, -0.6, "exported records do not alias the live world");
});

test("malformed saves fail atomically, including invalid paint after valid heights", () => {
  const w = new World(); w.heights.fill(9); const before = w.save(), version = w.version;
  const cases = [
    { ...before, v: 999 }, { ...before, n: N + 1 },
    { ...before, heights: btoa("\x02") },
    { ...before, heights: btoa("\x07".repeat(N * N)), paint: "%".repeat(before.paint.length) },
    { ...before, heights: btoa("\xff".repeat(N * N)) },
    { ...before, nodes: [{ id: "n", x: NaN, z: 1, y: 1, pad: 0 }] },
    { ...before, edges: [{ id: "e", a: "missing", b: "other", width: 1, style: "deck", rail: false }] },
    { ...before, props: [{ id: "p", type: "unknown", x: 1, z: 1, seed: 1, rot: 0 }] },
  ];
  for (const s of cases) { assert.throws(() => w.load(s)); assert.deepEqual(w.save(), before); assert.equal(w.version, version); }
});

test("no-op and cancelled gestures preserve redo; a gesture produces one undo step", () => {
  const w = new World(), edits = new Edits(w);
  edits.begin(); w.setLevel(1, 1, 4); w.setLevel(1, 1, 5); assert.equal(edits.commit(), true);
  assert.equal(edits.undo(), true); assert.equal(w.level(1, 1), 0);
  edits.begin(); assert.equal(edits.commit(), false);
  edits.begin(); w.setLevel(1, 1, 8); assert.equal(edits.cancel(), true);
  assert.equal(edits.redo(), true); assert.equal(w.level(1, 1), 5);
  assert.equal(edits.undo(), true); assert.equal(edits.undo(), false);
});

test("metadata edits restore cove and optionally hour without changing time on ordinary undo", () => {
  const w = new World();
  const state = { cove: "classic", hour: 16 };
  const edits = new Edits(w, {
    capture: includeHour => ({ cove: state.cove, ...(includeHour ? { hour: state.hour } : {}) }),
    restore: value => { const v = value as { cove: string; hour?: number }; state.cove = v.cove; if (v.hour !== undefined) state.hour = v.hour; },
  });
  edits.begin(); state.cove = "fjord"; assert.equal(edits.commit(), true);
  assert.equal(edits.undo(), true); assert.equal(state.cove, "classic");
  state.hour = 19;
  assert.equal(edits.redo(), true); assert.equal(state.cove, "fjord"); assert.equal(state.hour, 19);
  edits.begin(true); state.hour = 3; assert.equal(edits.commit(), true);
  edits.undo(); assert.equal(state.hour, 19);
  edits.redo(); assert.equal(state.hour, 3);
  edits.begin(); w.setLevel(2, 2, 7); edits.commit(); state.hour = 8;
  edits.undo(); assert.equal(state.hour, 8);
});

test("invalid graph edits roll back before committing", () => {
  const w = new World(), edits = new Edits(w), before = w.save();
  edits.begin(); w.edges.set("e", { id: "e", a: "a", b: "b", width: 1, style: "deck", rail: false });
  assert.throws(() => edits.commit()); assert.deepEqual(w.save(), before); assert.equal(edits.active, false);
});

test("edge splitting preserves style, width and rails, and cancellation restores the original", () => {
  const w = new World(), edits = new Edits(w);
  for (const [id, x] of [["a", 1], ["b", 9]] as const) w.nodes.set(id, { id, x, z: 2, y: 1, pad: 0 });
  w.edges.set("e", { id: "e", a: "a", b: "b", width: 1.4, style: "rope", rail: true });
  const before = w.save(); edits.begin();
  const m = { id: "m", x: 5, z: 2, y: 1, pad: 0 }; w.nodes.set(m.id, m);
  const edges = w.splitEdge("e", m);
  assert.equal(w.edges.has("e"), false);
  for (const e of edges) { assert.equal(e.rail, true); assert.equal(e.style, "rope"); assert.equal(e.width, 1.4); assert.ok(w.nodes.has(e.a) && w.nodes.has(e.b)); }
  edits.cancel(); assert.deepEqual(w.save(), before);
});

function grotto(id = "g"): Prop { return { id, type: "grotto", x: 24, z: 24, rot: 0, seed: 0.3 }; }
test("carving preserves editable base terrain through moves, removal and round-trip saves", () => {
  const w = new World(), p = grotto(); w.heights.fill(18); w.props.set(p.id, p); w.rebuildCarving();
  const cell = grottoCells(p).find(c => c.under)!;
  assert.equal(w.level(cell.i, cell.j), cell.cap); assert.equal(w.baseLevel(cell.i, cell.j), 18);
  w.setLevel(cell.i, cell.j, 20); w.rebuildCarving();
  assert.equal(w.level(cell.i, cell.j), cell.cap);
  const saved = w.save(); assert.equal(saved.v, 2); assert.equal("carved" in saved.props[0], false);
  const loaded = new World(); loaded.load(saved); assert.equal(loaded.baseLevel(cell.i, cell.j), 20); assert.equal(loaded.level(cell.i, cell.j), cell.cap);
  p.x += 12; w.rebuildCarving(); assert.equal(w.level(cell.i, cell.j), 20);
  loaded.props.delete(p.id); loaded.rebuildCarving(); assert.equal(loaded.level(cell.i, cell.j), 20);
});

test("overlapping carve modifiers remain effective when one grotto is removed", () => {
  const w = new World(), a = grotto("a"), b = grotto("b"); w.heights.fill(18);
  w.props.set(a.id, a); w.props.set(b.id, b); w.rebuildCarving();
  const c = grottoCells(a).find(c => c.under)!; w.setLevel(c.i, c.j, 21);
  w.props.delete(a.id); w.rebuildCarving(); assert.equal(w.level(c.i, c.j), c.cap);
  w.props.delete(b.id); w.rebuildCarving(); assert.equal(w.level(c.i, c.j), 21);
});

test("v1 saves migrate original grotto terrain without mutating their input", () => {
  const w = new World(), p = grotto(); w.heights.fill(18);
  const cells = grottoCells(p), carved: [number, number, number][] = [];
  for (const c of cells) { carved.push([c.i, c.j, 18]); w.setLevel(c.i, c.j, c.cap); }
  const legacy = { ...w.save(), v: 1, props: [{ ...p, carved }] }, before = structuredClone(legacy);
  w.load(legacy); const c = cells.find(c => c.under)!;
  assert.equal(w.baseLevel(c.i, c.j), 18); assert.equal(w.level(c.i, c.j), c.cap); assert.deepEqual(legacy, before);
});

test("undo and redo preserve terrain edits beneath a grotto", () => {
  const w = new World(), p = grotto(); w.heights.fill(18); w.props.set(p.id, p); w.rebuildCarving();
  const edits = new Edits(w), c = grottoCells(p).find(c => c.under)!;
  edits.begin(); w.setLevel(c.i, c.j, 20); w.rebuildCarving(); edits.commit();
  edits.begin(); w.props.delete(p.id); w.rebuildCarving(); edits.commit(); assert.equal(w.level(c.i, c.j), 20);
  edits.undo(); assert.equal(w.level(c.i, c.j), c.cap); assert.equal(w.baseLevel(c.i, c.j), 20);
  edits.undo(); assert.equal(w.baseLevel(c.i, c.j), 18);
  edits.redo(); edits.redo(); assert.equal(w.level(c.i, c.j), 20);
});
