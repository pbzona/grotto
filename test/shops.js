(async () => {
  const g = window.__grotto, t = g.tools, w = g.world, a = g.app, R = [], c = g.renderer.domElement;
  const ok = (name, yes, note = '') => R.push(`${yes ? 'PASS' : 'FAIL'} ${name} ${note}`);
  g.camera.position.set(24, 32, 38); g.controls.target.set(24, 2, 18); g.controls.update(); g.camera.updateMatrixWorld();
  const scr = (x, z) => {
    const v = new (g.camera.position.constructor)(x, w.height(x, z), z).project(g.camera), b = c.getBoundingClientRect();
    return [b.left + (v.x + 1) * b.width / 2, b.top + (1 - v.y) * b.height / 2];
  };
  const click = ([clientX, clientY]) => {
    for (const type of ['pointermove', 'pointerdown', 'pointerup']) c.dispatchEvent(new PointerEvent(type, { clientX, clientY, button: 0, buttons: 1, pointerId: 29, bubbles: true }));
  };
  t.setTool('house');
  ok('building panel has homes, shops, and landmarks', ['Cottage', 'Market', 'Boatyard', 'Bakery', 'Hull tavern', 'Lighthouse'].every(name => [...document.querySelectorAll('#panel button')].some(b => b.textContent === name)));
  t.buildingChoice = 'market'; t.shopHeading = null; t.hover = { x: 10, z: 9 };
  const first = t.fitAt('market', 10, 9); t.rotate(); const turned = t.fitAt('market', 10, 9);
  ok('R turns a market entrance', first.ok && turned.ok && Math.abs(Math.cos(turned.rot - first.rot)) < 0.01);
  t.shopHeading = null;
  ok('market can sit on a slope near the village', t.fitAt('market', 16, 18).ok);
  ok('bakery can sit near the village', t.fitAt('bakery', 16, 18).ok);
  for (const [type, x, z] of [['market', 15, 8], ['boatyard', 14, 20], ['bakery', 31, 8.5]]) {
    t.buildingChoice = type; t.propSeed = 0.36; t.ghostOpts = {}; t.propRot = 0; t.shopHeading = null;
    const fit = t.fitAt(type, x, z), before = w.props.size;
    click(scr(x, z)); a.update(0);
    const placed = [...w.props.values()].at(-1);
    ok(`${type} placed with Buildings tool`, fit.ok && w.props.size === before + 1 && placed.type === type, fit.ok ? `${placed?.x},${placed?.z}` : fit.why);
    if (fit.ok && placed?.type === type) {
      ok(`${type} is pickable`, a.structures.userData.owners.includes(`p:${placed.id}`));
      ok(`${type} survives save/load`, (() => { const fresh = structuredClone(w.save()); return fresh.props.some(p => p.id === placed.id && p.type === type); })());
      if (type === 'boatyard') {
        const cs = Math.cos(placed.rot), sn = Math.sin(placed.rot), heights = [];
        for (const lx of [-2.236, 0, 2.236]) for (const lz of [-1.634, 0, 1.634]) heights.push(w.height(placed.x + lx * cs - lz * sn, placed.z + lx * sn + lz * cs));
        const base = Math.round((Math.max(...heights) + 0.18) * 20) / 20;
        const Vec = g.camera.position.constructor, ray = t.ray;
        ray.set(new Vec(placed.x + sn * 2.2, base + 2.7, placed.z - cs * 2.2), new Vec(-sn, 0, cs));
        const hits = ray.intersectObject(a.structures).filter(hit => a.structures.userData.owners[a.structures.userData.triOwner[hit.faceIndex]] === `p:${placed.id}`);
        ok('boatyard back gable is closed', hits.some(hit => hit.distance < 0.6), `hits=${hits.length}`);
      }
      if (type === 'bakery') {
        const cs = Math.cos(placed.rot), sn = Math.sin(placed.rot), heights = [];
        for (const lx of [-1.33, 0, 1.33, 2.25]) for (const lz of [-1.29, 0, 1.29]) heights.push(w.height(placed.x + lx * cs - lz * sn, placed.z + lx * sn + lz * cs));
        const base = Math.round((Math.max(...heights) + 0.18) * 20) / 20;
        const Vec = g.camera.position.constructor, ray = t.ray;
        ray.set(new Vec(placed.x - sn * 1.8, base + 2.5, placed.z + cs * 1.8), new Vec(sn, 0, -cs));
        const hits = ray.intersectObject(a.structures).filter(hit => a.structures.userData.owners[a.structures.userData.triOwner[hit.faceIndex]] === `p:${placed.id}`);
        ok('bakery gable closes the gap below the roof', hits.some(hit => hit.distance < 0.6), `hits=${hits.length}`);
      }
    }
  }
  const { fitLandmark } = await import('/src/landmarks.ts');
  const coast = new w.constructor(); coast.heights.fill(2);
  for (let j = 0; j < 24; j++) for (let i = 0; i < 48; i++) coast.setLevel(i, j, 8);
  ok('boatyard needs shallow water in front', !fitLandmark(coast, 'boatyard', 24, 8, 0.3, {}, false).ok);
  ok('boatyard finds a site along a beach', fitLandmark(coast, 'boatyard', 24, 21, 0.3, {}, false).ok);
  const before = w.props.size;
  t.buildingChoice = 'market'; click(scr(24, 32)); a.update(0);
  ok('market rejects water', w.props.size === before);
  a.undo(); a.update(0);
  ok('undo removes latest shop', w.props.size === before - 1);
  a.redo(); a.update(0);
  ok('redo restores latest shop', w.props.size === before);
  t.setTool('prop');
  ok('Props contains grotto but no tavern or lighthouse', [...document.querySelectorAll('#panel button')].some(b => b.textContent === 'Grotto') && ![...document.querySelectorAll('#panel button')].some(b => b.textContent === 'Hull tavern' || b.textContent === 'Lighthouse'));
  const market = [...w.props.values()].find(p => p.type === 'market');
  const x = market.x - Math.sin(market.rot) * 2.2, z = market.z + Math.cos(market.rot) * 2.2;
  t.setTool('walk');
  const door = t.walkPoint({ x, z }, null).node;
  const approach = a.addNode(x - Math.sin(market.rot) * 2, z + Math.cos(market.rot) * 2, door.y);
  const edge = a.addEdge(door, approach); a.settleWalks(new Set([door.id, approach.id])); a.changed({ structures: true }); a.update(0);
  g.updateVillagers(0.1);
  ok('walkway snaps to market threshold', Math.hypot(door.x - x, door.z - z) < 0.01);
  ok('connected market attracts visits', g.villagers.visits.has(market.id));
  w.edges.delete(edge.id); w.removeNode(door.id); w.removeNode(approach.id); a.changed({ structures: true }); g.updateVillagers(0.1);
  ok('disconnected market loses visits', !g.villagers.visits.has(market.id));
  return R.join('\n');
})()
