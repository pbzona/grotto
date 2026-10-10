(async () => {
  const g = window.__grotto, t = g.tools, w = g.world, a = g.app, R = [];
  const c = g.renderer.domElement;
  const ok = (n, cond, x = '') => R.push((cond ? 'PASS ' : 'FAIL ') + n + ' ' + x);
  g.camera.position.set(24, 30, 40); g.controls.target.set(24, 1, 22); g.controls.update(); g.camera.updateMatrixWorld();
  const scr = (x, y, z) => { const v = new (g.camera.position.constructor)(x, y, z).project(g.camera); const r = c.getBoundingClientRect(); return [r.left + (v.x + 1) / 2 * r.width, r.top + (1 - v.y) / 2 * r.height]; };
  const click = p => { for (const ty of ['pointermove', 'pointerdown', 'pointerup']) c.dispatchEvent(new PointerEvent(ty, { clientX: p[0], clientY: p[1], button: 0, buttons: 1, pointerId: 9, bubbles: true })); };
  // hull on the west beach: the solver should find a spot even from a rough click
  t.setTool('prop'); t.propType = 'hull'; t.propSeed = 0.42; t.ghostOpts = { size: 0 };
  let n = w.props.size; click(scr(16, 0, 20.5)); a.update(0);
  const hull = [...w.props.values()].at(-1);
  ok('hull placed on the beach', w.props.size === n + 1 && hull.type === 'hull', hull && `${hull.x},${hull.z}`);
  // grotto into a cliff wall: aim at the western cliff face over water
  t.propType = 'grotto'; n = w.props.size;
  const f = t.fitAt('grotto', 9.5, 38);
  click(scr(9.5, 0.2, 38)); a.update(0);
  const gr = [...w.props.values()].at(-1);
  ok('grotto sited', f.ok && w.props.size === n + 1 && gr.type === 'grotto' && gr.carved?.length > 0, f.ok ? `${gr.x},${gr.z} carved ${gr.carved?.length}` : 'no site: ' + f.why);
  // refuse a grotto in open water
  const bad = t.fitAt('grotto', 24, 30);
  ok('grotto refused in open water', !bad.ok, bad.why);
  // delete restores the cliff
  const land = [...w.props.values()].find(p => p.type === 'grotto' && p.carved?.length);
  const [ci, cj, cl] = land.carved[0];
  t.setTool('select'); t.select({ kind: 'prop', id: land.id }); t.deleteSelection(); a.update(0);
  ok('removing a grotto restores the cliff', w.level(ci, cj) === cl, `${w.level(ci, cj)} vs ${cl}`);
  a.undo(); a.update(0);
  const back = [...w.props.values()].find(p => p.id === land.id);
  ok('undo brings it back carved', !!back && w.level(ci, cj) < cl);
  // houses can't be dropped into a landmark
  ok('house blocked by hull', !w.footprintFree(hull.x - 0.5, hull.z - 0.5, hull.x + 0.5, hull.z + 0.5));
  return R.join('\n');
})()
