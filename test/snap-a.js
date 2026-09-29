(async () => { const g = window.__grotto, t = g.tools, w = g.world, c = g.renderer.domElement;
  g.camera.position.set(33, 9, 36); g.controls.target.set(27, 1, 28); g.controls.update(); g.camera.updateMatrixWorld();
  const scr = (x, y, z) => { const v = new (g.camera.position.constructor)(x, y, z).project(g.camera); const r = c.getBoundingClientRect(); return [r.left + (v.x + 1) / 2 * r.width, r.top + (1 - v.y) / 2 * r.height]; };
  const ev = (type, [x, y]) => c.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, button: 0, buttons: 1, pointerId: 5, bubbles: true }));
  t.setTool('walk');
  // start a new dock out in the water, then aim near the existing pier end (29.5, 29)
  const pe = [...w.nodes.values()].find(n => Math.abs(n.x - 29.5) < 0.01 && Math.abs(n.z - 29) < 0.01);
  const start = scr(33, 0.2, 25); ev('pointermove', start); ev('pointerdown', start); ev('pointerup', start);
  const near = scr(pe.x + 0.8, 0.2, pe.z - 0.6); ev('pointermove', near);
  const snap = t.snapWalk({ x: pe.x + 0.8, z: pe.z - 0.6 }, t.chain);
  await g.snap();
  return JSON.stringify({ snapped: t.snapped, kind: snap?.kind, same: snap?.kind === 'node' && snap.node === pe });
})()
