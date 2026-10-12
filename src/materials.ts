import * as THREE from "three/webgpu";
import {
  Fn, float, vec2, vec3, vec4, color, uniform, attribute, positionWorld, positionLocal, normalWorld, time, mix, smoothstep, sin, cos,
  fract, floor, dot, texture, clamp, max, min, abs, pow, step, length, cameraPosition, normalize, positionWorldDirection,
  mx_noise_float, mx_worley_noise_float, transformNormalToView, select, hash, exp,
} from "three/tsl";
import { N, WATER_Y } from "./world";

/** Shared uniforms driven by the day/night cycle and the tools. */
export const U = {
  night: uniform(0),
  sunDir: uniform(new THREE.Vector3(0.4, 0.8, 0.3)),
  sunColor: uniform(new THREE.Color(1, 0.9, 0.75)),
  skyTop: uniform(new THREE.Color("#5aa6d6")),
  skyHorizon: uniform(new THREE.Color("#f3d9b0")),
  brush: uniform(new THREE.Vector4(0, 0, 2, 0)), // x, z, radius, on
  brushColor: uniform(new THREE.Color("#fff1c9")),
  highlight: uniform(new THREE.Vector4(-100, -100, -100, -100)), // x0,z0,x1,z1 of a selection glow
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Node = any;

const hex = (h: string) => color(h);
const n3 = (p: Node) => mx_noise_float(p).mul(0.5).add(0.5);

/** Soft cloud shadows drifting across the cove by day. */
export const cloudShade = (p: Node): Node => {
  const n = mx_noise_float(vec3(p.x.mul(0.035).add(time.mul(0.018)), p.z.mul(0.035).add(time.mul(0.006)), time.mul(0.01))).mul(0.5).add(0.5);
  return mix(float(1), float(0.8), smoothstep(0.52, 0.72, n).mul(float(1).sub(U.night)));
};

/** Warm glow from lanterns/windows at night: a low-res light map sampled in world XZ. */
export function lightGlow(lightTex: THREE.Texture, p: Node): Node {
  return texture(lightTex, p.xz.div(N)).r;
}

export function createMaterials(tex: { paint: THREE.Texture; water: THREE.Texture; light: THREE.Texture }) {
  const warmLamp = hex("#ffb35c");

  // ---------------- terrain ----------------
  const terrain = new THREE.MeshStandardNodeMaterial({ roughness: 0.95, metalness: 0 });
  terrain.colorNode = Fn(() => {
    const p = positionWorld;
    const nrm = normalWorld;
    const slope = float(1).sub(nrm.y);
    const h = p.y;
    const puv = p.xz.div(N);
    const paint = texture(tex.paint, puv);
    const n1 = n3(p.mul(0.35)), n2 = n3(p.mul(1.6).add(7)), n4 = n3(p.mul(5.2).add(3));

    // dry cove grass: sage to straw, with darker tufts
    const grass = mix(hex("#879460"), hex("#b3a66f"), n1.mul(1.2).sub(0.1).clamp()).mul(mix(0.82, 1.08, n4)).toVar();
    // sand
    const sand = mix(hex("#e8cf9f"), hex("#dcbb85"), n2).mul(mix(0.94, 1.04, n4));
    const wetSand = hex("#b99a6e");
    // sandstone strata: bands in world height, wobbled by noise
    const band = fract(h.mul(0.9).add(n1.mul(1.4)).add(n2.mul(0.25)));
    const strataA = mix(hex("#e2ab70"), hex("#c98556"), smoothstep(0.35, 0.55, band));
    const strata = mix(strataA, hex("#edd0a0"), smoothstep(0.8, 0.9, band).mul(0.8))
      .mul(mix(0.78, 1.06, n4)).mul(mix(0.85, 1, smoothstep(0.1, 0.35, abs(band.sub(0.62)))));
    // seabed
    const seabed = mix(hex("#e3cf9e"), hex("#bfae7c"), n2);

    const col = grass.toVar();
    // beach and wet sand near the waterline on flat ground
    const beachT = smoothstep(WATER_Y + 0.75, WATER_Y + 0.45, h);
    col.assign(mix(col, sand, beachT));
    col.assign(mix(col, wetSand, smoothstep(WATER_Y + 0.22, WATER_Y + 0.02, h).mul(0.7)));
    // painted surfaces
    const cob = mx_worley_noise_float(p.xz.mul(3.2));
    const cobble = mix(hex("#8d7f6c"), hex("#cdbb9c"), smoothstep(0.08, 0.3, cob)).mul(mix(0.9, 1.05, n4));
    const path = mix(hex("#c2a276"), hex("#a98a60"), n2);
    const green = mix(hex("#6f8a45"), hex("#8fa352"), n4);
    const bloom = step(0.84, n3(p.mul(7.3))).mul(step(0.45, n2));
    const greenery = mix(green, hex("#c9577a"), bloom.mul(0.85));
    col.assign(mix(col, sand, paint.a.mul(0.9)));
    col.assign(mix(col, path, paint.r));
    col.assign(mix(col, cobble, paint.g));
    col.assign(mix(col, greenery, paint.b));
    // cliffs win on steep ground; a grassy lip on top edges
    col.assign(mix(col, strata, smoothstep(0.28, 0.5, slope)));
    // underwater seabed with caustics
    const under = smoothstep(WATER_Y + 0.02, WATER_Y - 0.12, h);
    const depth = clamp(float(WATER_Y).sub(h), 0, 4);
    const ca = mx_worley_noise_float(vec3(p.x.mul(1.3), p.z.mul(1.3), time.mul(0.35)));
    const cb = mx_worley_noise_float(vec3(p.x.mul(1.1).add(4), p.z.mul(1.1), time.mul(0.28).add(2)));
    const caust = pow(float(1).sub(min(ca, cb)), 6).mul(smoothstep(3.5, 0.2, depth)).mul(float(1).sub(U.night.mul(0.8)));
    const sub = mix(seabed, strata, smoothstep(0.35, 0.6, slope)).add(vec3(caust.mul(0.55), caust.mul(0.6), caust.mul(0.5)));
    col.assign(mix(col, sub, under));
    // brush ring
    const bd = length(p.xz.sub(U.brush.xy));
    const ring = smoothstep(0.09, 0.0, abs(bd.sub(U.brush.z))).add(smoothstep(U.brush.z, 0, bd).mul(0.12));
    col.assign(col.mul(cloudShade(p)));
    col.assign(mix(col, U.brushColor, ring.mul(U.brush.w).clamp()));
    return col;
  })();
  terrain.emissiveNode = Fn(() => {
    const g = lightGlow(tex.light, positionWorld);
    return warmLamp.mul(g.mul(g).mul(U.night).mul(0.4));
  })();

  // ---------------- water ----------------
  const water = new THREE.MeshStandardNodeMaterial({ roughness: 0.12, metalness: 0.0, transparent: true });
  water.depthWrite = false;
  const wave = (p: Node, t: Node) => sin(p.x.mul(0.9).add(t.mul(1.1))).mul(0.5)
    .add(sin(p.z.mul(1.3).sub(t.mul(0.8)).add(p.x.mul(0.4))).mul(0.35))
    .add(sin(p.x.mul(2.7).add(p.z.mul(2.1)).add(t.mul(2.2))).mul(0.15));
  water.positionNode = Fn(() => {
    const p = positionLocal;
    return vec3(p.x, p.y.add(wave(positionWorld, time).mul(0.025)), p.z);
  })();
  water.normalNode = Fn(() => {
    const p = positionWorld, t = time;
    const e = 0.08;
    const hx = wave(p.add(vec3(e, 0, 0)), t).sub(wave(p.sub(vec3(e, 0, 0)), t));
    const hz = wave(p.add(vec3(0, 0, e)), t).sub(wave(p.sub(vec3(0, 0, e)), t));
    const rip = mx_noise_float(vec3(p.x.mul(2.4), p.z.mul(2.4), t.mul(0.6))).mul(0.08);
    const ripz = mx_noise_float(vec3(p.x.mul(2.4).add(9), p.z.mul(2.4), t.mul(0.6))).mul(0.08);
    return transformNormalToView(normalize(vec3(hx.mul(-0.9).add(rip), 1, hz.mul(-0.9).add(ripz))));
  })();
  const waterSample = Fn(() => {
    const p = positionWorld;
    const uvw = p.xz.div(N);
    const inside = step(0, uvw.x).mul(step(0, uvw.y)).mul(step(uvw.x, 1)).mul(step(uvw.y, 1));
    const s = texture(tex.water, uvw.clamp(0.0005, 0.9995));
    const depth = mix(float(4), s.r.mul(4), inside);
    const foamPost = s.g.mul(inside);
    return vec4(depth, foamPost, inside, 0);
  });
  const ws = waterSample();
  const depthN = ws.x, foamPost = ws.y;
  const shoreFoam = Fn(() => {
    const p = positionWorld, t = time;
    const n = n3(vec3(p.x.mul(1.8), p.z.mul(1.8), t.mul(0.4)));
    const edge = float(0.12).add(sin(t.mul(1.4).add(p.x.mul(0.7)).add(p.z.mul(0.5))).mul(0.05)).add(n.mul(0.08));
    const line = smoothstep(edge, edge.mul(0.4), depthN).mul(smoothstep(0.0, 0.03, depthN.add(0.02)));
    const band2 = smoothstep(0.05, 0.0, abs(depthN.sub(edge.mul(2.2)))).mul(n.mul(1.4).sub(0.4).clamp()).mul(0.6);
    const post = smoothstep(0.35, 0.75, foamPost.mul(n.mul(0.8).add(0.45))).mul(0.85);
    return max(max(line, band2), post);
  });
  const foam = shoreFoam();
  const farFog = smoothstep(70, 330, length(positionWorld.xz.sub(cameraPosition.xz)));
  water.colorNode = Fn(() => {
    const shallow = hex("#6fdcc9"), mid = hex("#22a8ad"), deep = hex("#0e6378"), ocean = hex("#0b4e68");
    const c = mix(shallow, mid, smoothstep(0.0, 0.9, depthN)).toVar();
    c.assign(mix(c, deep, smoothstep(0.9, 2.6, depthN)));
    c.assign(mix(c, ocean, smoothstep(3.2, 4.0, depthN)));
    c.assign(mix(c, hex("#f6f1e2"), foam));
    return c.mul(cloudShade(positionWorld)).mul(float(1).sub(farFog));
  })();
  water.opacityNode = Fn(() => {
    const a = mix(float(0.28), float(0.93), smoothstep(0.0, 1.6, depthN)).add(smoothstep(2.6, 3.4, depthN).mul(0.07));
    return max(a, foam.mul(0.95));
  })();
  water.emissiveNode = Fn(() => {
    const view = normalize(cameraPosition.sub(positionWorld));
    const fres = pow(float(1).sub(max(view.y, 0)), 4);
    const sky = mix(U.skyHorizon, U.skyTop, 0.35);
    // lantern light smeared across the water toward the viewer
    const toCam = normalize(vec2(view.x, view.z));
    const p = positionWorld;
    const g = lightGlow(tex.light, p).add(lightGlow(tex.light, p.add(vec3(toCam.x.mul(-0.6), 0, toCam.y.mul(-0.6))))).add(lightGlow(tex.light, p.add(vec3(toCam.x.mul(-1.3), 0, toCam.y.mul(-1.3)))));
    const shimmer = n3(vec3(p.x.mul(3), p.z.mul(9), time.mul(1.2)));
    const near = sky.mul(fres.mul(0.45)).add(warmLamp.mul(g.mul(U.night).mul(shimmer).mul(0.45)));
    return mix(near, U.skyHorizon, farFog);
  })();

  // ---------------- buildings / props (one material, vertex colours + a pattern id) ----------------
  // double-sided: thin parametric parts (sails, awnings, hull shells, gable ends) must read from both sides
  const building = new THREE.MeshStandardNodeMaterial({ roughness: 0.85, metalness: 0, side: THREE.DoubleSide });
  building.shadowSide = THREE.FrontSide;
  const aCol = attribute("color", "vec3");
  const aMat = attribute("mat", "float");
  const aUv = attribute("uv", "vec2");
  const isM = (id: number) => step(abs(aMat.sub(id)), 0.5);
  building.colorNode = Fn(() => {
    const p = positionWorld;
    const base = aCol.toVar();
    const uv = aUv;
    const n4 = n3(p.mul(4.5)), n1 = n3(p.mul(0.9).add(11));
    // 1 plaster: mottled, weathered darker toward the ground
    const plaster = base.mul(mix(0.9, 1.05, n1)).mul(mix(0.93, 1.03, n4));
    // 2 planks: board lines along uv.y, each board a slightly different tone
    const bi = floor(uv.y.div(0.21));
    const bt = hash(bi.add(floor(uv.x.div(2.3)).mul(17.0)));
    const gap = smoothstep(0.0, 0.07, fract(uv.y.div(0.21))).mul(smoothstep(1.0, 0.93, fract(uv.y.div(0.21))));
    const grain = n3(vec3(uv.x.mul(0.8), uv.y.mul(14), bi));
    const plank = base.mul(mix(0.86, 1.08, bt)).mul(mix(0.68, 1, gap)).mul(mix(0.92, 1.04, grain));
    // 4 roof tiles: barrel ridges across, courses down the slope
    const ridge = sin(uv.x.mul(Math.PI * 2 / 0.24)).mul(0.5).add(0.5);
    const course = fract(uv.y.div(0.3));
    const tv = hash(floor(uv.x.div(0.24)).add(floor(uv.y.div(0.3)).mul(31.0)));
    const tile = base.mul(mix(0.72, 1.05, ridge)).mul(mix(0.7, 1, smoothstep(0.0, 0.18, course))).mul(mix(0.86, 1.1, tv)).mul(mix(0.9, 1.04, n1));
    // 5 stone: cells with mortar
    const cell = mx_worley_noise_float(vec3(uv.x.mul(3.4), uv.y.mul(4.2), 0.5));
    const stone = mix(base.mul(0.55), base.mul(mix(0.85, 1.1, n4)), smoothstep(0.05, 0.22, cell));
    // 11 sandstone rock
    const band = fract(p.y.mul(0.9).add(n1.mul(1.4)));
    const rock = mix(hex("#e2ab70"), hex("#c98556"), smoothstep(0.35, 0.55, band)).mul(mix(0.78, 1.06, n4));
    // 10 foliage
    const leaf = base.mul(mix(0.75, 1.15, n4));
    const c = base.mul(mix(0.94, 1.03, n4)).toVar();
    c.assign(mix(c, plaster, isM(1)));
    c.assign(mix(c, plank, isM(2)));
    c.assign(mix(c, tile, isM(4)));
    c.assign(mix(c, stone, isM(5)));
    c.assign(mix(c, leaf, isM(10)));
    c.assign(mix(c, rock, isM(11)));
    // glass: deep sea-blue by day
    c.assign(mix(c, mix(hex("#2b4a55"), hex("#3a2a1c"), U.night), isM(6)));
    // 12 glass of a house nobody reaches: the same by day, just dark at night
    c.assign(mix(c, mix(hex("#2b4a55"), hex("#14181b"), U.night), isM(12)));
    // weathering: bottoms of plaster/plank walls are a touch darker and greener near the water
    const damp = smoothstep(WATER_Y + 1.2, WATER_Y, p.y).mul(isM(1).add(isM(2)).clamp());
    c.assign(mix(c, c.mul(vec3(0.7, 0.75, 0.7)), damp.mul(0.6)));
    return c.mul(cloudShade(p));
  })();
  building.roughnessNode = Fn(() => mix(float(0.88), float(0.25), isM(6).add(isM(12))).sub(isM(9).mul(0.4)))();
  building.metalnessNode = Fn(() => isM(9).mul(0.5))();
  building.emissiveNode = Fn(() => {
    const p = positionWorld;
    const flick = sin(time.mul(7).add(hash(floor(p.x.mul(2)).add(floor(p.z.mul(2)).mul(13))).mul(30))).mul(0.06).add(0.94);
    const winVar = hash(floor(p.x.mul(1.3)).add(floor(p.y.mul(1.2)).mul(7.0)).add(floor(p.z.mul(1.3)).mul(19.0)));
    const win = isM(6).mul(U.night).mul(mix(0.35, 1.3, winVar)).mul(flick);
    const lamp = isM(7).mul(mix(float(0.25), float(3.2), U.night)).mul(flick);
    const g = lightGlow(tex.light, p).pow(2).mul(U.night).mul(0.05).mul(float(1).sub(isM(6)).sub(isM(12)));
    // stylised rim: a soft sky-coloured edge light on buildings by day
    const view = normalize(cameraPosition.sub(p));
    const rim = pow(float(1).sub(max(dot(normalWorld, view), 0)), 3).mul(0.16).mul(float(1).sub(U.night));
    const hl = step(U.highlight.x, p.x).mul(step(p.x, U.highlight.z)).mul(step(U.highlight.y, p.z)).mul(step(p.z, U.highlight.w));
    const pulse = sin(time.mul(3.5)).mul(0.025).add(0.06);
    return warmLamp.mul(win.add(lamp).add(g)).add(vec3(1.0, 0.9, 0.7).mul(hl.mul(pulse))).add(U.skyHorizon.mul(rim).mul(float(1).sub(isM(6)).sub(isM(12))));
  })();

  // placement ghosts: the item's own colours, softly shaded and tinted (teal = fits, coral = won't), with a rim;
  // the x-ray copies draw faintly through whatever is in front
  const ghostMat = (tint: string, xray: boolean) => {
    const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, depthTest: !xray });
    const t = hex(tint);
    m.colorNode = Fn(() => {
      const shade = max(dot(normalWorld, normalize(U.sunDir)), 0).mul(0.45).add(0.6);
      const view = normalize(cameraPosition.sub(positionWorld));
      const rim = pow(float(1).sub(max(dot(normalWorld, view), 0)), 2);
      return mix(aCol.mul(shade), t, 0.38).add(t.mul(rim.mul(0.45)));
    })();
    m.opacityNode = xray ? float(0.16) : Fn(() => sin(time.mul(3.5)).mul(0.05).add(0.62))();
    return m;
  };
  const ghost = ghostMat("#8ff0dc", false), ghostBad = ghostMat("#ff6f5a", true && false);
  const ghostX = ghostMat("#8ff0dc", true), ghostBadX = ghostMat("#ff6f5a", true);
  const footOk = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, depthTest: false });
  footOk.colorNode = hex("#8ff0dc"); footOk.opacityNode = float(0.9);
  const footBad = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, depthTest: false });
  footBad.colorNode = hex("#ff6f5a"); footBad.opacityNode = float(0.9);

  // edit handles hide behind whatever is in front of them; a held or hovered one brightens
  const handle = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
  handle.colorNode = attribute("color", "vec3");
  const handleHot = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
  handleHot.colorNode = mix(attribute("color", "vec3"), vec3(1, 1, 1), 0.3);
  const handleLine = new THREE.LineBasicNodeMaterial({ transparent: true, depthWrite: false });
  handleLine.colorNode = hex("#fff1c9"); handleLine.opacityNode = float(0.85);
  const handleWash = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
  handleWash.colorNode = hex("#8ff0dc"); handleWash.opacityNode = float(0.22);

  // ---------------- sky ----------------
  const background = Fn(() => {
    const d = normalize(positionWorldDirection);
    const up = max(d.y, 0);
    const c = mix(U.skyHorizon, U.skyTop, pow(up, 0.55)).toVar();
    const s = max(dot(d, normalize(U.sunDir)), 0);
    c.addAssign(U.sunColor.mul(pow(s, 900).mul(6).add(pow(s, 18).mul(0.25))).mul(float(1).sub(U.night)));
    // a few stars at night
    const st = step(0.9975, hash(floor(d.mul(420)).dot(vec3(1, 57, 113)))).mul(U.night).mul(up.mul(3).clamp());
    c.addAssign(vec3(st));
    return c;
  })();

  void exp; void cos; void select; void vec4;
  return { terrain, water, building, ghost, ghostBad, ghostX, ghostBadX, footOk, footBad, handle, handleHot, handleLine, handleWash, background };
}
export type Materials = ReturnType<typeof createMaterials>;
