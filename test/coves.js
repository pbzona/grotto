(async () => {
  const g = window.__grotto, a = g.app, w = g.world, results = [];
  const { villagerHomes } = await import('/src/houses.ts');
  const ok = (name, condition) => { if (!condition) throw new Error(name); results.push('PASS ' + name); };
  const btn = label => [...document.querySelectorAll('#menu .btn')].find(b => b.textContent.startsWith(label));
  const heights = () => Array.from(w.heights).join(',');
  const square = () => [...w.edges.values()].every(e => {
    const p = w.nodes.get(e.a), q = w.nodes.get(e.b);
    return Math.abs(p.x - q.x) < 1e-6 || Math.abs(p.z - q.z) < 1e-6;
  });
  const { MAX_STAIR, slopeOf } = await import('/src/walks.ts');
  const { propBase } = await import('/src/props.ts');
  const { planSloop } = await import('/src/voyages.ts');
  const DECK_PROPS = ['crates', 'barrels', 'crane', 'lantern', 'nets', 'laundry'];
  const dry = () => [...w.props.values()].filter(p => DECK_PROPS.includes(p.type)).every(p => propBase(w, p) > 0.25);
  const gentle = () => [...w.edges.values()].every(e => slopeOf(w.nodes.get(e.a), w.nodes.get(e.b)) <= MAX_STAIR + 1e-6 && Math.hypot(w.nodes.get(e.a).x - w.nodes.get(e.b).x, w.nodes.get(e.a).z - w.nodes.get(e.b).z) >= 0.3);
  let sloops = 0;
  for (const kind of ['classic', 'fjord', 'islets', 'estuary']) for (let s = 1; s <= 12; s++) {
    a.newCove(kind, s);
    if (!gentle() || villagerHomes(w).length !== w.houses.size || w.houses.size < 3) throw new Error(`${kind} ${s}: steep stairs or a stranded house`);
    if (!dry()) throw new Error(`${kind} ${s}: a deck prop stands in the water`);
    if (planSloop(w)) sloops++;
  }
  ok('most villages have a berth for their sloop', sloops >= 28);
  a.starter();
  results.push('PASS every preset seed 1-12 has climbable stairs and connected houses');
  const start = JSON.stringify(w.save());
  ok('starter stairs are climbable, with no stubby steps', gentle());
  ok('starter deck props stand on decks or land', dry());
  ok('the starter pier has a berth for the village sloop', !!planSloop(w));
  ok('starter walkways run at right angles', square());
  ok('starter connects several houses', villagerHomes(w).length >= 5);
  for (const [label, kind] of [['Fjord', 'fjord'], ['Islets', 'islets'], ['Estuary', 'estuary']]) {
    const before = heights();
    btn(label).click(); a.update(0);
    ok(`${label} replaces the land`, a.cove.kind === kind && a.cove.seed > 0 && heights() !== before && !a.edits.active);
    ok(`${label} opens with a small connected village`, w.houses.size >= 2 && villagerHomes(w).length === w.houses.size && w.props.size >= 4);
    ok(`${label} walkways run at right angles`, square());
    ok(`${label} stairs are climbable, with no stubby steps`, gentle());
    const seed = a.cove.seed, land = heights();
    btn('Reroll this land').click(); a.update(0);
    ok(`${label} reroll keeps the preset with a new seed`, a.cove.kind === kind && a.cove.seed !== seed && heights() !== land);
    a.undo(); a.update(0);
    ok(`${label} reroll undoes in one step`, heights() === land);
    const image = await g.snap();
    ok(`${label} renders`, image.startsWith('data:image/png') && image.length > 1000);
  }
  ok('cove survives save', a.save() && JSON.parse(localStorage.getItem('grotto.cove.v1') ?? '{}').cove?.kind === a.cove.kind);
  const tick = () => new Promise(r => setTimeout(r, 0));
  const greenery = () => [...w.props.values()].filter(p => ['palm', 'bougainvillea', 'scrub'].includes(p.type)).length;
  const houses = w.houses.size, green = greenery(), land = heights();
  btn('Clear all buildings').click(); await tick();
  ok('clearing asks first', !!document.querySelector('#ask.on'));
  document.querySelector('#ask .no').click(); await tick();
  ok('declining keeps the buildings', !document.querySelector('#ask.on') && w.houses.size === houses);
  btn('Clear all buildings').click(); await tick();
  document.querySelector('#ask .yes').click(); await tick(); a.update(0);
  ok('confirming clears buildings and keeps land and greenery', w.houses.size === 0 && w.edges.size === 0 && w.nodes.size === 0 && greenery() === green && heights() === land);
  a.undo(); a.update(0);
  ok('clearing undoes in one step', w.houses.size === houses);
  const crowd = a.settings.crowd, count = () => g.villagers.people.filter(p => !p.gone).length;
  g.updateVillagers(1); const lively = count();
  while (a.settings.crowd !== 0) btn('Townsfolk').click();
  g.updateVillagers(1);
  ok('quiet townsfolk thins the walkways', g.villagers.density < 0.2 && count() <= lively && btn('Townsfolk').textContent === 'Townsfolk: Quiet' && localStorage.getItem('grotto.crowd') === '0');
  while (a.settings.crowd !== crowd) btn('Townsfolk').click();
  g.updateVillagers(1);
  const was = g.sound.enabled;
  btn('Sound').click();
  ok('sound toggle flips and remembers', g.sound.enabled === !was && localStorage.getItem('grotto.sound') === (was ? 'off' : 'on') && btn('Sound').textContent === `Sound: ${was ? 'off' : 'on'}`);
  btn('Sound').click();
  a.starter(); a.update(0); g.updateVillagers(1);
  for (let i = 0; i < 4; i++) g.updateVillagers(1); // let everyone step out onto the walkways
  a.begin(); for (const id of [...w.edges.keys()]) w.edges.delete(id); w.version++; a.commit(); g.updateVillagers(0.01);
  ok('people leave a deleted walkway on the same frame', g.villagers.people.length > 0 && g.villagers.people.every(p => p.phase === 'out' || p.gone));
  a.undo(); a.update(0); g.updateVillagers(1);
  const m = g.ambienceMix(w, { x: 24, z: 26, dist: 12, night: 0, people: g.villagers.people });
  ok('the starter village has surf, gulls and creaking decks', m.surf > 0.2 && m.gulls > 0.1 && m.creaks > 0.1);
  // the night trade in the starter village: signal at dusk, a boat to the pier, crates carried home
  a.starter(); a.update(0); g.updateVillagers(1);
  const sm = g.smuggling, plan = sm.plan;
  ok('starter lookouts call a boat to a connected landing', plan.signal === 'run' && plan.home && plan.landing.kind === 'pier');
  const under = [...w.edges.values()].some(e => { const p = w.nodes.get(e.a), q = w.nodes.get(e.b); const dx = q.x - p.x, dz = q.z - p.z, t = Math.max(0, Math.min(1, ((plan.landing.x - p.x) * dx + (plan.landing.z - p.z) * dz) / (dx * dx + dz * dz))); return Math.hypot(plan.landing.x - p.x - dx * t, plan.landing.z - p.z - dz * t) < e.width / 2 + 0.3; });
  ok('the smuggler berths in open water, not under a deck', !under);
  const at = h => { a.hour = h; g.updateVillagers(0); return sm.state; };
  ok('the lantern signals at dusk', at(19.5).signal > 0.5 && at(13).signal === 0);
  const mid = at(23.2);
  ok('by night the boat is in and carriers are working', mid.boat && mid.boat.vis > 0.9 && mid.carriers.length > 0);
  ok('crates wait by the door at dawn and are gone by afternoon', at(5).stack?.scales.every(s => s > 0.9) && !at(14).boat && !at(14).stack);
  // little discoveries: dark empty houses, washing lines, climbing flowers, seagrass and fish
  {
    const H = await import('/src/houses.ts'), P = await import('/src/props.ts');
    const homes = new Set(villagerHomes(w).map(h => h.house));
    const lived = [...w.houses.values()].map(h => [homes.has(h.id), H.houseLayout(w, h).lived]);
    ok('houses with no walkway stay dark', lived.some(([c]) => !c) && lived.every(([c, l]) => c === l));
    const faces = H.buildHouses(w).faces ?? [];
    ok('washing hangs between close neighbours', P.linePairs(w, faces).length >= 1);
    const climber = [...w.props.values()].find(p => p.type === 'bougainvillea' && P.climbWall(w, p));
    ok('bougainvillea climbs a wall it grows beside', !!climber);
    {
      const cw = P.climbWall(w, climber), ux = -cw.n[1], uz = cw.n[0];
      const at = (dn, dt) => P.climbWall(w, { ...climber, x: climber.x + cw.n[0] * dn + ux * dt, z: climber.z + cw.n[1] * dn + uz * dt });
      const off = at(P.CLIMB_REACH - cw.d + 0.2, 0);
      const past = at(0, cw.len - cw.t + 0.3), close = at(0.05, 0);
      ok('bougainvillea a step back from the wall does not reach for it', !off || off.d < cw.d);
      ok('bougainvillea past the end of a wall does not climb it', !past || past.n[0] !== cw.n[0] || past.n[1] !== cw.n[1] || past.len !== cw.len);
      ok('climbing stems rise straight in front of the shrub', Math.abs(close.t - cw.t) < 1e-6);
    }
    a.update(0); g.updateVillagers(1); g.fish.update(1, 0);
    ok('seagrass grows in the shallows and fish circle it', P.seagrassCells(w).length > 10 && g.fish.state.schools > 0 && g.fish.state.fish > 0);
  }
  {
    // a walkway only opens a door when it reaches the wall, and the door stays with the house as it moves
    const H = await import('/src/houses.ts');
    const home = villagerHomes(w)[0], h = w.houses.get(home.house), n = w.nodes.get(home.node);
    const door = H.doorOf(w, n);
    ok('door ends sit within reach of the wall', door && door.house === h && door.hit.d <= H.DOOR_REACH);
    const [nx, nz] = door.line.n, gap = 0.8 - door.hit.d;
    ok('a walkway stopping short of the wall is no door', !H.doorOf(w, { ...n, x: n.x + nx * gap, z: n.z + nz * gap }));
    a.begin(true);
    const orig = JSON.parse(JSON.stringify(h)), ends = g.tools.doorEnds(h);
    h.volumes = h.volumes.map(v => ({ ...v, x0: v.x0 + 0.5, x1: v.x1 + 0.5 }));
    g.tools.followDoors(h, orig, ends);
    ok('door ends follow a moved house', ends.length > 0 && ends.every(e => H.doorOf(w, w.nodes.get(e.id))?.house === h));
    a.cancel(); a.update(0);
  }
  a.begin(); a.clearBuildings(); a.commit(); g.updateVillagers(1);
  ok('no lookout, no run', sm.plan.signal === null && !at(23.2).boat);
  a.undo(); a.hour = 16.4;
  btn('Cove').click(); a.update(0);
  ok('cove restores the starter village', a.cove.kind === 'classic' && a.cove.seed === 0 && w.houses.size > 5 && JSON.stringify(w.save()).length > 1000);
  while (a.undo()) {}
  ok('undo walks back to the opening cove', JSON.stringify(w.save()) === start);
  return results.join('\n');
})()
