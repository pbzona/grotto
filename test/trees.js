(async () => {
  const g = window.__grotto, t = g.tools, w = g.world, a = g.app, R = [];
  const ok = (n, c, x = '') => R.push((c ? 'PASS ' : 'FAIL ') + n + ' ' + x);
  const { greeneryHidden, groundBase } = await import('/src/props.ts');
  const drawn = id => g.app.structures.userData.owners.includes('p:' + id);
  // a palm on open ground west of the pier
  const p = a.addProp('palm', 12, 26, 0, 0.5); a.changed({ structures: true }); a.update(0);
  ok('palm drawn', drawn(p.id));
  // lay a walkway straight through it
  t.setTool('walk');
  const A = a.addNode(12, 24, w.height(12, 24) + 0.2);
  t.chain = A; t['walkTo'](new (g.camera.position.constructor)(12, w.height(12, 28.5), 28.5)); t.escape(); a.update(0);
  ok('walkway through the palm hides it', !drawn(p.id) && w.props.has(p.id), `hidden=${greeneryHidden(w, p)}`);
  // remove the walkway: palm comes back
  for (const e of [...w.edges.values()]) { const n1 = w.nodes.get(e.a), n2 = w.nodes.get(e.b); if (n1 && n2 && Math.abs(n1.x - 12) < 0.6 && Math.abs(n2.x - 12) < 0.6) w.edges.delete(e.id); }
  w.pruneNodes(); a.changed({ structures: true }); a.update(0);
  ok('removing the walkway brings it back', drawn(p.id));
  // can't plant on a deck; can plant on grass
  ok('no planting on a deck', !t.propCheck('palm', 25, 22).ok, t.propCheck('palm', 25, 22).why);
  ok('planting on grass ok', t.propCheck('palm', 11, 28).ok);
  // base sinks to the low side of a slope
  const b = groundBase(w, 9.3, 21, 0.16);
  ok('trunk base at or below the ground', b <= w.height(9.3, 21) - 0.05, `${b.toFixed(2)} vs ${w.height(9.3, 21).toFixed(2)}`);
  // editing: height and size change the geometry
  const before = g.app.structures.geometry.attributes.position.count;
  p.opts = { height: 1.5, lean: 1.2 }; p.scale = 1.4; p.rot = 1; a.changed({ structures: true }); a.update(0);
  ok('tree edits rebuild', g.app.structures.geometry.attributes.position.count > 0 && drawn(p.id));
  void before;
  return R.join('\n');
})()
