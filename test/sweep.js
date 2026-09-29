(async () => {
  const g = window.__grotto, a = g.app, t = g.tools, w = g.world, R = [];
  const c = g.renderer.domElement;
  const scr = (x, y, z) => { g.camera.updateMatrixWorld(); const v = new (g.camera.position.constructor)(x, y, z).project(g.camera); const r = c.getBoundingClientRect(); return [r.left + (v.x + 1) / 2 * r.width, r.top + (1 - v.y) / 2 * r.height]; };
  const ev = (type, [x, y], o = {}) => c.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, button: 0, buttons: 1, pointerId: 3, bubbles: true, ...o }));
  const click = (p, o) => { ev('pointermove', p, o); ev('pointerdown', p, o); ev('pointerup', p, o); };
  const drag = (p, q, o) => { ev('pointerdown', p, o); for (let i = 1; i <= 6; i++) ev('pointermove', [p[0] + (q[0] - p[0]) * i / 6, p[1] + (q[1] - p[1]) * i / 6], o); ev('pointerup', q, o); };
  const key = k => window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
  const flush = () => a.update(0);
  g.camera.position.set(24, 30, 40); g.controls.target.set(24, 1, 22); g.controls.update();
  const ok = (name, cond, extra = '') => R.push((cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' ' + extra : ''));
  // terrain raise
  key('4'); ok('tool key 4', t.tool === 'terrain');
  const lv0 = w.level(12, 17); drag(scr(12.5, 3, 17.5), scr(12.6, 3, 17.6)); flush(); ok('terrain raise', w.level(12, 17) > lv0, lv0 + '->' + w.level(12, 17));
  key('Control'); window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true })); flush(); ok('undo terrain', w.level(12, 17) === lv0);
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, shiftKey: true })); flush(); ok('redo terrain', w.level(12, 17) > lv0);
  // paint
  key('5'); t.paintType = 'cobble'; const p0 = w.paint[(20 * 48 + 14) * 4 + 1]; drag(scr(14.5, 3.5, 20.5), scr(15.5, 3.5, 20.5)); ok('paint cobble', w.paint[(20 * 48 + 14) * 4 + 1] > p0);
  // props: palm on land, boat on water, boat on land refused
  key('6'); t.propType = 'palm'; let np = w.props.size; click(scr(13, 3.5, 22)); ok('place palm', w.props.size === np + 1);
  t.propType = 'rowboat'; np = w.props.size; click(scr(22, 0.2, 35)); ok('place boat on water', w.props.size === np + 1);
  np = w.props.size; click(scr(13, 3.5, 24)); ok('boat refused on land', w.props.size === np);
  t.propType = 'barrels'; np = w.props.size; click(scr(25, 0.95, 26.5)); ok('barrels on dock', w.props.size === np + 1);
  // erase
  flush(); key('7'); np = w.props.size; click(scr(22, 0.3, 35)); ok('erase boat', w.props.size === np - 1, `${np}->${w.props.size}`);
  // walkway rope bridge via tool
  key('3'); t.walkStyle = 'rope'; const ne = w.edges.size; t.nudgeLift(8); click(scr(33, 0.2, 30)); t.nudgeLift(8); click(scr(33, 0.2, 36)); key('Escape'); ok('rope edge laid', w.edges.size === ne + 1 && [...w.edges.values()].some(e => e.style === 'rope'));
  // select house + panel edit
  key('1'); const h = [...w.houses.values()][0], v = h.volumes[0];
  t.select({ kind: 'house', id: h.id, vi: 0 }); t.houseEdit('roof', 'flat'); ok('roof edit', v.roof === 'flat'); t.houseEdit('palette', 3); ok('palette edit', h.palette === 3);
  t.houseEdit('foundation', 'stilts'); ok('foundation', h.foundation === 'stilts');
  t.houseEdit('wing', 'tower'); ok('add tower wing', h.volumes.length >= 2);
  key('Delete'); ok('delete wing', w.houses.has(h.id));
  // save/restore round trip
  flush(); a.save(); const saved = JSON.parse(localStorage.getItem('grotto.cove.v1')); ok('autosave', saved.world.houses.length === w.houses.size);
  // help overlay
  key('?'); ok('help opens', g.ui.help.classList.contains('on')); key('Escape'); ok('help closes', !g.ui.help.classList.contains('on'));
  // time
  const hr = a.hour; key('.'); ok('hour step', Math.abs(((a.hour - hr + 24) % 24) - 1) < 1e-6);
  flush();
  return R.join('\n');
})()
