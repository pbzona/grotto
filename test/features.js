(async () => {
  const g = window.__grotto, a = g.app, t = g.tools, w = g.world, R = [];
  const c = g.renderer.domElement;
  const scr = (x, y, z) => { g.camera.updateMatrixWorld(); const v = new (g.camera.position.constructor)(x, y, z).project(g.camera); const r = c.getBoundingClientRect(); return [r.left + (v.x + 1) / 2 * r.width, r.top + (1 - v.y) / 2 * r.height]; };
  const ev = (type, [x, y], o = {}) => c.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, button: 0, buttons: 1, pointerId: 3, bubbles: true, ...o }));
  const drag = (p, q) => { ev('pointermove', p); ev('pointerdown', p); for (let i = 1; i <= 8; i++) ev('pointermove', [p[0] + (q[0] - p[0]) * i / 8, p[1] + (q[1] - p[1]) * i / 8]); ev('pointerup', q); };
  const ok = (n, cond, x = '') => R.push((cond ? 'PASS ' : 'FAIL ') + n + ' ' + x);
  const handle = (pred) => t.handles.children.find(m => pred(m.userData.handle));
  g.camera.position.set(24, 22, 38); g.controls.target.set(24, 1, 22); g.controls.update(); a.update(0);
  // --- terminal node drag: pier end east of the T-head
  const ends = [...w.nodes.values()].filter(n => w.edgesOf(n.id).length === 1 && n.x > 28 && n.z > 27);
  const pe = ends[0]; const ox = pe.x;
  drag(scr(pe.x - 0.3, pe.y, pe.z), scr(pe.x + 1.7, pe.y, pe.z + 0.5)); a.update(0);
  ok('drag pier end without preselect', Math.abs(pe.x - ox) > 1, `${ox} -> ${pe.x}`);
  // --- extend arrow on a dead end
  t.select({ kind: 'node', id: pe.id }); const ext = handle(h => h.t === 'extend'); const ne = w.edges.size;
  drag(scr(ext.position.x, ext.position.y, ext.position.z), scr(pe.x + 3, pe.y, pe.z + 2)); a.update(0);
  ok('extend arrow adds a stretch', w.edges.size === ne + 1);
  // --- segment extrude on the stepped west house's hi part? use the east hip stilt house
  const h = [...w.houses.values()].find(h => h.volumes[0].x0 === 30.5);
  t.select({ kind: 'house', id: h.id, vi: 0 }); a.update(0);
  const segs = t.handles.children.filter(m => m.userData.handle.t === 'seg');
  ok('segment handles shown', segs.length >= 4, String(segs.length));
  const sg = segs.find(m => m.userData.handle.side === 2); // north wall
  const nv = h.volumes.length;
  drag(scr(sg.position.x, sg.position.y, sg.position.z), scr(sg.position.x, sg.position.y, sg.position.z - 1.6)); a.update(0);
  ok('segment extruded into a wing', h.volumes.length === nv + 1, JSON.stringify(h.volumes[h.volumes.length - 1] && [h.volumes.at(-1).x0, h.volumes.at(-1).z0, h.volumes.at(-1).x1, h.volumes.at(-1).z1]));
  // --- lift part of the longhouse-like main volume
  const L = [...w.houses.values()].find(h => h.volumes[0].x0 === 19.5 && h.volumes[0].z0 === 11);
  t.select({ kind: 'house', id: L.id, vi: 0 }); a.update(0);
  const lifts = t.handles.children.filter(m => m.userData.handle.t === 'lift');
  ok('lift handles shown', lifts.length >= 2, String(lifts.length));
  const lf = lifts[0]; const before = L.volumes.length;
  const p0 = scr(lf.position.x, lf.position.y, lf.position.z);
  ev('pointermove', p0); ev('pointerdown', p0); for (let i = 1; i <= 6; i++) ev('pointermove', [p0[0], p0[1] - i * 10]); ev('pointerup', [p0[0], p0[1] - 60]); a.update(0);
  const fl = L.volumes.map(v => v.floors + v.roof[0]).join(',');
  ok('lift split the volume', L.volumes.length > before && L.volumes.some(v => v.roof === 'flat'), fl);
  // terrace door exists?
  const hb = { mb: null }; 
  return R.join('\n');
})()
