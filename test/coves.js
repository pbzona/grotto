(async () => {
  const g = window.__grotto, a = g.app, w = g.world, results = [];
  const ok = (name, condition) => { if (!condition) throw new Error(name); results.push('PASS ' + name); };
  const btn = label => [...document.querySelectorAll('#menu .btn')].find(b => b.textContent === label);
  const heights = () => Array.from(w.heights).join(',');
  const start = JSON.stringify(w.save());
  for (const [label, kind] of [['Fjord', 'fjord'], ['Islets', 'islets'], ['Estuary', 'estuary']]) {
    const before = heights();
    btn(label).click(); a.update(0);
    ok(`${label} replaces the land`, a.cove.kind === kind && a.cove.seed > 0 && heights() !== before && !a.edits.active);
    ok(`${label} opens with a few seed props`, w.props.size >= 4 && w.props.size <= 30 && w.houses.size === 0);
    const seed = a.cove.seed, land = heights();
    btn('Reroll this land').click(); a.update(0);
    ok(`${label} reroll keeps the preset with a new seed`, a.cove.kind === kind && a.cove.seed !== seed && heights() !== land);
    a.undo(); a.update(0);
    ok(`${label} reroll undoes in one step`, heights() === land);
    const image = await g.snap();
    ok(`${label} renders`, image.startsWith('data:image/png') && image.length > 1000);
  }
  ok('cove survives save', a.save() && JSON.parse(localStorage.getItem('grotto.cove.v1') ?? '{}').cove?.kind === a.cove.kind);
  btn('Classic cove').click(); a.update(0);
  ok('classic restores the starter village', a.cove.kind === 'classic' && a.cove.seed === 0 && w.houses.size > 5 && JSON.stringify(w.save()).length > 1000);
  while (a.undo()) {}
  ok('undo walks back to the opening cove', JSON.stringify(w.save()) === start);
  return results.join('\n');
})()
