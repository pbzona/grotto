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
  const start = JSON.stringify(w.save());
  ok('starter walkways run at right angles', square());
  ok('starter connects several houses', villagerHomes(w).length >= 5);
  for (const [label, kind] of [['Fjord', 'fjord'], ['Islets', 'islets'], ['Estuary', 'estuary']]) {
    const before = heights();
    btn(label).click(); a.update(0);
    ok(`${label} replaces the land`, a.cove.kind === kind && a.cove.seed > 0 && heights() !== before && !a.edits.active);
    ok(`${label} opens with a small connected village`, w.houses.size >= 3 && villagerHomes(w).length === w.houses.size && w.props.size >= 4);
    ok(`${label} walkways run at right angles`, square());
    const seed = a.cove.seed, land = heights();
    btn('Reroll this land').click(); a.update(0);
    ok(`${label} reroll keeps the preset with a new seed`, a.cove.kind === kind && a.cove.seed !== seed && heights() !== land);
    a.undo(); a.update(0);
    ok(`${label} reroll undoes in one step`, heights() === land);
    const image = await g.snap();
    ok(`${label} renders`, image.startsWith('data:image/png') && image.length > 1000);
  }
  ok('cove survives save', a.save() && JSON.parse(localStorage.getItem('grotto.cove.v1') ?? '{}').cove?.kind === a.cove.kind);
  btn('Cove').click(); a.update(0);
  ok('cove restores the starter village', a.cove.kind === 'classic' && a.cove.seed === 0 && w.houses.size > 5 && JSON.stringify(w.save()).length > 1000);
  while (a.undo()) {}
  ok('undo walks back to the opening cove', JSON.stringify(w.save()) === start);
  return results.join('\n');
})()
