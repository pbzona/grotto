(async () => {
  const g = window.__grotto, t = g.tools, w = g.world, a = g.app, R = [];
  const ok = (n, c, x = '') => R.push((c ? 'PASS ' : 'FAIL ') + n + ' ' + x);
  const worstClip = () => {
    let worst = 0;
    for (const e of w.edges.values()) {
      const A = w.nodes.get(e.a), B = w.nodes.get(e.b); if (!A || !B || e.style === 'rope') continue;
      const L = Math.hypot(B.x - A.x, B.z - A.z) || 1, ux = (B.x - A.x) / L, uz = (B.z - A.z) / L;
      for (let s = 0.08; s < 0.93; s += 0.04) for (const o of [-e.width / 2, 0, e.width / 2]) {
        const x = A.x + (B.x - A.x) * s - uz * o, z = A.z + (B.z - A.z) * s + ux * o;
        worst = Math.max(worst, w.height(x, z) - (A.y + (B.y - A.y) * s));
      }
    }
    return worst;
  };
  ok('starter walkways clear the ground', worstClip() < 0.06, worstClip().toFixed(2));
  // along the west cliff: a stretch across a side slope, and a flight down the face
  t.setTool('walk');
  for (const [p, q] of [[[8.5, 17], [8.5, 23]], [[14, 12.5], [15, 17.5]], [[37, 26], [39.5, 31]]]) {
    const A = a.addNode(p[0], p[1], w.height(p[0], p[1]) + 0.2);
    t.chain = A; t['walkTo'](new (g.camera.position.constructor)(q[0], w.height(q[0], q[1]), q[1])); t.escape();
  }
  a.update(0);
  ok('new walkways across slopes clear the ground', worstClip() < 0.06, worstClip().toFixed(2));
  // terrain raised under an existing pier gets settled
  const n = [...w.nodes.values()].find(n => n.x === 25 && n.z === 19.2);
  const before = w.edges.size;
  t.setTool('terrain'); t.terrainOp = 'raise'; t.brush = 1.5;
  for (let k = 0; k < 8; k++) { a.begin(); for (let j = 18; j <= 20; j++) for (let i = 23; i <= 27; i++) w.setLevel(i, j, w.level(i, j) + 1); }
  a.changed({ terrain: true }); a.update(0); a.settleWalks(); a.changed({ structures: true }); a.update(0);
  ok('raised ground under a pier: walkway follows', worstClip() < 0.06, worstClip().toFixed(2) + ` edges ${before}->${w.edges.size}`);
  void n;
  return R.join('\n');
})()
