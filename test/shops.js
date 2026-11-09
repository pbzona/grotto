(async () => {
  const g = window.__grotto, t = g.tools, w = g.world, a = g.app, R = [], c = g.renderer.domElement;
  const ok = (name, yes, note = '') => R.push(`${yes ? 'PASS' : 'FAIL'} ${name} ${note}`);
  const { buildShop, marketVendor } = await import('/src/shops.ts');
  const { MeshBuilder } = await import('/src/mesh.ts');
  const { shopBase } = await import('/src/world.ts');
  const facesAt = (m, axis, plane, u, v) => {
    const side = [0, 1, 2].filter(k => k !== axis), total = [];
    for (let i = 0; i < m.idx.length; i += 3) {
      const pts = [0, 1, 2].map(j => side.map(k => m.pos[m.idx[i + j] * 3 + k]));
      if (![0, 1, 2].every(j => Math.abs(m.pos[m.idx[i + j] * 3 + axis] - plane) < 1e-5)) continue;
      const [a, b, c] = pts, det = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      if (Math.abs(det) < 1e-6) continue;
      const s = ((u - a[0]) * (c[1] - a[1]) - (v - a[1]) * (c[0] - a[0])) / det;
      const t = ((b[0] - a[0]) * (v - a[1]) - (b[1] - a[1]) * (u - a[0])) / det;
      if (s > 1e-4 && t > 1e-4 && s + t < 1 - 1e-4) total.push(i / 3);
    }
    return total;
  };
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
  let placedMarketId;
  for (const [type, x, z] of [['market', 15, 8], ['boatyard', 14, 20], ['bakery', 31, 8.5]]) {
    t.buildingChoice = type; t.propSeed = 0.36; t.ghostOpts = {}; t.propRot = 0; t.shopHeading = null;
    const fit = t.fitAt(type, x, z), before = w.props.size;
    click(scr(x, z)); a.update(0);
    const placed = [...w.props.values()].at(-1);
    ok(`${type} placed with Buildings tool`, fit.ok && w.props.size === before + 1 && placed.type === type, fit.ok ? `${placed?.x},${placed?.z}` : fit.why);
    if (fit.ok && placed?.type === type) {
      if (type === 'market') placedMarketId = placed.id;
      ok(`${type} is pickable`, a.structures.userData.owners.includes(`p:${placed.id}`));
      ok(`${type} survives save/load`, (() => { const fresh = structuredClone(w.save()); return fresh.props.some(p => p.id === placed.id && p.type === type); })());
      if (type === 'market') {
        const mesh = new MeshBuilder(); buildShop(mesh, w, placed, []);
        ok('market floor has no coplanar underside', facesAt(mesh, 1, 0, 0.19, 0.13).length === 1, `faces=${facesAt(mesh, 1, 0, 0.19, 0.13).length}`);
      }
      if (type === 'boatyard') {
        const mesh = new MeshBuilder(); buildShop(mesh, w, placed, []);
        ok('boatyard back corner has one wall face', facesAt(mesh, 2, -1.9, -2.52, 1).length === 1, `faces=${facesAt(mesh, 2, -1.9, -2.52, 1).length}`);
        ok('boatyard gable does not overlap the back wall', facesAt(mesh, 2, -1.9, 0.13, 2.2).length === 1, `faces=${facesAt(mesh, 2, -1.9, 0.13, 2.2).length}`);
        ok('boatyard side corner has one wall face', facesAt(mesh, 0, -2.6, 1, -1.83).length === 1, `faces=${facesAt(mesh, 0, -2.6, 1, -1.83).length}`);
        ok('boatyard deck has no coplanar underside', facesAt(mesh, 1, 0, 0.17, 0.13).length === 1, `faces=${facesAt(mesh, 1, 0, 0.17, 0.13).length}`);
        ok('boatyard slip does not overlap the deck', facesAt(mesh, 1, 0, 0.17, 1.86).length === 1, `faces=${facesAt(mesh, 1, 0, 0.17, 1.86).length}`);
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
        const mesh = new MeshBuilder(); buildShop(mesh, w, placed, []);
        ok('bakery base has no coplanar underside', facesAt(mesh, 1, 0.14, 0.11, 0.17).length === 1, `faces=${facesAt(mesh, 1, 0.14, 0.11, 0.17).length}`);
        ok('bakery oven does not share a wall face', facesAt(mesh, 0, 1.45, 0.8, -0.9).length === 1, `faces=${facesAt(mesh, 0, 1.45, 0.8, -0.9).length}`);
        const exposedFire = mesh.idx.some(i => mesh.mat[i] === 7 && mesh.pos[i * 3] > 2.3 && mesh.pos[i * 3 + 1] < 1.1);
        ok('bakery oven has no exterior firebox opening', !exposedFire);
        for (const lx of [-1.41, 1.41]) {
          const lz = 2.18, foot = [];
          for (let i = 0; i < mesh.pos.length; i += 3) if (Math.abs(mesh.pos[i] - lx) < 0.09 && Math.abs(mesh.pos[i + 2] - lz) < 0.09 && mesh.pos[i + 1] < 0.4) foot.push(mesh.pos[i + 1]);
          const ground = w.height(placed.x + lx * cs - lz * sn, placed.z + lx * sn + lz * cs) - shopBase(w, placed);
          ok('bakery awning post reaches the ground', foot.length > 0 && Math.min(...foot) <= ground - 0.05, `post=${Math.min(...foot).toFixed(2)} ground=${ground.toFixed(2)}`);
        }
        for (const lx of [1.55 - 0.3, 1.55 + 0.12]) {
          const lz = 1.5 + 0.48, legs = [];
          for (let i = 0; i < mesh.pos.length; i += 3) if (Math.abs(mesh.pos[i] - lx) < 0.09 && Math.abs(mesh.pos[i + 2] - lz) < 0.09 && mesh.pos[i + 1] < 0.6) legs.push(mesh.pos[i + 1]);
          const ground = w.height(placed.x + lx * cs - lz * sn, placed.z + lx * sn + lz * cs) - shopBase(w, placed);
          ok('bakery bread display is supported', legs.length > 0 && Math.min(...legs) <= ground - 0.05);
        }
      }
    }
  }
  const { fitLandmark } = await import('/src/landmarks.ts');
  const coast = new w.constructor(); coast.heights.fill(2);
  for (let j = 0; j < 24; j++) for (let i = 0; i < 48; i++) coast.setLevel(i, j, 8);
  ok('boatyard needs shallow water in front', !fitLandmark(coast, 'boatyard', 24, 8, 0.3, {}, false).ok);
  ok('boatyard finds a site along a beach', fitLandmark(coast, 'boatyard', 24, 21, 0.3, {}, false).ok);
  const sea = new w.constructor(); sea.heights.fill(2);
  ok('market fits over open water on stilts', fitLandmark(sea, 'market', 24, 24, 0.3, {}, false).ok);
  ok('bakery cannot sit on water without a dock', !fitLandmark(sea, 'bakery', 24, 21.9, 0.3, {}, false).ok);
  sea.nodes.set('dock', { id: 'dock', x: 24, z: 24, y: 0.95, pad: 0 });
  sea.nodes.set('land', { id: 'land', x: 24, z: 27, y: 0.95, pad: 0 });
  sea.edges.set('pier', { id: 'pier', a: 'dock', b: 'land', width: 1.1, style: 'deck', rail: false });
  const quay = fitLandmark(sea, 'bakery', 24, 21.9, 0.3, {}, false, 'ghost', 0);
  ok('bakery can join a fixed dock via a stone quay', quay.ok && Math.abs(shopBase(sea, { type: 'bakery', ...quay }) - 0.95) < 0.1, quay.why);
  sea.edges.get('pier').style = 'rope';
  ok('bakery requires a fixed deck, not a rope bridge', !fitLandmark(sea, 'bakery', 24, 21.9, 0.3, {}, false, 'ghost', 0).ok);
  sea.edges.get('pier').style = 'deck';
  const stalls = new w.constructor(); stalls.heights.fill(8);
  const layouts = Array.from({ length: 15 }, (_, i) => (i + 1) / 16).map(seed => { const mesh = new MeshBuilder(); buildShop(mesh, stalls, { id: 'market', type: 'market', x: 24, z: 24, rot: 0, seed }, []); return mesh.idx.length; });
  ok('market seeds produce distinct stall arrangements', new Set(layouts).size >= 3, JSON.stringify(layouts));
  ok('a market vendor can be chosen explicitly', marketVendor(0.125, 'flower') === 2 && marketVendor(0.125, 'fruit') === 1 && marketVendor(0.125, 'fish') === 0);
  const before = w.props.size;
  t.buildingChoice = 'market'; t.shopHeading = null;
  const v = new (g.camera.position.constructor)(38, 0.2, 32).project(g.camera), rect = c.getBoundingClientRect();
  click([rect.left + (v.x + 1) * rect.width / 2, rect.top + (1 - v.y) * rect.height / 2]); a.update(0);
  const waterMarket = [...w.props.values()].at(-1);
  ok('market can be placed over the cove water', w.props.size === before + 1 && waterMarket.type === 'market' && w.isWater(waterMarket.x, waterMarket.z));
  a.undo(); a.update(0);
  ok('undo removes latest shop', w.props.size === before);
  a.redo(); a.update(0);
  ok('redo restores latest shop', w.props.size === before + 1);
  t.setTool('prop');
  ok('Props contains grotto but no tavern or lighthouse', [...document.querySelectorAll('#panel button')].some(b => b.textContent === 'Grotto') && ![...document.querySelectorAll('#panel button')].some(b => b.textContent === 'Hull tavern' || b.textContent === 'Lighthouse'));
  ok('Props has placeable market decorations', ['Fruit', 'Pennant'].every(label => [...document.querySelectorAll('#panel button')].some(b => b.textContent === label)));
  for (const [type, x, z] of [['fruitGarland', 10, 8], ['pennant', 11, 9]]) {
    const beforeProps = w.props.size;
    t.propType = type; t.propSeed = 0.25; click(scr(x, z)); a.update(0);
    const placed = [...w.props.values()].at(-1);
    ok(`${type} places and renders`, w.props.size === beforeProps + 1 && placed.type === type && a.structures.userData.owners.includes(`p:${placed.id}`));
  }
  const market = w.props.get(placedMarketId);
  const x = market.x - Math.sin(market.rot) * 2.2, z = market.z + Math.cos(market.rot) * 2.2;
  t.setTool('walk');
  a.begin(true);
  const walkStart = a.ops.startWalk(t.planWalkPoint({ x, z }, null));
  if (!walkStart.ok) throw new Error(walkStart.why);
  const door = walkStart.value.node;
  const joined = a.ops.connectWalk(door.id, { kind: 'new', x: x - Math.sin(market.rot) * 2, z: z + Math.cos(market.rot) * 2, y: door.y, pad: 0 }, 'deck', 1.1, walkStart.value.pending);
  if (!joined.ok) throw new Error(joined.why);
  a.recordChange(joined.change); a.commit(); a.update(0);
  g.updateVillagers(0.1);
  ok('walkway snaps to market threshold', Math.hypot(door.x - x, door.z - z) < 0.01);
  ok('connected market attracts visits', g.villagers.visits.has(market.id));
  const edge = w.edgesOf(door.id)[0]; a.begin(); a.recordChange(a.ops.removeEdge(edge.id)); g.updateVillagers(0.1);
  ok('disconnected market loses visits', !g.villagers.visits.has(market.id));
  // Dragging a selected shop moves both the mesh and its shader highlight.
  const { U } = await import('/src/materials.ts');
  t.setTool('select'); t.select({ kind: 'prop', id: market.id });
  const old = U.highlight.value.clone(), start = { x: market.x, z: market.z };
  const target =  [[10, 9], [11, 8], [12, 9], [20, 9]].map(([x, z]) => t.fitAt('market', x, z, market.id, market.seed, market.opts)).find(f => f.ok && Math.hypot(f.x - market.x, f.z - market.z) > 1);
  if (target) {
    const Vec = g.camera.position.constructor, rect = c.getBoundingClientRect();
    const projected = new Vec(target.x, 0, target.z).project(g.camera);
    a.begin(true); t.drag = { t: 'propMove', id: market.id, start: new Vec(market.x, 0, market.z), ox: market.x, oz: market.z, changed: false };
    t.move(new PointerEvent('pointermove', { clientX: rect.left + (projected.x + 1) * rect.width / 2, clientY: rect.top + (1 - projected.y) * rect.height / 2, pointerId: 90 }));
    const now = w.props.get(market.id);
    ok('moving a selected shop moves its highlight', Math.hypot(now.x - start.x, now.z - start.z) > 0.5 && Math.abs(U.highlight.value.x - (now.x - (old.z - old.x) / 2)) < 0.1, `old=${start.x.toFixed(1)},${old.x.toFixed(1)} new=${now.x.toFixed(1)},${U.highlight.value.x.toFixed(1)} target=${target.x.toFixed(1)}`);
    t.cancelDrag();
  } else ok('moving a selected shop moves its highlight', false, 'no alternate site');
  return R.join('\n');
})()
