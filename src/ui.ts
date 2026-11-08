import type { Ambience } from "./sound.ts";
import type { App } from "./app.ts";
import { Tools, ToolId, HOUSE_PRESETS } from "./tools.ts";
import { PALETTES } from "./houses.ts";
import { PROP_INFO, isGreenery } from "./props.ts";
import { MARKET_VENDORS, MARKET_KEYS, marketVendor } from "./shops.ts";
import { formatHour } from "./lighting.ts";
import { type PropType, type Prop, type CoveKind, COVES, propOpt, HULL_OPTS, GROTTO_OPTS } from "./world.ts";
import { CROWDS, CROWD_KEY } from "./villagers.ts";

// Hand-inked chart glyphs: slightly uneven strokes, drawn to sit on paper.
const ICON: Record<string, string> = {
  select: '<path d="M6 3.5l12.5 8.2-5.6 1.1-2.9 5.7z"/><path d="M12.9 12.8l4 5.4"/>',
  house: '<path d="M3.5 11.6L12 4.8l8.6 6.9"/><path d="M5.6 10.2v9.6h12.9v-9.7"/><path d="M10.2 19.8v-4.6h3.7v4.6"/><path d="M15.8 7.9V4.6h2v4.9"/>',
  walk: '<path d="M2.5 11.2h19"/><path d="M2.5 13.6h19"/><path d="M5 13.6v6.6M11.9 13.6v6.2M18.8 13.6v6.6"/><path d="M2.6 20.8c2 .9 3.6-.8 5.6 0s3.8.9 5.8 0 3.7-.8 7.4.2" stroke-width="1.2"/>',
  terrain: '<path d="M2.5 19.5l6.4-11.3 3.6 5.4 2.6-3.4 6.6 9.3z"/><path d="M6.6 15.6c1.3-.6 2.7-.4 4 .5M14.4 15.2c1-.4 1.9-.4 2.8.2" stroke-width="1.2"/>',
  paint: '<path d="M14.7 4.2l5 5-7.6 7.6-5-5z"/><path d="M7.1 11.8c-2.5.4-3.4 2.4-3.6 4.8-.1 1.6-.9 2.7-1.9 3.3 3.5.6 6.7-.2 7.9-2.8.5-1.1.6-2 .6-2.3"/>',
  prop: '<path d="M12.4 21V10.8c-.2-2.2.4-4 1.2-5.5"/><path d="M13.4 6.4c-2.5-2.2-5.8-2.4-8.6-.8 3 .3 5.3 1.1 7 3"/><path d="M13.6 6.2c2.6-1.6 5.6-1.4 7.6.6-2.8-.2-5 .4-6.7 1.8"/><path d="M13.3 6.6c-.8 2.8-2.6 4.7-5 5.8M13.8 6.6c1.8 1.7 2.6 3.8 2.4 6.2"/>',
  erase: '<path d="M5.2 5.4l13.4 13.2M18.8 5.2L5.4 18.8"/>',
  undo: '<path d="M8.8 14.6L4.2 9.8l4.8-4.6"/><path d="M4.4 9.8h9.4c3.6 0 6 2.4 6 5.4s-2.4 5.3-6 5.3h-3.2"/>',
  redo: '<path d="M15.2 14.6l4.6-4.8-4.8-4.6"/><path d="M19.6 9.8h-9.4c-3.6 0-6 2.4-6 5.4s2.4 5.3 6 5.3h3.2"/>',
  help: '<path d="M9 8.6c.3-2 1.6-3.2 3.3-3.2 2 0 3.4 1.3 3.4 3 0 2.6-3.4 2.7-3.6 5.6"/><circle cx="12.1" cy="18.4" r=".6" fill="currentColor"/>',
  menu: '<path d="M4.4 7.2c5-.4 10.1.3 15.2-.2M4.2 12.1c5.2.3 10.4-.3 15.6 0M4.5 17c5 .2 10-.3 15 .1"/>',
  play: '<path d="M7.6 5.2l11 6.8-11 6.8z"/>', pause: '<path d="M8.6 5.4v13.2M15.4 5.6v13"/>',
};
const svg = (k: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${ICON[k]}</svg>`;

const TOOLS: { id: ToolId; label: string; tab: string; key: string }[] = [
  { id: "select", label: "Select & edit", tab: "Select", key: "1" },
  { id: "house", label: "Buildings", tab: "Buildings", key: "2" },
  { id: "walk", label: "Docks & walkways", tab: "Docks", key: "3" },
  { id: "terrain", label: "Shape terrain", tab: "Land", key: "4" },
  { id: "paint", label: "Paint ground", tab: "Paint", key: "5" },
  { id: "prop", label: "Props & boats", tab: "Props", key: "6" },
  { id: "erase", label: "Remove", tab: "Remove", key: "7" },
];

/** A few words for the hour, shown under the clock. */
function partOfDay(h: number) {
  h = ((h % 24) + 24) % 24;
  return h < 5 ? "small hours" : h < 7 ? "dawn" : h < 11 ? "morning" : h < 13 ? "noon" : h < 17 ? "afternoon" : h < 19.5 ? "dusk" : "night";
}

const GRAIN = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.65' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 .35 0 0 0 0 .26 0 0 0 0 .16 0 0 0 .2 0'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)'/%3E%3C/svg%3E")`;

export function injectStyles() {
  const css = `
  :root {
    --paper: #ece0c4; --paper2: #e2d3b1; --paper3: #d6c39b; --ink: #2d2219; --dim: #6f5c45; --rule: rgba(45,34,25,.55); --hair: rgba(45,34,25,.22);
    --acc: #b4532f; --acc-ink: #f6ead0; --sea: #2f5e6c;
    --display: "IM Fell English", "Iowan Old Style", Georgia, serif; --sc: "IM Fell English SC", Georgia, serif;
    --body: "Alegreya Sans", "Gill Sans", "Trebuchet MS", sans-serif; --small: "Alegreya Sans SC", "Gill Sans", sans-serif;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; overflow: hidden; background: #0b2a36; font-family: var(--body); color: var(--ink); -webkit-user-select: none; user-select: none; }
  canvas { display: block; touch-action: none; }
  #loading, #fallback { position: fixed; inset: 0; display: grid; place-items: center; font: italic 22px var(--display); color: var(--ink); background: ${GRAIN}, radial-gradient(#f1e7cf, #d9c69f); z-index: 50; text-align: center; }
  #fallback p { max-width: 420px; color: var(--dim); font: 15px/1.5 var(--body); }
  .ui { position: fixed; z-index: 10; }
  /* a scrap of chart paper: grain, an inked neatline, a hard drop shadow */
  .card { background: ${GRAIN}, linear-gradient(170deg, #f1e6cc, var(--paper) 55%, #e6d7b6); border: 1.5px solid var(--ink); border-radius: 3px; box-shadow: 0 0 0 3px var(--paper) inset, 0 0 0 3.8px var(--hair) inset, 4px 5px 0 rgba(20,14,8,.32); }
  #brand { top: 14px; left: 16px; padding: 9px 16px 9px; }
  #brand h1 { margin: 0; font: 400 28px/1 var(--display); letter-spacing: .01em; display: flex; align-items: center; gap: 8px; }
  #brand h1 svg { width: 20px; height: 20px; color: var(--acc); }
  #brand span { display: block; margin-top: 2px; font: 14px/1.1 var(--sc); color: var(--dim); letter-spacing: .03em; }
  #toolbar { left: 16px; top: 50%; transform: translateY(-50%); padding: 7px 0; display: flex; flex-direction: column; gap: 1px; }
  .tb { position: relative; width: 44px; height: 44px; border: 0; border-radius: 2px; background: transparent; color: var(--ink); display: grid; place-items: center; cursor: pointer; padding: 0; }
  .tb svg { width: 22px; height: 22px; }
  .tb:hover { background: rgba(45,34,25,.08); }
  .tb:focus-visible, .chip:focus-visible, .btn:focus-visible, .dial:focus-visible { outline: 2px dashed var(--acc); outline-offset: 1px; }
  #toolbar .tb { width: 62px; height: 52px; grid-template-rows: 26px 14px; align-content: center; gap: 1px; transition: transform .12s, background .12s; }
  #toolbar .tb .n { font: 500 12px/1 var(--small); letter-spacing: .03em; color: var(--dim); }
  #toolbar .tb .k { position: absolute; left: 6px; top: 4px; font: 10px var(--sc); color: var(--dim); opacity: .8; }
  /* the active tool is a tab pulled out past the edge of the sheet */
  #toolbar .tb.on { background: var(--acc); color: var(--acc-ink); transform: translateX(10px); box-shadow: 3px 3px 0 rgba(20,14,8,.32); border: 1.5px solid var(--ink); }
  #toolbar .tb.on .n, #toolbar .tb.on .k { color: var(--acc-ink); }
  #panel { right: 16px; top: 68px; width: 248px; max-height: calc(100vh - 190px); overflow: auto; padding: 11px 14px 13px; }
  #panel .ph { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; margin-bottom: 8px; padding-bottom: 5px; border-bottom: 1px solid var(--rule); }
  #panel h2 { margin: 0; font: 400 20px/1.1 var(--display); }
  #panel h2 small { font: italic 13px var(--display); color: var(--dim); }
  .leg { display: flex; gap: 7px; font: 12px var(--small); color: var(--dim); }
  .leg i { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 3px; border: 1px solid var(--ink); }
  .pr { display: grid; grid-template-columns: 64px 1fr; align-items: center; gap: 6px; margin: 6px 0; }
  .pl { font: 500 12px var(--small); color: var(--dim); letter-spacing: .02em; }
  .pc { display: flex; flex-wrap: wrap; align-items: center; gap: 3px; }
  .chip { border: 1px solid var(--rule); background: rgba(255,250,235,.45); color: var(--ink); border-radius: 2px; padding: 3px 7px 4px; font: 500 13px var(--body); cursor: pointer; line-height: 1.15; }
  .chip:hover { border-color: var(--ink); background: rgba(255,250,235,.8); }
  .chip.on { background: var(--acc); color: var(--acc-ink); border-color: var(--ink); }
  .chip.ic { padding: 3px; width: 29px; height: 27px; display: grid; place-items: center; }
  .chip.ic svg { width: 18px; height: 18px; }
  .chip.sq { width: 25px; padding: 2px 0; font-size: 15px; }
  .chip.warn, .btn.warn { color: #9c2f1a; }
  .chip.warn:hover, .btn.warn:hover { background: #9c2f1a; color: var(--acc-ink); border-color: var(--ink); }
  .dot { display: block; width: 15px; height: 15px; border-radius: 50%; border: 1px solid var(--ink); }
  .val { min-width: 40px; text-align: center; font: 15px var(--display); }
  .pa { display: flex; gap: 4px; justify-content: flex-end; margin-top: 10px; padding-top: 8px; border-top: 1px dashed var(--rule); }
  .sws { display: grid; grid-template-columns: repeat(8, 1fr); gap: 3px; margin: 2px 0 8px; }
  .sws .sw { height: 20px; }
  .lbl { font: 13px var(--small); color: var(--dim); margin: 12px 0 6px; }
  .seg { display: flex; flex-wrap: wrap; gap: 4px; }
  .btn { border: 1px solid transparent; background: transparent; color: var(--ink); border-radius: 2px; padding: 5px 9px; font: 500 15px var(--body); cursor: pointer; }
  .btn:hover { border-color: var(--rule); background: rgba(255,250,235,.6); }
  .btn.on { background: var(--acc); color: var(--acc-ink); border-color: var(--ink); }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; }
  .sw { height: 26px; border-radius: 1px; border: 1px solid var(--rule); cursor: pointer; position: relative; overflow: hidden; }
  .sw.on { outline: 2px solid var(--ink); outline-offset: 1px; }
  .sw i { position: absolute; right: 0; top: 0; bottom: 0; width: 34%; }
  .row { display: flex; align-items: center; gap: 8px; margin: 6px 0; font-size: 13px; }
  .row b { width: 34px; text-align: right; font-weight: 500; color: var(--dim); }
  /* sliders: an inked rule with a terracotta bead */
  input[type=range] { -webkit-appearance: none; appearance: none; background: transparent; height: 18px; margin: 0; cursor: pointer; }
  .pc input[type=range], .row input[type=range] { width: 100%; flex: 1; }
  input[type=range]::-webkit-slider-runnable-track { height: 2px; background: var(--ink); border-radius: 1px; }
  input[type=range]::-moz-range-track { height: 2px; background: var(--ink); }
  input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; width: 13px; height: 13px; margin-top: -5.5px; border-radius: 50%; background: var(--acc); border: 1.5px solid var(--ink); }
  input[type=range]::-moz-range-thumb { width: 11px; height: 11px; border-radius: 50%; background: var(--acc); border: 1.5px solid var(--ink); }
  #top { top: 14px; right: 16px; padding: 4px 6px; display: flex; gap: 0; }
  #top .tb { width: 38px; height: 38px; }
  /* clock: an almanac dial, day above the horizon and night below */
  #time { right: 16px; bottom: 16px; padding: 8px 14px 8px 8px; display: flex; align-items: center; gap: 8px; }
  #time .tb { width: 32px; height: 32px; }
  #time .tb svg { width: 18px; height: 18px; }
  .dial { width: 74px; height: 74px; cursor: grab; touch-action: none; border-radius: 50%; }
  .dial:active { cursor: grabbing; }
  .dial svg { width: 100%; height: 100%; display: block; overflow: visible; }
  #time .t { display: flex; flex-direction: column; min-width: 86px; }
  #time .t b { font: 400 22px/1 var(--display); }
  #time .t i { font: italic 14px/1.2 var(--display); color: var(--dim); }
  /* hint: a map cartouche */
  #hint { left: 50%; bottom: 18px; transform: translateX(-50%); padding: 6px 18px 7px; font: italic 15px var(--display); color: var(--ink); max-width: min(640px, 60vw); text-align: center; border-radius: 14px / 50%; box-shadow: 0 0 0 3px var(--paper) inset, 0 0 0 3.8px var(--hair) inset, 3px 4px 0 rgba(20,14,8,.3); }
  #hint kbd { font-style: normal; }
  #hint b { font-weight: 400; }
  /* toast: a harbourmaster's stamp, pressed onto the view */
  #toast { left: 50%; top: 22px; transform: translate(-50%, 0) rotate(-2deg); padding: 6px 16px 7px; font: 17px var(--sc); letter-spacing: .03em; color: var(--acc); background: rgba(240,229,203,.94); border: 2px solid var(--acc); border-radius: 3px; box-shadow: 0 0 0 3px rgba(240,229,203,.94), 0 0 0 4.5px var(--acc), 4px 6px 0 4px rgba(20,14,8,.22); opacity: 0; pointer-events: none; transition: opacity .35s; }
  #toast.on { opacity: 1; animation: stamp .26s cubic-bezier(.2,.9,.3,1.3); }
  @keyframes stamp { 0% { opacity: 0; transform: translate(-50%, 0) rotate(-6deg) scale(1.5); } 70% { opacity: 1; transform: translate(-50%, 0) rotate(-1.5deg) scale(.97); } 100% { transform: translate(-50%, 0) rotate(-2deg) scale(1); } }
  body.noui .ui:not(#toast) { display: none !important; }
  #help { inset: 0; display: none; place-items: center; background: rgba(12,26,32,.5); z-index: 30; }
  #help.on { display: grid; }
  #ask { inset: 0; display: grid; place-items: center; background: rgba(12,26,32,.5); z-index: 40; }
  #ask .card { width: min(400px, 90vw); padding: 18px 22px 16px; transform: rotate(-.4deg); }
  #ask h2 { margin: 0 0 6px; font: 400 26px var(--display); }
  #ask p { margin: 0 0 14px; color: var(--dim); font: italic 15.5px/1.4 var(--display); }
  #ask .row { display: flex; justify-content: flex-end; gap: 8px; }
  #ask .btn { border-color: var(--rule); }
  #help .card { width: min(660px, 92vw); padding: 22px 26px; max-height: 86vh; overflow: auto; transform: rotate(-.4deg); }
  #help h2 { margin: 0 0 10px; font: 400 30px var(--display); }
  #help table { width: 100%; border-collapse: collapse; font-size: 14.5px; line-height: 1.4; }
  #help td { padding: 6px 4px; border-bottom: 1px dotted var(--rule); vertical-align: top; }
  #help td:first-child { width: 36%; font: italic 15.5px var(--display); color: var(--ink); }
  #help p { color: var(--dim); font: italic 15px var(--display); margin: 14px 0 0; }
  kbd { font: 700 12px/1 var(--body); background: rgba(255,250,235,.7); border: 1px solid var(--ink); border-bottom-width: 2px; border-radius: 2px; padding: 1px 5px 2px; color: var(--ink); }
  #menu { top: 66px; right: 16px; padding: 8px 8px 9px; display: none; flex-direction: column; gap: 0; min-width: 210px; z-index: 20; }
  #menu.on { display: flex; }
  #menu .btn { text-align: left; }
  #menu .mh { font: 400 18px var(--display); padding: 2px 8px 4px; border-bottom: 1px solid var(--rule); margin-bottom: 3px; }
  #menu .sep { height: 0; border-top: 1px dashed var(--rule); margin: 5px 4px; }
  @media (max-width: 760px) {
    #toolbar { top: auto; bottom: 12px; left: 50%; transform: translateX(-50%); flex-direction: row; padding: 0 6px; }
    #toolbar .tb { width: 46px; }
    #toolbar .tb.on { transform: translateY(-8px); }
    #toolbar .tb .k { display: none; }
    #panel { top: auto; bottom: 84px; right: 8px; left: 8px; width: auto; max-height: 38vh; }
    #hint { display: none; }
    #time { bottom: auto; top: 12px; right: 104px; padding: 3px 8px 3px 4px; }
    .dial { width: 44px; height: 44px; }
    #time .t i { display: none; }
    #time .t { min-width: 0; }
    #time .t b { font-size: 16px; }
    #brand span { display: none; }
  }`;
  const s = document.createElement("style"); s.textContent = css; document.head.appendChild(s);
}

export class UI {
  panel!: HTMLDivElement;
  hint!: HTMLDivElement;
  private toastEl!: HTMLDivElement;
  private toastT = 0;
  private toolBtns = new Map<ToolId, HTMLButtonElement>();
  private timeLbl!: HTMLElement;
  private timePart!: HTMLElement;
  private dial!: HTMLDivElement;
  private hand!: SVGGElement;
  private playBtn!: HTMLButtonElement;
  help!: HTMLDivElement;
  private menu!: HTMLDivElement;

  constructor(private app: App, private tools: Tools, private cam: { orbit: (d: number) => void; zoom: (d: number) => void; reset: () => void }, private sound?: Ambience) {
    injectStyles();
    const el = (html: string) => { const d = document.createElement("div"); d.innerHTML = html.trim(); const n = d.firstElementChild as HTMLDivElement; document.body.appendChild(n); return n; };
    el(`<div id="brand" class="ui card"><h1><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><path d="M12 1.5l2.4 8.1 8.1 2.4-8.1 2.4-2.4 8.1-2.4-8.1-8.1-2.4 8.1-2.4z"/><path d="M12 1.5v21M1.5 12h21" stroke-width=".7"/></svg>Grotto</h1><span>a cove village builder</span></div>`);
    const tb = el(`<div id="toolbar" class="ui card"></div>`);
    for (const t of TOOLS) {
      const b = document.createElement("button");
      b.className = "tb"; b.setAttribute("aria-label", t.label); b.innerHTML = `${svg(t.id)}<span class="n">${t.tab}</span><span class="k">${t.key}</span>`;
      b.onclick = () => tools.setTool(t.id);
      tb.appendChild(b); this.toolBtns.set(t.id, b);
    }
    const top = el(`<div id="top" class="ui card"></div>`);
    const tbtn = (icon: string, tip: string, fn: () => void) => { const b = document.createElement("button"); b.className = "tb"; b.title = tip; b.innerHTML = svg(icon); b.onclick = fn; top.appendChild(b); return b; };
    tbtn("undo", "Undo (Ctrl+Z)", () => this.undo());
    tbtn("redo", "Redo (Ctrl+Shift+Z)", () => this.redo());
    tbtn("help", "Controls & shortcuts (?)", () => this.toggleHelp());
    tbtn("menu", "Cove menu", () => this.menu.classList.toggle("on"));
    this.menu = el(`<div id="menu" class="ui card"></div>`);
    const mbtn = (label: string, fn: () => void) => { const b = document.createElement("button"); b.className = "btn"; b.textContent = label; b.onclick = () => { this.menu.classList.remove("on"); fn(); }; this.menu.appendChild(b); };
    const mhead = (t: string) => { const d = document.createElement("div"); d.className = "mh"; d.textContent = t; this.menu.appendChild(d); };
    const fresh = (kind: CoveKind, seed: number) => {
      app.begin(); app.newCove(kind, seed); app.markAll(); tools.select(null);
      const name = COVES.find(c => c.kind === kind)!.name;
      this.toast(`${name} · seed ${seed}`);
    };
    const newSeed = () => 1 + Math.floor(Math.random() * 99999);
    mhead("New cove");
    for (const c of COVES) { mbtn(c.name, () => fresh(c.kind, c.kind === "classic" ? 0 : newSeed())); this.menu.lastElementChild!.setAttribute("title", c.kind === "classic" ? `${c.blurb}, with the starter village` : `${c.blurb}, with a small village`); }
    mbtn("Reroll this land", () => fresh(app.cove.kind, newSeed()));
    this.menu.lastElementChild!.setAttribute("title", "Same preset, new seed. Replaces everything you've built (undo brings it back).");
    this.menu.appendChild(Object.assign(document.createElement("div"), { className: "sep" }));
    mbtn("Clear all buildings…", async () => {
      if (!await this.ask("Clear all buildings?", "Every house, walkway, boat and landmark goes. The land, paint and greenery stay. Undo brings it all back.", "Clear them")) return;
      app.begin(); app.clearBuildings(); app.markAll(); tools.select(null); this.toast("Buildings cleared");
    });
    this.menu.lastElementChild!.classList.add("warn");
    mbtn("Save to a file…", () => this.exportFile());
    mbtn("Open a file…", () => this.importFile());
    const crowdLabel = () => `Townsfolk: ${CROWDS[app.settings.crowd].name}`;
    mbtn(crowdLabel(), () => {
      app.settings.crowd = (app.settings.crowd + 1) % CROWDS.length;
      try { localStorage.setItem(CROWD_KEY, String(app.settings.crowd)); } catch { /* no storage */ }
      crowdBtn.textContent = crowdLabel(); this.toast(`${CROWDS[app.settings.crowd].name} walkways`);
    });
    const crowdBtn = this.menu.lastElementChild as HTMLElement;
    crowdBtn.setAttribute("title", "How many villagers the walkways hold, by their length");
    const soundLabel = () => `Sound: ${this.sound?.enabled ? "on" : "off"}`;
    mbtn(soundLabel(), () => {
      if (!this.sound) return;
      this.sound.enabled = !this.sound.enabled;
      soundBtn.textContent = soundLabel(); this.toast(this.sound.enabled ? "Listening to the cove" : "Sound off");
    });
    const soundBtn = this.menu.lastElementChild as HTMLElement;
    soundBtn.setAttribute("title", "Surf, wind, gulls and whatever else lives near where you're looking");
    mbtn("Toggle 30 / 60 fps cap", () => { app.settings.fps = app.settings.fps === 60 ? 30 : 60; this.toast(`Frame cap: ${app.settings.fps} fps`); });

    this.panel = el(`<div id="panel" class="ui card"></div>`);
    this.hint = el(`<div id="hint" class="ui card"></div>`);
    this.toastEl = el(`<div id="toast" class="ui card"></div>`);
    // ticks every hour, long ones at the quarters of the day
    const ticks = Array.from({ length: 24 }, (_, i) => { const a = i * Math.PI / 12, r0 = i % 6 ? 36.5 : 33, c = Math.sin(a), d = -Math.cos(a); return `M${(c * r0).toFixed(1)} ${(d * r0).toFixed(1)}L${(c * 40).toFixed(1)} ${(d * 40).toFixed(1)}`; }).join("");
    const time = el(`<div id="time" class="ui card"><button class="tb" title="Play the day (N)"></button>
      <div class="dial" role="slider" tabindex="0" aria-label="Time of day" aria-valuemin="0" aria-valuemax="24"><svg viewBox="-50 -50 100 100">
        <path d="M-44 0A44 44 0 0 0 44 0z" fill="rgba(47,94,108,.22)"/>
        <circle r="44" fill="none" stroke="var(--ink)" stroke-width="1.5"/><circle r="40" fill="none" stroke="var(--ink)" stroke-width=".6"/>
        <path d="${ticks}" stroke="var(--ink)" stroke-width="1" stroke-linecap="round"/>
        <path d="M-47 0H47" stroke="var(--ink)" stroke-width="1" stroke-dasharray="2 2"/>
        <g class="hand"><path d="M0 0V-21" stroke="var(--ink)" stroke-width="1.4"/><circle r="2.2" fill="var(--ink)"/>
          <g class="sun"><circle cy="-28" r="6" fill="var(--acc)" stroke="var(--ink)" stroke-width="1.2"/></g>
          <g class="moon"><path d="M3 -33a6 6 0 1 0 0 10a4.6 4.6 0 1 1 0-10z" fill="var(--paper)" stroke="var(--ink)" stroke-width="1.2"/></g></g>
      </svg></div><span class="t"><b></b><i></i></span></div>`);
    this.playBtn = time.querySelector("button")!; this.dial = time.querySelector(".dial")!; this.hand = time.querySelector(".hand")!;
    this.timeLbl = time.querySelector(".t b")!; this.timePart = time.querySelector(".t i")!;
    this.playBtn.onclick = () => { app.playing = !app.playing; this.refreshTime(); };
    const setFromPointer = (e: PointerEvent) => {
      const r = this.dial.getBoundingClientRect();
      const a = Math.atan2(e.clientX - (r.left + r.width / 2), -(e.clientY - (r.top + r.height / 2)));
      app.hour = Math.round(((a * 12 / Math.PI + 36) % 24) * 20) / 20; this.refreshTime();
    };
    this.dial.onpointerdown = e => { this.dial.setPointerCapture(e.pointerId); setFromPointer(e); };
    this.dial.onpointermove = e => { if (this.dial.hasPointerCapture(e.pointerId)) setFromPointer(e); };
    this.dial.onwheel = e => { e.preventDefault(); app.hour = (app.hour + Math.sign(e.deltaY) * 0.25 + 24) % 24; this.refreshTime(); };
    this.dial.onkeydown = e => {
      const d = e.key === "ArrowRight" || e.key === "ArrowUp" ? 0.25 : e.key === "ArrowLeft" || e.key === "ArrowDown" ? -0.25 : 0;
      if (d) { e.preventDefault(); e.stopPropagation(); app.hour = (app.hour + d + 24) % 24; this.refreshTime(); }
    };
    this.help = el(`<div id="help" class="ui"><div class="card"><h2>Building the cove</h2><table>
      <tr><td>Orbit · zoom · pan</td><td>Right-drag · scroll · <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> or arrows</td></tr>
      <tr><td>Low, upward shots</td><td>Right-drag down to tip the view up · scroll toward a subject · <kbd>U</kbd> hides the interface</td></tr>
      <tr><td>Turn the view · zoom · reset</td><td><kbd>Q</kbd> <kbd>E</kbd> · <kbd>+</kbd> <kbd>−</kbd> · <kbd>F</kbd></td></tr>
      <tr><td>Tools</td><td><kbd>1</kbd> select · <kbd>2</kbd> buildings · <kbd>3</kbd> docks · <kbd>4</kbd> terrain · <kbd>5</kbd> paint · <kbd>6</kbd> props · <kbd>7</kbd> remove</td></tr>
      <tr><td>Houses</td><td>Drag out a footprint (or click). Select one: pull the <b>arrows</b> to stretch, <b>Shift-drag</b> an arrow for a new wing, drag the <b>ring</b> to move, drag the <b>diamond</b> up/down for floors. Click a wall to cycle window / wall / door.</td></tr>
      <tr><td>Shops</td><td>The market stands on land or timber stilts over water. Reroll it for fish, fruit, or flower stalls. Props has hanging fruit and pennants to dress the cove. The bakery needs land or a live dock for its stone quay; the boatyard needs a gentle coast with shallow water. <kbd>R</kbd> turns a building. Connect its entrance for visitors.</td></tr>
      <tr><td>Stilts</td><td>Houses over water or on slopes stand on stilts at deck height automatically — the panel can force stilts or key a house into the slope.</td></tr>
      <tr><td>Docks & walkways</td><td>Click to lay posts, or drag a segment. Start or end on a walkway to branch, on a house wall for a door. <kbd>[</kbd> <kbd>]</kbd> raise/lower the next post — steep runs become stairs. Rope style makes sagging bridges. Double-click, right-click or <kbd>Esc</kbd> to finish.</td></tr>
      <tr><td>Edit a walkway</td><td>Drag any post — including the far end of a pier — to move it. Orange cones set its height; a dead end's cream arrow pulls out a new stretch.</td></tr>
      <tr><td>Wings & height variety</td><td>Small teal arrows along a selected house's walls pull one stretch of wall out into a wing. Orange cones on top lift one stretch a floor higher — the rest becomes a roof terrace with a door onto it (drag down to cut a terrace in instead).</td></tr>
      <tr><td>Built into the rock</td><td>Houses on steep ground perch on a sandstone outcrop automatically; pick <b>Rock outcrop</b> in the panel to force it.</td></tr>
      <tr><td>Brush size · rotate</td><td><kbd>[</kbd> <kbd>]</kbd> (or Shift+scroll) · <kbd>R</kbd></td></tr>
      <tr><td>Delete · cancel</td><td><kbd>Del</kbd> / <kbd>Backspace</kbd> · <kbd>Esc</kbd></td></tr>
      <tr><td>Undo · redo</td><td><kbd>Ctrl</kbd>+<kbd>Z</kbd> · <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd></td></tr>
      <tr><td>Time of day</td><td><kbd>N</kbd> play/pause · <kbd>,</kbd> <kbd>.</kbd> an hour back/forward</td></tr>
      </table><p>Your cove saves itself in this browser. Press <kbd>?</kbd> or <kbd>Esc</kbd> to close.</p></div></div>`);
    this.help.onclick = e => { if (e.target === this.help) this.toggleHelp(); };

    tools.onChange = () => this.refresh();
    tools.toast = m => this.toast(m);
    app.onChange = () => this.refreshSoon();
    window.addEventListener("keydown", e => this.key(e));
    this.refresh(); this.refreshTime();
    setInterval(() => this.refreshTime(), 500);
    let seenHelp = false;
    try {
      seenHelp = !!localStorage.getItem("grotto.seenHelp");
      if (!seenHelp) localStorage.setItem("grotto.seenHelp", "1");
    } catch { /* Help still works when browser storage is unavailable. */ }
    if (!seenHelp) setTimeout(() => this.toast("Press ? for controls · right-drag to look around"), 1200);
  }

  toast(msg: string) {
    this.toastEl.textContent = msg; this.toastEl.classList.remove("on"); void this.toastEl.offsetWidth; this.toastEl.classList.add("on");
    clearTimeout(this.toastT); this.toastT = window.setTimeout(() => this.toastEl.classList.remove("on"), 2600);
  }
  toggleHelp() { this.help.classList.toggle("on"); }
  private asking: ((ok: boolean) => void) | null = null;
  /** A paper dialog asking to confirm something destructive. Escape or a click outside says no. */
  ask(title: string, body: string, yes: string): Promise<boolean> {
    this.asking?.(false);
    const wrap = document.createElement("div");
    wrap.id = "ask"; wrap.className = "ui on";
    wrap.innerHTML = `<div class="card" role="alertdialog" aria-modal="true" aria-labelledby="ask-t"><h2 id="ask-t"></h2><p></p><div class="row"><button class="btn no">Keep them</button><button class="btn warn yes"></button></div></div>`;
    wrap.querySelector("h2")!.textContent = title; wrap.querySelector("p")!.textContent = body; wrap.querySelector(".yes")!.textContent = yes;
    document.body.appendChild(wrap);
    return new Promise(res => {
      const done = (ok: boolean) => { this.asking = null; wrap.remove(); res(ok); };
      this.asking = done;
      wrap.onclick = e => { if (e.target === wrap) done(false); };
      (wrap.querySelector(".no") as HTMLButtonElement).onclick = () => done(false);
      (wrap.querySelector(".yes") as HTMLButtonElement).onclick = () => done(true);
      (wrap.querySelector(".no") as HTMLButtonElement).focus();
    });
  }
  undo() { this.tools.cancelDrag(); this.tools.endChain(); if (this.app.undo()) { this.tools.select(null); this.toast("Undone"); } }
  redo() { this.tools.cancelDrag(); this.tools.endChain(); if (this.app.redo()) { this.tools.select(null); this.toast("Redone"); } }
  private refreshTimer = 0;
  private refreshSoon() { clearTimeout(this.refreshTimer); this.refreshTimer = window.setTimeout(() => this.refreshPanelValues(), 120); }
  refreshTime() {
    const h = this.app.hour;
    this.hand.setAttribute("transform", `rotate(${(h * 15 + 180).toFixed(2)})`);
    const day = h > 6 && h < 18.5;
    (this.hand.querySelector(".sun") as SVGGElement).style.display = day ? "" : "none";
    (this.hand.querySelector(".moon") as SVGGElement).style.display = day ? "none" : "";
    this.dial.setAttribute("aria-valuenow", h.toFixed(2)); this.dial.setAttribute("aria-valuetext", formatHour(h));
    this.timeLbl.textContent = formatHour(h); this.timePart.textContent = partOfDay(h);
    this.playBtn.innerHTML = svg(this.app.playing ? "pause" : "play");
  }

  private key(e: KeyboardEvent) {
    if ((e.target as HTMLElement)?.tagName === "INPUT" && (e.target as HTMLInputElement).type !== "range") return;
    if (this.asking) { if (e.key === "Escape") this.asking(false); return; }
    const k = e.key, t = this.tools, mod = e.ctrlKey || e.metaKey;
    if (mod && k.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? this.redo() : this.undo(); return; }
    if (mod && k.toLowerCase() === "y") { e.preventDefault(); this.redo(); return; }
    if (mod) return;
    const idx = "1234567".indexOf(k);
    if (idx >= 0) { t.setTool(TOOLS[idx].id); return; }
    switch (k) {
      case "v": case "V": t.setTool("select"); break;
      case "x": case "X": t.setTool("erase"); break;
      case "Escape": if (this.help.classList.contains("on")) this.toggleHelp(); else t.escape(); break;
      case "Delete": case "Backspace": e.preventDefault(); t.deleteSelection(); break;
      case "r": case "R": t.rotate(); break;
      case "[": case "]": {
        const dir = k === "]" ? 1 : -1;
        if (t.tool === "walk") t.nudgeLift(dir);
        else if (t.tool === "terrain" || t.tool === "paint") t.setBrush(t.brush + dir * 0.5);
        else if (t.sel?.kind === "house") t.houseEdit("floors", dir);
        break;
      }
      case "q": case "Q": this.cam.orbit(-1); break;
      case "e": case "E": this.cam.orbit(1); break;
      case "+": case "=": this.cam.zoom(-1); break;
      case "-": case "_": this.cam.zoom(1); break;
      case "f": case "F": case "Home": this.cam.reset(); break;
      case "n": case "N": this.app.playing = !this.app.playing; this.refreshTime(); break;
      case ",": this.app.hour = (this.app.hour + 23) % 24; this.refreshTime(); break;
      case ".": this.app.hour = (this.app.hour + 1) % 24; this.refreshTime(); break;
      case "?": case "/": this.toggleHelp(); break;
      case "h": case "H": this.toggleHelp(); break;
      case "u": case "U": { const hide = !document.body.classList.toggle("noui"); void hide; break; }
    }
  }

  private exportFile() {
    const blob = new Blob([JSON.stringify({ grotto: 1, world: this.app.world.save(), hour: this.app.hour, cove: this.app.cove })], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "my-cove.grotto.json"; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  private importFile() {
    const i = document.createElement("input"); i.type = "file"; i.accept = ".json,application/json";
    i.onchange = async () => {
      const f = i.files?.[0]; if (!f) return;
      try { if (f.size > 5_000_000) throw new Error("File too large"); const o = JSON.parse(await f.text()); this.tools.cancelDrag(); this.tools.endChain(); this.app.importFile(o); this.tools.select(null); this.refreshTime(); this.toast("Cove loaded"); }
      catch { this.toast("That file isn't a Grotto cove"); }
    };
    i.click();
  }

  // ---------- context panel ----------
  refresh() {
    for (const [id, b] of this.toolBtns) b.classList.toggle("on", id === this.tools.tool);
    this.buildPanel();
    this.hint.innerHTML = this.hintText();
  }
  private refreshPanelValues() { if (this.tools.sel && !this.app.edits.active) this.buildPanel(); }
  private hintText() {
    const t = this.tools;
    const k = (x: string) => `<kbd>${x}</kbd>`;
    switch (t.tool) {
      case "select": return t.sel?.kind === "house" ? `hover a wall to add a wing, the roof to lift · ${k("Esc")} done` : t.sel ? `${k("Del")} remove · ${k("Esc")} done` : `click to edit · right-drag to orbit · ${k("?")} help`;
      case "house": return t.placingSpecial ? t.placingType === "boatyard" ? `click near shallow shore · ${k("R")} turn · entrance on land` : t.placingType === "bakery" ? `land or beside a dock · stone quay · ${k("R")} turn` : t.placingType === "market" ? `land or water · ${k("R")} turn · connect a walkway` : `click to place · ${k("R")} turn` : `drag or click · ${k("R")} turn`;
      case "walk": return t.chain ? `click to add · ${k("[")}${k("]")} height · ${k("Esc")} finish` : `click to start · snaps to docks & walls`;
      case "terrain": case "paint": return `drag to ${t.tool === "paint" ? "paint" : t.terrainOp} · ${k("[")}${k("]")} size`;
      case "prop": return t.propType === "grotto" ? `snaps into a cliff · ${k("R")} dock side` : `click to place · ${k("R")} turn`;
      case "erase": return `click to remove · ${k("Ctrl")}${k("Z")} undo`;
    }
  }
  private buildPanel() {
    const p = this.panel, t = this.tools, app = this.app;
    p.innerHTML = "";
    const s = t.sel;
    const show = !(t.tool === "erase" || (t.tool === "select" && !s));
    p.style.display = show ? "" : "none";
    if (!show) return;
    const title = (text: string, legend?: [string, string][]) => {
      const h = document.createElement("div"); h.className = "ph";
      h.innerHTML = `<h2>${text}</h2>` + (legend ? `<div class="leg">${legend.map(([c, l]) => `<span><i style="background:${c}"></i>${l}</span>`).join("")}</div>` : "");
      p.appendChild(h);
    };
    /** one labelled row; returns the control container */
    const row = (label: string) => { const r = document.createElement("div"); r.className = "pr"; r.innerHTML = `<span class="pl">${label}</span><div class="pc"></div>`; p.appendChild(r); return r.querySelector(".pc") as HTMLDivElement; };
    const chip = (host: HTMLElement, content: string, on: boolean, fn: () => void, tip?: string, cls = "") => {
      const b = document.createElement("button"); b.className = `chip${on ? " on" : ""} ${cls}`; b.innerHTML = content; if (tip) b.title = tip; b.onclick = fn; host.appendChild(b); return b;
    };
    const seg = (host: HTMLElement, opts: [string, string, string?][], cur: string, fn: (v: string) => void) => { for (const [v, l, tip] of opts) chip(host, l, v === cur, () => fn(v), tip); };
    const slider = (host: HTMLElement, min: number, max: number, step: number, val: number, fn: (v: number) => void) => {
      const i = document.createElement("input"); i.type = "range"; i.min = String(min); i.max = String(max); i.step = String(step); i.value = String(val);
      const editing = t.tool === "select" && !!t.sel;
      i.oninput = () => { if (editing && !app.edits.active) app.begin(true); fn(+i.value); };
      i.onchange = () => { if (editing) { app.commit(); this.refresh(); } };
      i.onpointercancel = () => { if (editing) { app.cancel(); this.refresh(); } };
      i.onkeydown = e => { if (editing && e.key === "Escape") { e.stopPropagation(); app.cancel(); this.refresh(); } };
      host.appendChild(i);
    };
    const stepper = (host: HTMLElement, val: string, dec: () => void, inc: () => void) => {
      chip(host, "−", false, dec, "", "sq"); const v = document.createElement("span"); v.className = "val"; v.textContent = val; host.appendChild(v); chip(host, "+", false, inc, "", "sq");
    };
    /** variant choices for a landmark: size, cabin, roof, masts, annex / size, arch, dock */
    const variantRows = (pr: Prop, set: (k: string, v: string | number) => void) => {
      const pick = (label: string, key: string, choices: readonly (string | number)[], names: string[]) => {
        const cur = propOpt(pr, key, choices);
        seg(row(label), choices.map((c, i) => [String(c), names[i]] as [string, string]), String(cur), v => set(key, typeof choices[0] === "number" ? +v : v));
      };
      if (pr.type === "hull") {
        pick("Size", "size", HULL_OPTS.size, ["S", "M", "L"]);
        pick("Cabin", "cabin", HULL_OPTS.cabin, ["Low", "Tall", "Stern"]);
        pick("Roof", "roof", HULL_OPTS.roof, ["Gable", "Hip", "Awning"]);
        pick("Masts", "masts", HULL_OPTS.masts, ["0", "1", "2"]);
        pick("Annex", "annex", HULL_OPTS.annex, ["None", "Deck", "Shack"]);
      } else if (pr.type === "grotto") {
        pick("Size", "size", GROTTO_OPTS.size, ["S", "M", "L"]);
        pick("Arch", "arch", GROTTO_OPTS.arch, ["Round", "Tall", "Wide"]);
        pick("Dock", "dock", GROTTO_OPTS.dock, ["Left", "Right", "Both"]);
      } else if (pr.type === "market") {
        const current = MARKET_KEYS[marketVendor(pr.seed, pr.opts?.vendor as string | undefined)];
        seg(row("Vendor"), MARKET_KEYS.map((key, i) => [key, MARKET_VENDORS[i]]), current, key => set("vendor", key));
      }
    };
    const actions = (items: [string, () => void, string?][]) => { const d = document.createElement("div"); d.className = "pa"; for (const [l, fn, cls] of items) chip(d, l, false, fn, "", cls ?? ""); p.appendChild(d); };
    const I = (d: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
    const ROOF: Record<string, string> = {
      gable: I('<path d="M3 17L12 6l9 11z"/>'), hip: I('<path d="M3 17l5-9h8l5 9z"/>'),
      flat: I('<path d="M3 12h18v5H3z"/><path d="M3 10h18"/>'), shed: I('<path d="M3 17V9l18 4v4z"/>'),
    };
    const FOUND: Record<string, string> = {
      auto: I('<path d="M5 19l7-14 7 14M8 14h8"/>'), stilts: I('<path d="M4 8h16M6 8v11M12 8v11M18 8v11"/>'),
      rock: I('<path d="M3 19c1-5 3-9 7-10s5 2 8 3 3 5 3 7z"/>'), keyed: I('<path d="M4 10h16v9H4z"/><path d="M4 14h16M9 10v4M15 14v5"/>'),
    };
    if (t.tool === "select" && s) {
      if (s.kind === "house") {
        const h = app.world.houses.get(s.id); if (!h) return;
        const v = h.volumes[s.vi] ?? h.volumes[0];
        const kind = v.kind ?? "room";
        title((kind === "lookout" ? "Lookout" : kind === "tower" ? "Tower" : "House") + (h.volumes.length > 1 ? ` <small>${s.vi + 1}/${h.volumes.length}</small>` : ""),
          [["#fff1c9", "stretch"], ["#8fd3f0", "move"], ["#e6a676", "floors"]]);
        const g = document.createElement("div"); g.className = "sws";
        PALETTES.forEach((pal, i) => {
          const d = document.createElement("div"); d.className = "sw" + (h.palette === i ? " on" : ""); d.title = pal.name;
          d.style.background = pal.wall; d.innerHTML = `<i style="background:${pal.trim}"></i>`;
          d.onclick = () => t.houseEdit("palette", i); g.appendChild(d);
        });
        p.appendChild(g);
        seg(row("Walls"), [["plaster", "Plaster"], ["plank", "Plank"], ["stone", "Stone"]], h.style, v2 => t.houseEdit("style", v2));
        if (kind !== "lookout") {
          const r = row("Roof");
          for (const k of ["gable", "hip", "flat", "shed"]) chip(r, ROOF[k], v.roof === k, () => t.houseEdit("roof", k), { gable: "Gable", hip: "Hip", flat: "Flat terrace", shed: "Lean-to" }[k], "ic");
          chip(r, I('<path d="M4 12a8 8 0 0 1 14-5l2 2M20 12a8 8 0 0 1-14 5l-2-2"/><path d="M20 4v5h-5M4 20v-5h5"/>'), false, () => t.houseEdit("ridge"), "Turn ridge", "ic");
          if (v.roof !== "flat") {
            slider(row("Pitch"), 0.5, 1.6, 0.05, v.pitch, x => t.houseEdit("pitch", x));
            slider(row("Curve"), -1, 1, 0.05, v.curve, x => t.houseEdit("curve", x));
            slider(row("Eaves"), 0.05, 0.45, 0.01, v.overhang, x => t.houseEdit("overhang", x));
          }
        }
        stepper(row("Floors"), String(v.floors), () => t.houseEdit("floors", -1), () => t.houseEdit("floors", 1));
        const fr = row("Base");
        for (const k of ["auto", "stilts", "rock", "keyed"]) chip(fr, FOUND[k], h.foundation === k, () => t.houseEdit("foundation", k), { auto: "Auto", stilts: "Stilts", rock: "Rock outcrop", keyed: "Stone plinth" }[k], "ic");
        const dr = row("Details");
        chip(dr, I('<path d="M5 4h5v16H5zM14 4h5v16h-5z"/><path d="M5 9h5M14 9h5M5 14h5M14 14h5"/>'), h.shutters, () => t.houseEdit("toggle", "shutters"), "Shutters", "ic");
        chip(dr, I('<path d="M4 14h16l-2 6H6z"/><circle cx="8" cy="10" r="2"/><circle cx="16" cy="10" r="2"/><circle cx="12" cy="8" r="2"/>'), h.boxes, () => t.houseEdit("toggle", "boxes"), "Flower boxes", "ic");
        chip(dr, I('<path d="M3 8h18l-2 5H5z"/><path d="M5 13v7M19 13v7"/>'), h.awning, () => t.houseEdit("toggle", "awning"), "Awnings", "ic");
        chip(dr, I('<path d="M4 4h16v16H4z"/><circle cx="9" cy="9" r="1.2"/><circle cx="15" cy="15" r="1.2"/><circle cx="15" cy="9" r="1.2"/><circle cx="9" cy="15" r="1.2"/>'), false, () => t.houseEdit("reroll"), "Reroll details", "ic");
        seg(row("+ Wing"), [["room", "Room"], ["shed", "Lean-to"], ["tower", "Tower"], ["lookout", "Lookout"]], "", v2 => t.houseEdit("wing", v2));
        actions([[h.volumes.length > 1 && s.vi > 0 ? "Remove part" : "Remove", () => t.deleteSelection(), "warn"]]);
      } else if (s.kind === "node") {
        const n = app.world.nodes.get(s.id); if (!n) return;
        title("Post", [["#8fd3f0", "move"], ["#e6a676", "height"], ["#fff1c9", "extend"]]);
        stepper(row("Height"), n.y.toFixed(2), () => this.nodeEdit(s.id, "y", -0.25), () => this.nodeEdit(s.id, "y", 0.25));
        seg(row("Landing"), [["0", "None"], ["1", "S"], ["1.5", "L"]], String(n.pad), v2 => this.nodeEdit(s.id, "pad", +v2));
        actions([["Remove", () => t.deleteSelection(), "warn"]]);
      } else if (s.kind === "edge") {
        const e = app.world.edges.get(s.id); if (!e) return;
        title("Walkway", [["#8fd3f0", "move ends"]]);
        seg(row("Style"), [["deck", "Deck"], ["rope", "Rope"]], e.style, v2 => this.edgeEdit(s.id, "style", v2));
        slider(row("Width"), 0.7, 2, 0.1, e.width, x => this.edgeEdit(s.id, "width", x));
        chip(row("Rail"), e.rail ? "On" : "Off", e.rail, () => this.edgeEdit(s.id, "rail", !e.rail));
        actions([["Remove", () => t.deleteSelection(), "warn"]]);
      } else if (s.kind === "prop") {
        const pr = app.world.props.get(s.id); if (!pr) return;
        title(pr.type === "market" ? `${MARKET_VENDORS[marketVendor(pr.seed, pr.opts?.vendor as string | undefined)]}'s market` : PROP_INFO[pr.type].label);
        const regrow = (patch: Partial<Pick<Prop, "seed" | "opts">>) => {
          app.begin();
          const result = app.ops.reviseProp(pr.id, patch);
          if (!result.ok) { app.cancel(); this.toast(result.why); this.refresh(); return; }
          app.recordChange(result.change); t.refreshHandles(); t.refreshHighlight(); this.refresh();
        };
        variantRows(pr, (k, v) => regrow({ opts: { ...pr.opts, [k]: v } }));
        if (isGreenery(pr.type)) {
          // live sliders: one undo step per gesture
          const live = (fn: () => void) => { fn(); app.changed({ structures: true }); };
          slider(row("Turn"), 0, 360, 5, ((pr.rot * 180 / Math.PI) % 360 + 360) % 360, v => live(() => { pr.rot = v * Math.PI / 180; }));
          slider(row("Size"), 0.6, 1.6, 0.05, pr.scale ?? 1, v => live(() => { pr.scale = v; }));
          if (pr.type === "palm") {
            slider(row("Height"), 0.6, 1.6, 0.05, +(pr.opts?.height ?? 1), v => live(() => { pr.opts = { ...pr.opts, height: v }; }));
            slider(row("Lean"), 0, 1.4, 0.05, pr.opts?.lean !== undefined ? +pr.opts.lean : 0.6, v => live(() => { pr.opts = { ...pr.opts, lean: v }; }));
          }
        }
        const acts: [string, () => void, string?][] = [["Reroll", () => regrow({ seed: Math.random(), opts: undefined })], ["Remove", () => t.deleteSelection(), "warn"]];
        if (pr.type !== "grotto") acts.unshift([pr.type === "hull" ? "Flip" : "Turn", () => t.rotate()]);
        actions(acts);
      }
      return;
    }
    switch (t.tool) {
      case "house": {
        title("Buildings");
        const choose = (v: string) => { t.buildingChoice = v; if (v in HOUSE_PRESETS) t.preset = v; t.shopHeading = null; t.ghostOpts = {}; this.refresh(); t.updateGhost(); };
        seg(row("Homes"), Object.entries(HOUSE_PRESETS).map(([k, v]) => [k, v.label] as [string, string]), t.buildingChoice, choose);
        seg(row("Shops"), [["market", "Market"], ["boatyard", "Boatyard"], ["bakery", "Bakery"]], t.buildingChoice, choose);
        seg(row("Landmarks"), [["hull", "Hull tavern"], ["lighthouse", "Lighthouse"]], t.buildingChoice, choose);
        if (t.placingSpecial) {
          const gp = { type: t.placingType, seed: t.propSeed, opts: t.ghostOpts } as Prop;
          variantRows(gp, (key, value) => { t.ghostOpts = { ...t.ghostOpts, [key]: value }; this.refresh(); t.updateGhost(); });
          actions([["Reroll", () => { t.propSeed = Math.random(); t.ghostOpts = {}; this.refresh(); t.updateGhost(); }]]);
        }
        break;
      }
      case "walk":
        title("Docks");
        seg(row("Style"), [["deck", "Deck"], ["rope", "Rope"]], t.walkStyle, v => { t.walkStyle = v as any; this.refresh(); });
        stepper(row("Height"), `${t.walkLift >= 0 ? "+" : ""}${t.walkLift.toFixed(2)}`, () => t.nudgeLift(-1), () => t.nudgeLift(1));
        chip(row("Landing"), t.walkPad ? "On" : "Off", t.walkPad, () => { t.walkPad = !t.walkPad; this.refresh(); });
        if (t.chain) actions([["Finish", () => t.endChain()]]);
        break;
      case "terrain":
        title("Terrain");
        seg(row("Mode"), [["raise", "Raise"], ["lower", "Lower"], ["flatten", "Flat"], ["smooth", "Smooth"]], t.terrainOp, v => { t.terrainOp = v as any; this.refresh(); });
        slider(row("Brush"), 0.5, 6, 0.5, t.brush, x => t.setBrush(x));
        break;
      case "paint": {
        title("Paint");
        const PAINT: [string, string, string][] = [["path", "#c2a276", "Sandy path"], ["cobble", "#9d8f7a", "Cobbles"], ["greenery", "#7c9648", "Greenery"], ["sand", "#e3c795", "Sand"], ["erase", "transparent", "Clear"]];
        const r = row("Surface");
        for (const [k, c, tip] of PAINT) chip(r, `<i class="dot" style="background:${c}${k === "erase" ? ";border:1.5px dashed var(--dim)" : ""}"></i>`, t.paintType === k, () => { t.paintType = k as any; this.refresh(); }, tip, "ic");
        slider(row("Brush"), 0.5, 6, 0.5, t.brush, x => t.setBrush(x));
        break;
      }
      case "prop": {
        title("Props");
        const groups: [string, PropType[]][] = [["Green", ["palm", "bougainvillea", "scrub", "rock"]], ["Dock", ["barrels", "crates", "lantern", "nets", "laundry", "crane"]], ["Boats", ["rowboat", "sloop"]], ["Market", ["fruitGarland", "pennant"]], ["Places", ["grotto"]]];
        const short: Record<string, string> = { bougainvillea: "Blooms", nets: "Nets", fruitGarland: "Fruit", pennant: "Pennant", grotto: "Grotto" };
        for (const [g, items] of groups) seg(row(g), items.map(i => [i, short[i] ?? PROP_INFO[i].label, PROP_INFO[i].label] as [string, string, string]), t.propType, v => { t.propType = v as PropType; this.refresh(); t.updateGhost(); });
        if (t.propType === "hull" || t.propType === "grotto") {
          const gp = { type: t.propType, seed: t.propSeed, opts: t.ghostOpts } as Prop;
          variantRows(gp, (k, v) => { t.ghostOpts = { ...t.ghostOpts, [k]: v }; this.refresh(); t.updateGhost(); });
          actions([["Shuffle", () => { t.propSeed = Math.random(); t.ghostOpts = {}; this.refresh(); t.updateGhost(); }]]);
        }
        break;
      }
    }
  }
  private nodeEdit(id: string, op: "y" | "pad", v: number) {
    this.app.begin();
    const result = this.app.ops.editNode(id, op === "y" ? { lift: v } : { pad: v });
    if (!result.ok) { this.app.cancel(); return; }
    if (result.value.clamped) this.toast("That's as steep as stairs go");
    this.app.recordChange(result.change); this.tools.refreshHandles(); this.refresh();
  }
  private edgeEdit(id: string, op: "style" | "width" | "rail", v: string | number | boolean) {
    if (!this.app.edits.active) this.app.begin();
    const patch = op === "style" ? { style: v as "deck" | "rope" } : op === "width" ? { width: v as number } : { rail: v as boolean };
    const result = this.app.ops.editEdge(id, patch);
    if (!result.ok) { this.app.cancel(); return; }
    this.app.recordChange(result.change); if (!this.app.edits.active) this.refresh();
  }
}
