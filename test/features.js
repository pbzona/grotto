(async () => {
  const g = window.__grotto, a = g.app, t = g.tools, w = g.world, R = [];
  const c = g.renderer.domElement;
  const scr = (x, y, z) => { g.camera.updateMatrixWorld(); const v = new (g.camera.position.constructor)(x, y, z).project(g.camera); const r = c.getBoundingClientRect(); return [r.left + (v.x + 1) / 2 * r.width, r.top + (1 - v.y) / 2 * r.height]; };
  const ev = (type, [x, y], o = {}) => c.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, button: 0, buttons: 1, pointerId: 3, bubbles: true, ...o }));
  const drag = (p, q) => { ev('pointermove', p); ev('pointerdown', p); for (let i = 1; i <= 8; i++) ev('pointermove', [p[0] + (q[0] - p[0]) * i / 8, p[1] + (q[1] - p[1]) * i / 8]); ev('pointerup', q); };
  const ok = (n, cond, x = '') => R.push((cond ? 'PASS ' : 'FAIL ') + n + ' ' + x);
  const hs = () => t.handles.children.filter(m => m.userData.handle);
  const handle = (pred) => hs().find(m => pred(m.userData.handle));
  g.camera.position.set(24, 22, 38); g.controls.target.set(24, 1, 22); g.controls.update(); a.update(0);
  // --- terminal node drag: west end of the pier cross-walk
  const ends = [...w.nodes.values()].filter(n => w.edgesOf(n.id).length === 1 && n.x < 21 && n.z > 23 && n.z < 30);
  const pe = ends[0]; const ox = pe.x, oz = pe.z;
  drag(scr(pe.x + 0.3, pe.y, pe.z), scr(pe.x + 0.8, pe.y, pe.z - 1.7)); a.update(0);
  ok('drag pier end without preselect', Math.hypot(pe.x - ox, pe.z - oz) > 1, `${ox},${oz} -> ${pe.x},${pe.z}`);
  // --- extend arrow on a dead end
  g.camera.position.set(pe.x, 20, pe.z + 3); g.controls.target.set(pe.x, 0.5, pe.z - 1); g.controls.update(); a.update(0);
  t.select({ kind: 'node', id: pe.id }); const ext = handle(h => h.t === 'extend'); const ne = w.edges.size;
  drag(scr(ext.position.x, ext.position.y, ext.position.z), scr(pe.x - 0.5, pe.y, pe.z - 3)); a.update(0);
  ok('extend arrow adds a stretch', w.edges.size === ne + 1);
  g.camera.position.set(24, 22, 38); g.controls.target.set(24, 1, 22); g.controls.update(); a.update(0);
  // --- segment extrude on the stepped west house's hi part? use the east hip stilt house
  const h = [...w.houses.values()].find(h => h.volumes[0].x0 === 30.5);
  t.select({ kind: 'house', id: h.id, vi: 0 }); a.update(0);
  const rest = hs().map(m => m.userData.handle.t).sort().join(',');
  ok('house at rest shows six handles', rest === 'floors,move,side,side,side,side', rest);
  const far = handle(x => x.t === 'side' && x.side === 2); t.frame();
  ev('pointermove', scr(far.position.x, far.position.y, far.position.z), { buttons: 0 });
  ok('handle behind the house is not pickable', t.layer.hot !== far);
  t.revealFor(0);
  const segs = hs().filter(m => m.userData.handle.t === 'seg');
  ok('segment handles revealed on one wall', segs.length >= 2 && segs.every(m => m.userData.handle.side === 0), String(segs.length));
  const sg = segs[0]; // south wall, facing the camera
  const nv = h.volumes.length;
  drag(scr(sg.position.x, sg.position.y, sg.position.z), scr(sg.position.x, sg.position.y, sg.position.z + 1.6)); a.update(0);
  const edited = w.houses.get(h.id);
  ok('segment extruded into a wing', edited.volumes.length === nv + 1, JSON.stringify(edited.volumes.at(-1) && [edited.volumes.at(-1).x0, edited.volumes.at(-1).z0, edited.volumes.at(-1).x1, edited.volumes.at(-1).z1]));
  // --- lift part of the longhouse-like main volume
  const L = [...w.houses.values()].find(h => h.volumes[0].x0 === 19.5 && h.volumes[0].z0 === 11);
  t.select({ kind: 'house', id: L.id, vi: 0 }); a.update(0); t.revealFor('roof');
  const lifts = hs().filter(m => m.userData.handle.t === 'lift');
  ok('lift handles shown', lifts.length >= 2, String(lifts.length));
  const lf = lifts[0]; const before = L.volumes.length;
  const p0 = scr(lf.position.x, lf.position.y, lf.position.z);
  ev('pointermove', p0); ev('pointerdown', p0); for (let i = 1; i <= 6; i++) ev('pointermove', [p0[0], p0[1] - i * 10]); ev('pointerup', [p0[0], p0[1] - 60]); a.update(0);
  const lifted = w.houses.get(L.id), fl = lifted.volumes.map(v => v.floors + v.roof[0]).join(',');
  ok('lift split the volume', lifted.volumes.length > before && lifted.volumes.some(v => v.roof === 'flat'), fl);
  // terrace door exists?
  const hb = { mb: null }; 
  // --- placing: R turns the footprint, cliffs refuse
  t.setTool('house'); t.preset = 'cottage';
  const V = g.camera.position.constructor;
  const r0 = t.rectFrom(new V(24, 0, 20), new V(24, 0, 20), false); t.rotate();
  const r1 = t.rectFrom(new V(24, 0, 20), new V(24, 0, 20), false); t.rotate();
  ok('R turns the house being placed', (r0.x1 - r0.x0) === (r1.z1 - r1.z0) && (r0.z1 - r0.z0) === (r1.x1 - r1.x0), JSON.stringify([r0, r1]));
  let cliff = null;
  for (let x = 3; x < 45 && !cliff; x += 0.5) for (let z = 3; z < 45 && !cliff; z += 0.5) {
    const r = t.rectFrom(new V(x, 0, z), new V(x, 0, z), false);
    if (w.footprintFree(r.x0, r.z0, r.x1, r.z1) && t.steep(t.previewHouse(r))) cliff = new V(x, 0, z);
  }
  const nh = w.houses.size;
  if (cliff) t.commitHouse(cliff, cliff, false);
  ok('a house will not straddle a cliff', cliff && w.houses.size === nh, cliff ? `${cliff.x},${cliff.z}` : 'no cliff found');
  // --- walkways: posts clicked in a straight line fold away; deleting a mid-run post bridges the gap
  t.setTool('walk');
  let site = null;
  for (let z = 4; z < 44 && !site; z += 1) for (let x = 4; x < 36 && !site; x += 1) {
    let open = true;
    for (let k = 0; k <= 8 && open; k++) open = w.height(x + k, z) < -0.5 && !w.houseAt(x + k, z, 1);
    if (open && ![...w.nodes.values()].some(n => Math.hypot(n.x - x - 4, n.z - z) < 7)) site = [x, z];
  }
  const n0 = w.nodes.size, e0 = w.edges.size;
  if (site) {
    const [sx, sz] = site;
    a.begin(true); const r0 = t.walkPoint(new V(sx, 0, sz), null); t.chain = r0.node; w.nodes.delete(r0.node.id); t.chainTemp = r0.node;
    for (const k of [3, 6, 8]) t.walkTo(new V(sx + k, 0, sz));
    t.endChain();
  }
  ok('posts in a straight line fold into one stretch', site && w.nodes.size === n0 + 2 && w.edges.size === e0 + 1, site ? `${w.nodes.size - n0} posts ${w.edges.size - e0} stretches` : 'no open water');
  if (site) {
    const [sx, sz] = site;
    a.begin(true); const r0 = t.walkPoint(new V(sx, 0, sz + 4), null); t.chain = r0.node; w.nodes.delete(r0.node.id); t.chainTemp = r0.node;
    t.walkTo(new V(sx + 3, 0, sz + 4)); t.walkTo(new V(sx + 5, 0, sz + 6));
    t.endChain();
    const mid = [...w.nodes.values()].find(n => Math.hypot(n.x - sx - 3, n.z - sz - 4) < 0.2);
    const n1 = w.nodes.size, e1 = w.edges.size;
    t.select({ kind: 'node', id: mid.id }); t.deleteSelection();
    ok('removing a mid-run post bridges the walkway', w.nodes.size === n1 - 1 && w.edges.size === e1 - 1, `${n1 - w.nodes.size} ${e1 - w.edges.size}`);
  }
  t.setTool('select');
  return R.join('\n');
})()
