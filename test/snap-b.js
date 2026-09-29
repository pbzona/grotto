(async () => { const g = window.__grotto, t = g.tools, w = g.world, c = g.renderer.domElement;
  const scr = (x, y, z) => { const v = new (g.camera.position.constructor)(x, y, z).project(g.camera); const r = c.getBoundingClientRect(); return [r.left + (v.x + 1) / 2 * r.width, r.top + (1 - v.y) / 2 * r.height]; };
  const ev = (type, [x, y]) => c.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, button: 0, buttons: 1, pointerId: 5, bubbles: true }));
  const pe = [...w.nodes.values()].find(n => Math.abs(n.x - 29.5) < 0.01 && Math.abs(n.z - 29) < 0.01);
  const ne = w.edges.size, deg0 = w.edgesOf(pe.id).length;
  const near = scr(pe.x + 0.8, 0.2, pe.z - 0.6); ev('pointermove', near); ev('pointerdown', near); ev('pointerup', near); t.escape(); g.app.update(0);
  return JSON.stringify({ addedEdges: w.edges.size - ne, pierEndDegree: deg0 + '->' + w.edgesOf(pe.id).length });
})()
