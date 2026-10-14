(async () => {
  const g = window.__grotto, t = g.tools, w = g.world, a = g.app, R = [];
  const ok = (n, c, x = '') => R.push((c ? 'PASS ' : 'FAIL ') + n + ' ' + x);
  const { jointOf } = await import('/src/walks.ts');
  // pier head (25,29) ← hub (25,24): branch off the hub heading 15° from the pier toward the head's east side
  const hub = [...w.nodes.values()].find(n => n.x === 25 && n.z === 24);
  const ne = w.edges.size, nn = w.nodes.size;
  t.setTool('walk'); t.chain = hub;
  const tgt = new (g.camera.position.constructor)(25 + Math.sin(0.55) * 6, 0.2, 24 + Math.cos(0.55) * 6);
  t['walkTo'](tgt); t.escape(); a.update(0);
  ok('acute branch joins straight on, no extra posts', w.nodes.size === nn + 1 && w.edges.size === ne + 1, `nodes +${w.nodes.size - nn}, edges +${w.edges.size - ne}`);
  ok('acute junction is a landing', jointOf(w, hub) === 'landing', jointOf(w, hub));
  // a walkway laid across rising ground rides over the high point
  const lo = a.addNode(11, 22.5, w.height(11, 22.5) + 0.2), hiX = 18.5, hiZ = 12.5;
  t.setTool('walk'); t.chain = lo; const n2 = w.nodes.size;
  t['walkTo'](new (g.camera.position.constructor)(hiX, w.height(hiX, hiZ), hiZ)); t.escape(); a.update(0);
  let clip = 0;
  for (const e of w.edges.values()) { const A = w.nodes.get(e.a), B = w.nodes.get(e.b); if (!A || !B || e.style === 'rope') continue; for (let s = 0.1; s < 0.95; s += 0.05) { const x = A.x + (B.x - A.x) * s, z = A.z + (B.z - A.z) * s; clip = Math.max(clip, w.height(x, z) - (A.y + (B.y - A.y) * s)); } }
  ok('no deck runs through the ground', clip < 0.12, clip.toFixed(2) + ` (+${w.nodes.size - n2} posts)`);
  return R.join('\n');
})()
