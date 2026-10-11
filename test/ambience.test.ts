import { test } from "node:test";
import assert from "node:assert/strict";
import { World, carveCove } from "../src/world.ts";
import { ambienceMix, type Mix } from "../src/ambience.ts";

const cove = () => { const w = new World(); carveCove(w); return w; };
const inRange = (m: Mix) => Object.values(m).every(v => v >= 0 && v <= 1 && Number.isFinite(v));

test("ambience: all levels are in 0..1", () => {
  const w = cove();
  for (const [x, z] of [[24, 30], [2, 2], [-5, 60], [24, 5]]) for (const dist of [3, 30, 90]) for (const night of [0, 1])
    assert.ok(inRange(ambienceMix(w, { x, z, dist, night })), `${x},${z} ${dist} ${night}`);
});

test("ambience: gulls by day, insects and owls at night among the trees", () => {
  const w = cove();
  for (let i = 0; i < 6; i++) w.props.set(`p${i}`, { id: `p${i}`, type: "palm", x: 24 + i * 0.5, z: 20, rot: 0, seed: i });
  const day = ambienceMix(w, { x: 24, z: 22, dist: 12, night: 0 }), night = ambienceMix(w, { x: 24, z: 22, dist: 12, night: 1 });
  assert.ok(day.gulls > 0.1 && night.gulls === 0);
  assert.ok(night.insects > 0.2 && day.insects === 0);
  assert.ok(night.owl > 0 && day.owl === 0);
});

test("ambience: surf is loudest close to the shore, wind when pulled back", () => {
  const w = cove();
  const close = ambienceMix(w, { x: 24, z: 30, dist: 8, night: 0 }), far = ambienceMix(w, { x: 24, z: 30, dist: 70, night: 0 });
  assert.ok(close.surf > far.surf);
  assert.ok(far.wind > close.wind);
});

test("ambience: decks creak, people whistle, a lighthouse rings a bell", () => {
  const w = cove(), l = { x: 24, z: 30, dist: 10, night: 0 };
  const quiet = ambienceMix(w, l);
  assert.equal(quiet.creaks, 0); assert.equal(quiet.voices, 0); assert.equal(quiet.bell, 0);
  for (let i = 0; i < 6; i++) w.nodes.set(`n${i}`, { id: `n${i}`, x: 22 + i * 2, z: 30, y: 1, pad: 0 });
  for (let i = 1; i < 6; i++) w.edges.set(`e${i}`, { id: `e${i}`, a: `n${i - 1}`, b: `n${i}`, width: 1.1, style: "deck", rail: false });
  w.props.set("lh", { id: "lh", type: "lighthouse", x: 5, z: 5, rot: 0, seed: 1 });
  const busy = ambienceMix(w, { ...l, people: [{ x: 24, z: 30, vis: 1 }, { x: 25, z: 30, vis: 1 }] });
  assert.ok(busy.creaks > 0.2 && busy.voices > 0.2 && busy.bell > 0);
});
