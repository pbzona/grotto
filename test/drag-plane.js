(() => {
  const g = window.__grotto, { app, world, tools, camera, controls, renderer } = g;
  const THREE = camera.position.constructor;
  world.clear();
  for (let z = 0; z < 48; z++) for (let x = 0; x < 48; x++) world.setLevel(x, z, z < 22 ? 10 : 5);
  const h = { id: 'drag-house', seed: 0.3, palette: 0, style: 'plaster', foundation: 'auto', shutters: false, boxes: false, awning: false,
    volumes: [{ x0: 22.5, z0: 24, x1: 25.5, z1: 27, floors: 1, roof: 'gable', ridgeX: null, pitch: 1, curve: 0.3, overhang: 0.22 }] };
  world.houses.set(h.id, h);
  app.markAll(); app.rebuildAll();
  const canvas = renderer.domElement, r = canvas.getBoundingClientRect();
  camera.aspect = r.width / r.height; camera.position.set(24, 8, 36); camera.lookAt(24, 0, 21); camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
  controls.target.set(24, 0, 21); controls.update();
  const start = new THREE(24, 0, 25.08);
  tools.setTool('select'); tools.select({ kind: 'house', id: h.id, vi: 0 });
  app.begin(true);
  tools.drag = { t: 'move', start, orig: structuredClone(h), doors: [] };
  const clientX = r.left + r.width / 2, clientY = r.top + r.height * 320 / 600;
  const target = new PointerEvent('pointermove', { clientX, clientY, pointerId: 8, bubbles: true, buttons: 1 });
  canvas.dispatchEvent(target);
  const ray = tools.ray.ray, plane = ray.at((start.y - ray.origin.y) / ray.direction.y, new THREE());
  const expectedZ = h.volumes[0].z0 + Math.round((plane.z - start.z) * 2) / 2;
  const actualZ = world.houses.get(h.id).volumes[0].z0;
  tools.cancelDrag();
  return (Math.abs(actualZ - expectedZ) < 0.26 ? 'PASS ' : 'FAIL ') + `drag follows cursor plane instead of terrain: expected ${expectedZ.toFixed(2)}, got ${actualZ.toFixed(2)}`;
})()
