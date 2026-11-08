(async () => {
  const g = window.__grotto, a = g.app, w = g.world, t = g.tools, c = g.renderer.domElement, results = [];
  const ok = (name, condition) => { if (!condition) throw new Error(name); results.push('PASS ' + name); };
  const state = () => JSON.stringify(w.save());
  const fresh = w.save();
  const reset = () => { t.cancelDrag(); t.endChain(); w.load(fresh); a.markAll(); a.update(0); t.setTool('select'); t.select(null); };
  g.camera.position.set(24, 30, 40); g.controls.target.set(24, 1, 22); g.controls.update();
  const scr = (x, y, z) => { g.camera.updateMatrixWorld(); const v = new (g.camera.position.constructor)(x, y, z).project(g.camera); const r = c.getBoundingClientRect(); return [r.left + (v.x + 1) / 2 * r.width, r.top + (1 - v.y) / 2 * r.height]; };
  const ev = (type, p) => c.dispatchEvent(new PointerEvent(type, { clientX: p[0], clientY: p[1], button: 0, buttons: 1, pointerId: 3, bubbles: true }));
  const click = p => { ev('pointermove', p); ev('pointerdown', p); ev('pointerup', p); };
  const escape = () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

  // Cancel an actual terrain drag through both browser cancellation paths.
  for (const method of ['pointercancel', 'Escape']) {
    reset(); t.setTool('terrain'); const before = state(), p = scr(12.5, 3, 17.5);
    ev('pointerdown', p); ev('pointermove', [p[0] + 3, p[1] + 3]);
    ok(method + ' starts a changed gesture', state() !== before && a.edits.active);
    if (method === 'Escape') escape(); else ev('pointercancel', p);
    ok(method + ' rolls back and ends interaction', state() === before && !a.edits.active && !a.interacting);
  }

  reset(); a.begin(); w.setLevel(1, 1, w.baseLevel(1, 1) + 1); a.changed({ terrain: true }); a.undo();
  a.begin(true); a.cancel(); ok('cancelled selection preserves redo', a.redo());

  for (const kind of ['house', 'edge', 'prop']) {
    reset();
    const item = kind === 'house' ? [...w.houses.values()].find(h => h.volumes[0].roof !== 'flat')
      : kind === 'edge' ? [...w.edges.values()][0] : [...w.props.values()].find(p => p.type === 'palm');
    const label = kind === 'house' ? 'Pitch' : kind === 'edge' ? 'Width' : 'Size';
    t.select({ kind, id: item.id, ...(kind === 'house' ? { vi: 0 } : {}) });
    const range = () => [...document.querySelectorAll('.pr')].find(r => r.querySelector('.pl')?.textContent === label).querySelector('input');
    const input = (slider, value) => { slider.value = String(value); slider.dispatchEvent(new Event('input', { bubbles: true })); };
    const before = state(), slider = range();
    const values = [0.8, 1.1, 1.4].filter(v => v !== +slider.value);
    input(slider, values[0]); await new Promise(resolve => setTimeout(resolve, 150));
    ok(kind + ' slider keeps its live control', slider.isConnected && a.edits.active);
    input(slider, values[1]); slider.dispatchEvent(new Event('change', { bubbles: true }));
    ok(kind + ' slider commits one undo step', !a.edits.active && state() !== before && a.undo() && state() === before);
    t.select({ kind, id: item.id, ...(kind === 'house' ? { vi: 0 } : {}) });
    const cancelled = range(); input(cancelled, values[0]);
    cancelled.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    ok(kind + ' slider Escape restores the original value', !a.edits.active && state() === before);
  }

  // Starting a chain in the middle of an edge temporarily splits it. Escape must restore it.
  reset(); t.setTool('walk'); const e = [...w.edges.values()].find(e => {
    const x = w.nodes.get(e.a), y = w.nodes.get(e.b); return x.z > 26 && y.z > 26 && Math.hypot(x.x - y.x, x.z - y.z) > 3;
  });
  const x = w.nodes.get(e.a), y = w.nodes.get(e.b), p = scr((x.x + y.x) / 2, (x.y + y.y) / 2, (x.z + y.z) / 2), before = state();
  click(p); ok('starting on edge preserves graph integrity', [...w.edges.values()].every(e => w.nodes.has(e.a) && w.nodes.has(e.b)));
  ok('edge split is a pending edit', a.edits.active && !w.edges.has(e.id));
  escape(); ok('abandoned edge split rolls back', state() === before && !a.edits.active);
  click(p); ev('pointerdown', p); ev('pointercancel', p);
  ok('pointer cancellation clears provisional walkway chain', state() === before && !a.edits.active && t.chain === null);

  reset(); t.setTool('paint'); t.paintType = 'cobble'; const scatter = a.scatterCache.part;
  click(scr(14.5, 3.5, 20.5)); a.update(0);
  ok('painting invalidates natural scatter', a.scatterCache.part !== scatter);
  const boat = a.boats[0].mesh; a.changed({ structures: true }); a.update(0);
  ok('unrelated rebuild retains boat geometry', a.boats[0].mesh === boat);

  reset(); const gr = [...w.props.values()].find(p => p.type === 'grotto' && p.carved.length), [i, j] = gr.carved[0];
  const level = Math.min(24, w.baseLevel(i, j) + 1);
  a.begin(); w.setLevel(i, j, level); a.changed({ terrain: true });
  t.select({ kind: 'prop', id: gr.id }); t.deleteSelection(); a.update(0);
  ok('grotto deletion preserves later terrain edits', w.level(i, j) === level);
  a.undo(); ok('undo restores derived grotto without losing base edit', w.props.has(gr.id) && w.baseLevel(i, j) === level && w.level(i, j) < level);

  reset(); const saved = state(), hour = a.hour;
  let failed = false; try { a.importFile({ world: { ...w.save(), paint: '%%%' }, hour: 3 }); } catch { failed = true; }
  ok('failed import leaves world and time intact', failed && state() === saved && a.hour === hour && !a.edits.active);
  const cove = { ...a.cove };
  a.importFile({ world: w.save(), hour: 3, cove: { kind: 'fjord', seed: 12 } });
  ok('import restores time and preset even for an unchanged world', a.hour === 3 && a.cove.kind === 'fjord' && a.cove.seed === 12);
  a.undo(); ok('undo restores imported time and preset', a.hour === hour && JSON.stringify(a.cove) === JSON.stringify(cove));
  a.redo(); ok('redo restores imported time and preset', a.hour === 3 && a.cove.kind === 'fjord');
  a.undo();
  a.begin(); w.setLevel(1, 1, w.baseLevel(1, 1) + 1); a.changed({ terrain: true });
  a.hour = 8; a.undo(); ok('ordinary world undo leaves the current hour alone', a.hour === 8);

  reset(); a.save(); const durable = localStorage.getItem('grotto.cove.v1');
  a.begin(true); w.setLevel(1, 1, w.baseLevel(1, 1) + 1); a.changed({ terrain: true });
  await new Promise(resolve => setTimeout(resolve, 750));
  ok('pending gestures never autosave', !a.save() && localStorage.getItem('grotto.cove.v1') === durable);
  a.commit(); await new Promise(resolve => setTimeout(resolve, 750));
  ok('committed edits autosave after debounce', JSON.stringify(JSON.parse(localStorage.getItem('grotto.cove.v1')).world) === state());

  // False flags from another change must never erase pending terrain invalidation.
  a.changed({ terrain: true }); a.changed({ structures: true, terrain: false });
  ok('invalidation accumulates until rebuild', a.dirty.terrain);

  const setItem = Storage.prototype.setItem; let message = '';
  const previous = a.onSaveError; a.onSaveError = text => message = text;
  Storage.prototype.setItem = () => { throw new DOMException('Full', 'QuotaExceededError'); };
  try { ok('storage errors are visible', !a.save() && message.includes('Export')); }
  finally { Storage.prototype.setItem = setItem; a.onSaveError = previous; }
  const key = 'grotto.cove.v1', original = localStorage.getItem(key);
  localStorage.setItem(key, '{broken');
  ok('corrupt stored save is backed up', !a.restore() && localStorage.getItem(key + '.recovery') === '{broken');
  if (original === null) localStorage.removeItem(key); else localStorage.setItem(key, original);
  reset(); a.hour = hour; a.saveError = null;

  const samples = [];
  for (let n = 0; n < 8; n++) { a.changed({ structures: true }); const start = performance.now(); a.update(0); samples.push(performance.now() - start); }
  samples.sort((a, b) => a - b);
  {
    // a walkway built under one post of a laundry line lifts it onto the deck, and follows the deck's height
    reset();
    for (let i = 8; i < 16; i++) for (let j = 29; j < 38; j++) w.setLevel(i, j, 8);
    const { propBase, greeneryHidden } = await import('/src/props.ts');
    const gy = w.height(11, 33), L = a.addProp('laundry', 11, 33, 0, 0.3);
    const D1 = a.addNode(11.9, 31.5, gy + 1), D2 = a.addNode(11.9, 34.5, gy + 1); a.addEdge(D1, D2);
    ok('laundry steps up onto a deck under one post', Math.abs(propBase(w, L) - (gy + 1)) < 0.05);
    D1.y += 0.5; D2.y += 0.5;
    ok('laundry follows the deck when it is raised', Math.abs(propBase(w, L) - (gy + 1.5)) < 0.05);
    const { buildOneProp } = await import('/src/props.ts'), { MeshBuilder } = await import('/src/mesh.ts');
    const lowest = p => { const mb = new MeshBuilder(); buildOneProp(w, mb, p, { lights: [], foam: [] }); const g = mb.toGeometry(); g.computeBoundingBox(); return g.boundingBox.min.y; };
    ok('the off-deck post slides onto the deck instead of a stilt', lowest(L) > gy + 1.5 - 0.1);
    // a palm placed so it would lean through a deck is refused with a reason
    t.setTool('prop'); t.propRot = Math.PI; t.propSeed = 0.5;
    const pc = t.propCheck('palm', 12.65, 33);
    t.propRot = 0; const pc2 = t.propCheck('palm', 12.65, 33);
    ok('palm leaning into a raised deck is refused, turned away is fine', !pc.ok && /walkway/.test(pc.why) && pc2.ok);
    t.setTool('select');
    // a palm leaning over the deck hides when its trunk would pass through the planks
    const P2 = a.addProp('palm', 12.9, 33, Math.PI, 0.5); P2.opts = { height: 1, lean: 1.4 };
    D1.y = D2.y = gy + 0.25;
    ok('palm beside a low deck still drawn', !greeneryHidden(w, P2));
    let pierced = false; for (let y = 0.5; y < 4 && !pierced; y += 0.1) { D1.y = D2.y = gy + y; pierced = greeneryHidden(w, P2); }
    ok('palm leaning through a raised deck is hidden', pierced);
    reset();
  }
  {
    // stairs: a flight steeper than MAX_STAIR is refused; a dragged post stops at the limit
    const { MAX_STAIR, slopeOf } = await import('/src/walks.ts');
    for (let j = 29; j <= 37; j++) for (let i = 8; i <= 15; i++) w.setLevel(i, j, 8);
    a.changed({ terrain: true }); a.update(0);
    const gy = w.height(11, 33), V = g.camera.position.constructor;
    t.setTool('walk');
    const A = a.addNode(11, 31, gy + 0.2), n0 = w.edges.size;
    t.chain = A; t.walkLift = 3; t['walkTo'](new V(11, gy, 33)); t.escape(); a.update(0);
    ok('a flight steeper than stairs go is refused', w.edges.size === n0);
    t.chain = A; t.walkLift = 1; t['walkTo'](new V(11, gy, 33)); t.escape(); a.update(0);
    const e = [...w.edges.values()].find(e => e.a === A.id || e.b === A.id);
    ok('a climbable flight is laid', !!e && [...w.edges.values()].every(e => slopeOf(w.nodes.get(e.a), w.nodes.get(e.b)) <= MAX_STAIR + 1e-6));
    reset();
  }
  {
    // grotto: walkways tie on to the dock, and the cliff over the vault is drawn uncarved
    const { grottoTies, grottoDims, DECK_Y } = await import('/src/world.ts');
    const p = [...w.props.values()].find(p => p.type === 'grotto');
    const c = Math.cos(p.rot), s = Math.sin(p.rot), W = (lx, lz) => [p.x + lx * c - lz * s, p.z + lx * s + lz * c];
    const tie = grottoTies(p)[0], V = g.camera.position.constructor;
    const untie = () => { for (const n of [...w.nodes.values()]) if (Math.hypot(n.x - tie.x, n.z - tie.z) < 1e-6) w.removeNode(n.id); w.pruneNodes(); a.changed({ structures: true }); };
    untie();
    t.setTool('walk');
    const lx = (tie.x - p.x) * c + (tie.z - p.z) * s, [ox, oz] = W(lx, 4.5);
    const A = a.addNode(ox, oz, DECK_Y);
    t.chain = A; t.walkLift = 0; t['walkTo'](new V(tie.x + 0.4, 0.2, tie.z - 0.3)); t.escape(); a.update(0);
    ok('a walkway ties on to the grotto dock', [...w.nodes.values()].some(n => Math.hypot(n.x - tie.x, n.z - tie.z) < 1e-6 && Math.abs(n.y - DECK_Y) < 1e-6));
    {
      const { walkGraph, route } = await import('/src/villagers.ts');
      const tn = [...w.nodes.values()].find(n => Math.hypot(n.x - tie.x, n.z - tie.z) < 1e-6);
      const pg = walkGraph(w), dock = [...pg.nodes.keys()].filter(id => !w.nodes.has(id));
      const te = w.edgesOf(tn.id);
      ok('coming in dead ahead needs no extra post', te.length === 1 && (te[0].a === A.id || te[0].b === A.id));
      ok('people can walk on in along the dock', dock.length === 3 && !!route(pg, A.id, dock[2]));
      const far = pg.nodes.get(dock[2]), fl = (far.x - p.x) * c + (far.z - p.z) * s, fz = -(far.x - p.x) * s + (far.z - p.z) * c;
      ok('the dock walk goes in under the arch', fz < -1 && Math.abs(fl) < Math.abs(lx) + 0.5 && Math.sign(fl) === Math.sign(lx));
    }
    // from off to the side, the walkway runs straight onto the quay: no approach post
    reset(); untie(); t.setTool('walk');
    {
      const [sx, sz] = W(lx - Math.sign(lx) * 3, 4);
      const B = a.addNode(sx, sz, DECK_Y);
      t.chain = B; t.walkLift = 0; t['walkTo'](new V(tie.x, 0.2, tie.z)); t.escape(); a.update(0);
      const tn = [...w.nodes.values()].find(n => Math.hypot(n.x - tie.x, n.z - tie.z) < 1e-6);
      const es = tn ? w.edgesOf(tn.id) : [], o = es.length === 1 ? w.nodes.get(es[0].a === tn.id ? es[0].b : es[0].a) : null;
      ok('a side approach ties straight on to the quay', !!o && o.id === B.id);
    }
    const { D } = grottoDims(p), terr = a.d.terrain;
    const [bx, bz] = W(0, -D - 0.6), back = terr.surface(bx, bz);
    ok('ground behind the vault keeps its height', Math.abs(back.y - w.height(bx, bz, true)) < 1e-6);
    const [mx, mz] = W(0, -D / 2);
    ok('ground over the vault is restored or opened for the shell', [1, 3].includes(terr.surface(mx, mz).kind));
    reset();
  }

  // Placed boats are plain props: they stay where they were put all day, and selecting one keeps it shown.
  {
    reset(); const hour = a.hour, at = h => { a.hour = h; a.update(0.4); a.update(0.4); return a.boats.map(b => ({ b, p: w.props.get(b.id) })); };
    const still = list => list.length > 0 && list.every(({ b, p }) => b.x === p.x && b.z === p.z && b.mesh.visible && b.mesh.scale.x === 1);
    ok('placed boats stay on their moorings at night', still(at(2)));
    ok('placed boats stay on their moorings at noon', still(at(12.5)));
    const id = a.boats[0].id;
    t.setTool('select'); t.select({ kind: 'prop', id: a.boats[0].id }); a.update(0.1); g.updateVillagers(0.1);
    ok('a selected boat stays visible', a.boats[0].mesh.visible && a.boats[0].mesh.scale.x === 1 && w.props.has(id));
    t.select(null);
    // the village sloop: alongside the pier head overnight, gone past the map edge by day
    a.hour = 2; g.updateVillagers(1);
    const sl = g.sloop;
    ok('the village sloop has a berth by the pier', !!sl.plan && w.isWater(sl.plan.berth.x, sl.plan.berth.z));
    ok('the village sloop is moored overnight', sl.pose && sl.pose.vis === 1 && !sl.pose.moving);
    a.hour = 12.5; g.updateVillagers(0);
    ok('the village sloop is off the map at noon', sl.pose.vis === 0);
    let worst = Infinity, edge = false;
    for (let h = sl.plan.depart; h < sl.plan.depart + sl.plan.travel; h += 0.05) {
      a.hour = h; g.updateVillagers(0);
      const p = sl.pose;
      if (p.vis > 0.05) worst = Math.min(worst, 0.2 - w.height(Math.min(47.9, Math.max(0.1, p.x)), Math.min(47.9, Math.max(0.1, p.z))));
      if (p.x < 0 || p.z < 0 || p.x > 48 || p.z > 48) edge = true;
    }
    ok('the village sloop sails out past the map edge over deep water', edge && worst > 0.4, `depth ${worst.toFixed(2)}`);
    a.hour = hour; g.updateVillagers(0); reset();
  }
  {
    // WASD panning survives Cmd chords, lost focus and a focused slider
    const key = (type, code, extra = {}) => window.dispatchEvent(new KeyboardEvent(type, { code, key: extra.key ?? code, bubbles: true, ...extra }));
    const moved = () => { const z0 = g.controls.target.z; t.panCamera(0.1); return Math.abs(g.controls.target.z - z0) > 1e-4; };
    const home = g.controls.target.clone(), cam0 = g.camera.position.clone();
    key('keydown', 'KeyW', { key: 'w' });
    ok('W pans the camera', moved());
    key('keyup', 'KeyW', { key: 'w' });
    ok('releasing W stops it', !moved());
    key('keydown', 'MetaLeft', { key: 'Meta', metaKey: true });
    key('keydown', 'KeyW', { key: 'w', metaKey: true });
    key('keyup', 'MetaLeft', { key: 'Meta' });   // macOS: no keyup for W
    ok('a Cmd chord does not latch a pan key', !moved());
    key('keydown', 'MetaLeft', { key: 'Meta', metaKey: true });
    window.dispatchEvent(new Event('blur'));      // Cmd+Tab away and back
    key('keydown', 'KeyS', { key: 's' });
    ok('panning works after switching away with Cmd held', moved());
    key('keyup', 'KeyS', { key: 's' });
    key('keydown', 'KeyD', { key: 'd' });
    window.dispatchEvent(new Event('blur'));
    ok('losing focus forgets held keys', !moved());
    const slider = document.querySelector('input[type=range]') ?? Object.assign(document.body.appendChild(document.createElement('input')), { type: 'range' });
    slider.focus();
    key('keydown', 'KeyW', { key: 'w' });
    ok('W pans even with a slider focused', moved());
    key('keyup', 'KeyW', { key: 'w' });
    key('keydown', 'KeyW', { key: 'w' });
    ev('pointerdown', scr(24, 0, 22)); ev('pointerup', scr(24, 0, 22));
    ok('clicking the world takes focus off the slider', document.activeElement !== slider);
    key('keyup', 'KeyW', { key: 'w' });
    g.controls.target.copy(home); g.camera.position.copy(cam0); g.controls.update(); reset();
  }
  results.push(`PERF warmed unchanged structure rebuild median=${samples[4].toFixed(1)}ms max=${samples.at(-1).toFixed(1)}ms`);
  {
    const { UI } = await import('/src/ui.ts');
    const getItem = Storage.prototype.getItem, setItem = Storage.prototype.setItem;
    Storage.prototype.getItem = Storage.prototype.setItem = () => { throw new DOMException('Blocked', 'SecurityError'); };
    try {
      const ui = new UI(a, t, { orbit() {}, zoom() {}, reset() {} }, g.sound);
      ok('UI starts when browser storage is blocked', ui.help.isConnected);
    } finally { Storage.prototype.getItem = getItem; Storage.prototype.setItem = setItem; }
  }
  return results.join('\n');
})()
