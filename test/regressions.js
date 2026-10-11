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
  a.importFile({ world: w.save(), hour: 3 }); ok('import restores time', a.hour === 3);

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
    // a palm leaning over the deck hides when its trunk would pass through the planks
    const P2 = a.addProp('palm', 12.9, 33, Math.PI, 0.5); P2.opts = { height: 1, lean: 1.4 };
    D1.y = D2.y = gy + 0.25;
    ok('palm beside a low deck still drawn', !greeneryHidden(w, P2));
    let pierced = false; for (let y = 0.5; y < 4 && !pierced; y += 0.1) { D1.y = D2.y = gy + y; pierced = greeneryHidden(w, P2); }
    ok('palm leaning through a raised deck is hidden', pierced);
    reset();
  }
  results.push(`PERF warmed unchanged structure rebuild median=${samples[4].toFixed(1)}ms max=${samples.at(-1).toFixed(1)}ms`);
  return results.join('\n');
})()
