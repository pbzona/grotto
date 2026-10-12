import * as THREE from "three/webgpu";
import { pass, vec3, vec4, float, mix, dot, smoothstep, length, screenUV, Fn, clamp } from "three/tsl";
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { World, N, WATER_Y } from "./world";
import { Terrain } from "./terrain";
import { createMaterials, U } from "./materials";
import { skyAt, LightMap } from "./lighting";
import { App } from "./app";
import { Gulls, People, Fish, planSchools } from "./life";
import { seagrassCells } from "./props";
import { Villagers, CROWDS, walkGraph, type Paths } from "./villagers";
import { villagerHomes, lookoutLanterns } from "./houses";
import { Contraband } from "./contraband";
import { VillageSloop } from "./sloop";
import { Tools } from "./tools";
import { UI, injectStyles } from "./ui";
import { Ambience } from "./sound";
import { ambienceMix } from "./ambience";

async function boot() {
  injectStyles();
  const loading = document.createElement("div");
  loading.id = "loading"; loading.textContent = "Carving the cove…";
  document.body.appendChild(loading);
  const params = new URLSearchParams(location.search);
  const forceWebGL = params.has("webgl");
  const renderer = new THREE.WebGPURenderer({ antialias: true, forceWebGL });
  const maxDpr = params.has("dpr") ? +params.get("dpr")! : 1.5;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, maxDpr));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  document.body.prepend(renderer.domElement);
  await renderer.init();

  const world = new World();
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, window.innerWidth / window.innerHeight, 0.1, 900);

  const lightMap = new LightMap();
  const terrain = new Terrain(world, new THREE.MeshBasicMaterial(), new THREE.MeshBasicMaterial());
  const mats = createMaterials({ paint: terrain.paintTex, water: terrain.waterTex, light: lightMap.texture });
  terrain.mesh.material = mats.terrain; terrain.skirt.material = mats.terrain;
  scene.add(terrain.mesh, terrain.skirt);
  scene.backgroundNode = mats.background;

  // the sea: a big disc of water; finer near the cove for the swell
  const wg = new THREE.PlaneGeometry(700, 700, 140, 140);
  wg.rotateX(-Math.PI / 2); wg.translate(N / 2, WATER_Y, N / 2);
  const water = new THREE.Mesh(wg, mats.water);
  water.renderOrder = 2; water.frustumCulled = false;
  scene.add(water);

  // lights
  const sun = new THREE.DirectionalLight(0xffffff, 2.5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera as THREE.OrthographicCamera;
  sc.left = -36; sc.right = 36; sc.top = 36; sc.bottom = -36; sc.near = 1; sc.far = 160;
  sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.04; sun.shadow.radius = 3;
  const center = new THREE.Vector3(N / 2, 1, N / 2);
  sun.target.position.copy(center);
  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
  scene.add(sun, sun.target, hemi);

  // post: bloom + a gentle grade (warm highlights, teal shadows, soft vignette)
  const pipeline = new THREE.RenderPipeline(renderer);
  const scenePass = pass(scene, camera);
  const col = scenePass.getTextureNode("output");
  const bloomPass = bloom(col, 0.28, 0.35, 0.92);
  const grade = Fn(() => {
    const c = col.rgb.add(bloomPass.rgb).toVar();
    const l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c.assign(mix(vec3(l), c, float(1.14)));                      // a touch more saturation
    c.assign(c.add(vec3(0.028, 0.03, 0.034).mul(float(1).sub(smoothstep(0.0, 0.45, l)))));  // lift the shadows, keep them teal
    const shadowTint = vec3(0.9, 1.0, 1.05), highTint = vec3(1.05, 1.0, 0.93);
    c.assign(c.mul(mix(shadowTint, highTint, smoothstep(0.1, 0.8, l))));
    const d = length(screenUV.sub(0.5));
    c.assign(c.mul(mix(float(1), float(0.82), smoothstep(0.45, 0.85, d))));
    return vec4(clamp(c, 0, 50), 1);
  });
  pipeline.outputNode = grade();

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(center);
  camera.position.set(center.x + 22, 30, center.z + 44);
  controls.enableDamping = true; controls.dampingFactor = 0.08;
  // low, upward-looking shots are allowed: the camera may drop below its target (polar > 90°),
  // and a ground clamp after every update keeps it above the terrain and the sea
  controls.minDistance = 2.5; controls.maxDistance = 110;
  controls.minPolarAngle = 0.12; controls.maxPolarAngle = 1.78;
  controls.zoomToCursor = true;
  controls.mouseButtons = { LEFT: null as any, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
  controls.touches = { ONE: null as any, TWO: THREE.TOUCH.DOLLY_ROTATE };
  controls.screenSpacePanning = false;
  renderer.domElement.addEventListener("contextmenu", e => e.preventDefault());

  const sky = skyAt(16);
  const app = new App({ renderer, scene, camera, controls, world, terrain, mats, lightMap, water, pipeline });

  function applySky(hour: number) {
    skyAt(hour, sky);
    sun.color.copy(sky.sun); sun.intensity = sky.sunI;
    sun.position.copy(center).addScaledVector(sky.dir, 80);
    hemi.color.copy(sky.sky); hemi.groundColor.copy(sky.ground); hemi.intensity = sky.hemiI;
    U.night.value = sky.night; U.sunDir.value.copy(sky.dir); U.sunColor.value.copy(sky.sun);
    U.skyTop.value.copy(sky.top); U.skyHorizon.value.copy(sky.horizon);
  }

  // saved village or the starter cove
  if (params.has("fresh") || !app.restore()) app.starter();
  app.rebuildAll();

  // ---------- keyboard camera: eased 45° turns, eased zoom, reset ----------
  const HOME_POS = camera.position.clone(), HOME_TARGET = controls.target.clone();
  let orbitPending = 0, zoomPending = 0;
  let resetAnim: { t: number; fp: THREE.Vector3; ft: THREE.Vector3 } | null = null;
  const _off = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
  const cam = {
    orbit: (d: number) => { orbitPending += d * Math.PI / 4; resetAnim = null; },
    zoom: (d: number) => { zoomPending += d * 0.3; resetAnim = null; },
    reset: () => { orbitPending = zoomPending = 0; resetAnim = { t: 0, fp: camera.position.clone(), ft: controls.target.clone() }; },
  };
  function updateCamera(dt: number) {
    if (Math.abs(orbitPending) > 1e-4) {
      const s = orbitPending * Math.min(1, dt * 10);
      _off.subVectors(camera.position, controls.target).applyAxisAngle(_up, -s);
      camera.position.copy(controls.target).add(_off); orbitPending -= s;
    }
    if (Math.abs(zoomPending) > 1e-4) {
      const s = zoomPending * Math.min(1, dt * 10);
      _off.subVectors(camera.position, controls.target);
      const d = THREE.MathUtils.clamp(_off.length() * Math.exp(s), controls.minDistance, controls.maxDistance);
      camera.position.copy(controls.target).add(_off.setLength(d)); zoomPending -= s;
    }
    if (resetAnim) {
      resetAnim.t = Math.min(1, resetAnim.t + dt * 2.2);
      const e = 1 - Math.pow(1 - resetAnim.t, 3);
      controls.target.lerpVectors(resetAnim.ft, HOME_TARGET, e); camera.position.lerpVectors(resetAnim.fp, HOME_POS, e);
      if (resetAnim.t >= 1) resetAnim = null;
    }
  }
  const gulls = new Gulls();
  scene.add(gulls.group);
  const fish = new Fish();
  scene.add(fish.group);
  // villagers follow the world: resync (throttled) whenever it changes
  const villagers = new Villagers(), people = new People();
  scene.add(people.group);
  // the night trade: replanned with the villagers, posed from the hour dial
  const smuggling = new Contraband(mats.building);
  scene.add(smuggling.group);
  // the village sloop: out past the map edge by day, alongside the pier head at night
  const sloop = new VillageSloop(mats.building);
  scene.add(sloop.group);
  let seenVersion = -1, walkedVersion = -1, sinceSync = 1;
  let paths: Paths = world;
  function updateVillagers(dt: number) {
    sinceSync += dt;
    const density = CROWDS[app.settings.crowd].density;
    if (density !== villagers.density) { villagers.density = density; seenVersion = walkedVersion = -1; sinceSync = 1; }
    // people re-route straight away (cheap), so nobody walks a deleted plank;
    // the boat planners are heavier and wait for edits to settle
    if (world.version !== walkedVersion) { walkedVersion = world.version;
      paths = walkGraph(world);
      villagers.sync(paths, villagerHomes(world));
    }
    if (world.version !== seenVersion && sinceSync > 0.3) { seenVersion = world.version; sinceSync = 0;
      const homes = villagerHomes(world);
      sloop.replan(world);
      smuggling.replan(world, lookoutLanterns(world), homes, sloop.berth);
      fish.plan(planSchools(world, seagrassCells(world)));
    }
    villagers.update(paths, dt);
    people.update(villagers.people, app.time);
    smuggling.update(app.hour, app.time);
    sloop.update(app.hour, app.time);
  }
  /** Never let the camera sink into the land or the water; ease the target up with it so orbiting stays smooth. */
  const _cp = new THREE.Vector3();
  function keepAboveGround() {
    const p = camera.position;
    const inside = p.x > 0 && p.z > 0 && p.x < N && p.z < N;
    const g = inside ? world.height(p.x, p.z) : -99;
    const floor = Math.max(g, WATER_Y) + 0.35;
    if (p.y < floor) { const dy = floor - p.y; p.y = floor; _cp.copy(p); void _cp; if (controls.target.y < floor - 0.5) controls.target.y += dy * 0.5; }
  }
  // ambient sound follows what's around the camera target (mix recomputed a few times a second)
  const sound = new Ambience();
  let heard = ambienceMix(world, { x: controls.target.x, z: controls.target.z, dist: 30, night: 0 }), sinceMix = 0;
  function updateSound(dt: number) {
    sinceMix += dt;
    if (sinceMix > 0.4 && sound.enabled) {
      sinceMix = 0;
      heard = ambienceMix(world, { x: controls.target.x, z: controls.target.z, dist: camera.position.distanceTo(controls.target), night: U.night.value, people: villagers.people, sailing: sloop.moving ? 1 : 0 });
    }
    sound.update(dt, heard);
  }
  const tools = new Tools(app, renderer.domElement);
  const ui = new UI(app, tools, cam, sound);
  app.onSaveError = message => ui.toast(message);
  if (app.saveError) ui.toast(app.saveError);
  const flushSave = () => { tools.cancelDrag(); tools.endChain(); app.commit(); app.save(); };
  window.addEventListener("pagehide", flushSave);
  document.addEventListener("visibilitychange", () => { if (document.hidden) flushSave(); });
  if (params.has("clean")) document.querySelectorAll<HTMLElement>(".ui").forEach(e => (e.style.display = "none"));

  // ---------- frugal render loop: capped fps, idle throttle, pause when hidden ----------
  let last = performance.now(), acc = 0, lastInput = performance.now();
  const markInput = () => { lastInput = performance.now(); };
  for (const ev of ["pointermove", "pointerdown", "wheel", "keydown", "touchstart"]) window.addEventListener(ev, markInput, { passive: true });
  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
  (window as any).__grotto = { app, world, camera, controls, renderer, scene, applySky, tools, ui, villagers, updateVillagers, smuggling, sloop, fish, sound, ambienceMix };
  const fpsCap = () => (document.hidden ? 0 : !document.hasFocus() || performance.now() - lastInput > 6000 ? Math.min(30, app.settings.fps) : app.settings.fps);
  function frame() {
    const now = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    const cap = fpsCap();
    if (cap === 0) return;
    acc += dt;
    if (acc < 1 / cap - 0.002) return;
    const step = acc; acc = 0;
    tools.panCamera(step); updateCamera(step);
    app.update(step);
    applySky(app.hour);
    gulls.update(app.time, U.night.value);
    fish.update(app.time, U.night.value);
    updateVillagers(step);
    updateSound(step);
    controls.update();
    keepAboveGround();
    tools.frame();
    pipeline.render();
  }
  if (params.has("test")) {
    (window as any).__grotto.snap = async (hour?: number) => {
      if (hour !== undefined) app.hour = hour;
      app.update(0); applySky(app.hour); gulls.update(app.time + 3, U.night.value); updateVillagers(0); fish.update(app.time + 3, U.night.value); controls.update(); keepAboveGround(); tools.frame();
      await renderer.compileAsync(scene, camera).catch(() => {});
      pipeline.render();
      return renderer.domElement.toDataURL("image/png");
    };
  } else renderer.setAnimationLoop(frame);
  loading.remove();
}

boot().catch(err => {
  console.error(err);
  const f = document.createElement("div");
  f.id = "fallback";
  f.innerHTML = `<div><h2>The cove couldn't load</h2><p>${String(err?.message ?? err)}</p><p>Try a recent Chrome, Edge, Safari or Firefox.</p></div>`;
  document.body.appendChild(f);
});
