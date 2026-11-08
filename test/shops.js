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
  for (const [type, x, z] of [['market', 15, 8], ['boatyard', 40, 15], ['bakery', 31, 8.5]]) {
    t.buildingChoice = type; t.propSeed = 0.36; t.ghostOpts = {}; t.propRot = 0;
    const fit = t.fitAt(type, x, z), before = w.props.size;
    click(scr(x, z)); a.update(0);
    const placed = [...w.props.values()].at(-1);
    ok(`${type} placed with Buildings tool`, fit.ok && w.props.size === before + 1 && placed.type === type, fit.ok ? `${placed?.x},${placed?.z}` : fit.why);
    if (fit.ok && placed?.type === type) {
      ok(`${type} is pickable`, a.structures.userData.owners.includes(`p:${placed.id}`));
      ok(`${type} survives save/load`, (() => { const fresh = structuredClone(w.save()); return fresh.props.some(p => p.id === placed.id && p.type === type); })());
    }
  }
  const before = w.props.size;
  t.buildingChoice = 'market'; click(scr(24, 32)); a.update(0);
  ok('market rejects water', w.props.size === before);
  a.undo(); a.update(0);
  ok('undo removes latest shop', w.props.size === before - 1);
  a.redo(); a.update(0);
  ok('redo restores latest shop', w.props.size === before);
  t.setTool('prop');
  ok('Props contains grotto but no tavern or lighthouse', [...document.querySelectorAll('#panel button')].some(b => b.textContent === 'Grotto') && ![...document.querySelectorAll('#panel button')].some(b => b.textContent === 'Hull tavern' || b.textContent === 'Lighthouse'));
  return R.join('\n');
})()
