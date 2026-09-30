import type { App } from "./app";
import { Tools, ToolId, HOUSE_PRESETS } from "./tools";
import { PALETTES } from "./houses";
import { PROP_INFO, isGreenery } from "./props";
import { formatHour } from "./lighting";
import { type PropType, type Prop, propOpt, HULL_OPTS, GROTTO_OPTS } from "./world";

const ICON: Record<string, string> = {
  select: '<path d="M5 3l14 8-6 1.5L10 19z"/>',
  house: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-5h4v5"/>',
  walk: '<path d="M2 14h20"/><path d="M4 14v6M10 14v6M16 14v6M20 14v6"/><path d="M2 11h20"/>',
  terrain: '<path d="M2 20l6-10 4 6 3-4 7 8z"/>',
  paint: '<path d="M4 20c3 0 4-2 4-4l9-9-3-3-9 9c-2 0-4 1-4 4"/><path d="M13 6l3 3"/>',
  prop: '<path d="M12 3c-2 3-6 4-6 9a6 6 0 0 0 12 0c0-5-4-6-6-9z"/><path d="M12 21v-6"/>',
  erase: '<path d="M4 16l8-8 6 6-5 5H8z"/><path d="M13 19h7"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
  redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h3"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 1-1 1.7"/><path d="M12 17h.01"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  play: '<path d="M7 5l12 7-12 7z"/>', pause: '<path d="M8 5v14M16 5v14"/>',
};
const svg = (k: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICON[k]}</svg>`;

const TOOLS: { id: ToolId; label: string; key: string }[] = [
  { id: "select", label: "Select & edit", key: "1" },
  { id: "house", label: "Houses", key: "2" },
  { id: "walk", label: "Docks & walkways", key: "3" },
  { id: "terrain", label: "Shape terrain", key: "4" },
  { id: "paint", label: "Paint ground", key: "5" },
  { id: "prop", label: "Props & boats", key: "6" },
  { id: "erase", label: "Remove", key: "7" },
];

export function injectStyles() {
  const css = `
  :root { --bg: rgba(33,27,23,.86); --bg2: rgba(52,43,36,.9); --line: rgba(239,228,204,.12); --ink: #efe4cc; --dim: #b9aa90; --acc: #e6a676; --teal: #6fcfbd; }
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; overflow: hidden; background: #0b2a36; font-family: Inter, system-ui, sans-serif; color: var(--ink); -webkit-user-select: none; user-select: none; }
  canvas { display: block; touch-action: none; }
  #loading, #fallback { position: fixed; inset: 0; display: grid; place-items: center; font: 500 18px Fraunces, Georgia, serif; color: var(--ink); background: radial-gradient(#1c4552, #0b2a36); z-index: 50; text-align: center; }
  #fallback p { max-width: 420px; color: var(--dim); font: 14px/1.5 Inter, sans-serif; }
  .ui { position: fixed; z-index: 10; }
  .card { background: var(--bg); border: 1px solid var(--line); border-radius: 14px; backdrop-filter: blur(10px); box-shadow: 0 10px 30px rgba(0,0,0,.25); }
  #brand { top: 14px; left: 16px; padding: 8px 14px 9px; }
  #brand h1 { margin: 0; font: 650 22px/1 Fraunces, Georgia, serif; letter-spacing: .01em; }
  #brand span { display: block; margin-top: 3px; font-size: 11px; color: var(--dim); letter-spacing: .06em; text-transform: uppercase; }
  #toolbar { left: 16px; top: 50%; transform: translateY(-50%); padding: 6px; display: flex; flex-direction: column; gap: 4px; }
  .tb { position: relative; width: 44px; height: 44px; border: 0; border-radius: 10px; background: transparent; color: var(--ink); display: grid; place-items: center; cursor: pointer; }
  .tb svg { width: 22px; height: 22px; }
  .tb:hover { background: var(--bg2); }
  .tb.on { background: var(--acc); color: #2a1f18; }
  .tb .k { position: absolute; right: 4px; bottom: 2px; font-size: 9px; opacity: .6; }
  .tb .tip { position: absolute; left: 54px; top: 50%; transform: translateY(-50%); white-space: nowrap; background: var(--bg); border: 1px solid var(--line); padding: 5px 9px; border-radius: 8px; font-size: 12px; opacity: 0; pointer-events: none; transition: opacity .12s; }
  .tb:hover .tip { opacity: 1; }
  #panel { right: 16px; top: 64px; width: 236px; max-height: calc(100vh - 170px); overflow: auto; padding: 10px 12px 12px; }
  #panel .ph { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; margin-bottom: 6px; }
  #panel h2 { margin: 0; font: 600 15px Fraunces, Georgia, serif; }
  #panel h2 small { font: 500 11px Inter, sans-serif; color: var(--dim); }
  .leg { display: flex; gap: 7px; font-size: 10px; color: var(--dim); }
  .leg i { display: inline-block; width: 7px; height: 7px; border-radius: 50%; margin-right: 3px; vertical-align: 0; }
  .pr { display: grid; grid-template-columns: 50px 1fr; align-items: center; gap: 6px; margin: 5px 0; }
  .pl { font-size: 10.5px; color: var(--dim); text-transform: uppercase; letter-spacing: .05em; }
  .pc { display: flex; flex-wrap: wrap; align-items: center; gap: 3px; }
  .pc input[type=range] { width: 100%; accent-color: var(--acc); margin: 0; }
  .chip { border: 1px solid var(--line); background: var(--bg2); color: var(--ink); border-radius: 7px; padding: 4px 7px; font: 500 11.5px Inter, sans-serif; cursor: pointer; line-height: 1.2; }
  .chip:hover { border-color: rgba(239,228,204,.35); }
  .chip.on { background: var(--acc); color: #2a1f18; border-color: var(--acc); }
  .chip.ic { padding: 3px; width: 28px; height: 26px; display: grid; place-items: center; }
  .chip.ic svg { width: 17px; height: 17px; }
  .chip.sq { width: 24px; padding: 3px 0; }
  .chip.warn { color: #f1a58a; }
  .dot { display: block; width: 14px; height: 14px; border-radius: 50%; }
  .val { min-width: 38px; text-align: center; font-size: 12px; }
  .pa { display: flex; gap: 4px; justify-content: flex-end; margin-top: 9px; padding-top: 8px; border-top: 1px solid var(--line); }
  .sws { display: grid; grid-template-columns: repeat(8, 1fr); gap: 3px; margin: 2px 0 7px; }
  .sws .sw { height: 20px; border-radius: 5px; }
  .lbl { font-size: 11px; color: var(--dim); text-transform: uppercase; letter-spacing: .06em; margin: 12px 0 6px; }
  .seg { display: flex; flex-wrap: wrap; gap: 4px; }
  .btn { border: 1px solid var(--line); background: var(--bg2); color: var(--ink); border-radius: 8px; padding: 6px 9px; font: 500 12px Inter, sans-serif; cursor: pointer; }
  .btn:hover { border-color: rgba(239,228,204,.35); }
  .btn.on { background: var(--acc); color: #2a1f18; border-color: var(--acc); }
  .btn.warn { color: #f1a58a; }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; }
  .sw { height: 26px; border-radius: 7px; border: 2px solid transparent; cursor: pointer; position: relative; overflow: hidden; }
  .sw.on { border-color: var(--ink); }
  .sw i { position: absolute; right: 0; top: 0; bottom: 0; width: 34%; }
  .row { display: flex; align-items: center; gap: 8px; margin: 6px 0; font-size: 12px; }
  .row input[type=range] { flex: 1; accent-color: var(--acc); }
  .row b { width: 34px; text-align: right; font-weight: 500; color: var(--dim); }
  #top { top: 14px; right: 16px; padding: 5px; display: flex; gap: 2px; }
  #top .tb { width: 38px; height: 38px; }
  #time { right: 16px; bottom: 16px; padding: 8px 12px; display: flex; align-items: center; gap: 10px; }
  #time .tb { width: 34px; height: 34px; }
  #time input { width: 150px; accent-color: var(--acc); }
  #time .t { font: 500 13px Inter, sans-serif; width: 64px; }
  #hint { left: 50%; bottom: 18px; transform: translateX(-50%); padding: 6px 12px; font-size: 12px; color: var(--dim); max-width: min(620px, 60vw); text-align: center; }
  #hint b { color: var(--ink); font-weight: 600; }
  #toast { left: 50%; top: 18px; transform: translate(-50%, -10px); padding: 9px 16px; font-size: 13px; opacity: 0; transition: all .2s; pointer-events: none; }
  #toast.on { opacity: 1; transform: translate(-50%, 0); }
  body.noui .ui:not(#toast) { display: none !important; }
  #help { inset: 0; display: none; place-items: center; background: rgba(10,20,26,.55); z-index: 30; }
  #help.on { display: grid; }
  #help .card { width: min(640px, 92vw); padding: 20px 22px; max-height: 86vh; overflow: auto; }
  #help h2 { margin: 0 0 12px; font: 650 22px Fraunces, Georgia, serif; }
  #help table { width: 100%; border-collapse: collapse; font-size: 13px; }
  #help td { padding: 5px 4px; border-bottom: 1px solid var(--line); vertical-align: top; }
  #help td:first-child { width: 42%; color: var(--dim); }
  kbd { font: 600 11px Inter, sans-serif; background: var(--bg2); border: 1px solid var(--line); border-bottom-width: 2px; border-radius: 5px; padding: 1px 6px; color: var(--ink); }
  #menu { top: 62px; right: 16px; padding: 8px; display: none; flex-direction: column; gap: 4px; min-width: 190px; z-index: 20; }
  #menu.on { display: flex; }
  #menu .btn { text-align: left; }
  @media (max-width: 760px) {
    #toolbar { top: auto; bottom: 12px; left: 50%; transform: translateX(-50%); flex-direction: row; }
    .tb .tip { display: none; }
    #panel { top: auto; bottom: 76px; right: 8px; left: 8px; width: auto; max-height: 38vh; }
    #hint { display: none; }
    #time { bottom: auto; top: 14px; right: 110px; padding: 4px 8px; }
    #time input { width: 70px; }
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
  private timeLbl!: HTMLSpanElement;
  private timeIn!: HTMLInputElement;
  private playBtn!: HTMLButtonElement;
  help!: HTMLDivElement;
  private menu!: HTMLDivElement;

  constructor(private app: App, private tools: Tools, private cam: { orbit: (d: number) => void; zoom: (d: number) => void; reset: () => void }) {
    injectStyles();
    const el = (html: string) => { const d = document.createElement("div"); d.innerHTML = html.trim(); const n = d.firstElementChild as HTMLDivElement; document.body.appendChild(n); return n; };
    el(`<div id="brand" class="ui card"><h1>Grotto</h1><span>a cove village builder</span></div>`);
    const tb = el(`<div id="toolbar" class="ui card"></div>`);
    for (const t of TOOLS) {
      const b = document.createElement("button");
      b.className = "tb"; b.innerHTML = `${svg(t.id)}<span class="k">${t.key}</span><span class="tip">${t.label} <kbd>${t.key}</kbd></span>`;
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
    mbtn("Restore the starter village", () => { app.begin(); app.starter(); app.markAll(); tools.select(null); this.toast("Starter village restored"); });
    mbtn("Empty cove (keep the land)", () => { app.begin(); const h = app.world.heights.slice(); app.world.clear(); app.world.heights.set(h); app.markAll(); tools.select(null); this.toast("An empty cove"); });
    mbtn("Save to a file…", () => this.exportFile());
    mbtn("Open a file…", () => this.importFile());
    mbtn("Toggle 30 / 60 fps cap", () => { app.settings.fps = app.settings.fps === 60 ? 30 : 60; this.toast(`Frame cap: ${app.settings.fps} fps`); });

    this.panel = el(`<div id="panel" class="ui card"></div>`);
    this.hint = el(`<div id="hint" class="ui card"></div>`);
    this.toastEl = el(`<div id="toast" class="ui card"></div>`);
    const time = el(`<div id="time" class="ui card"><button class="tb" title="Play the day (N)"></button><input type="range" min="0" max="24" step="0.05"><span class="t"></span></div>`);
    this.playBtn = time.querySelector("button")!; this.timeIn = time.querySelector("input")!; this.timeLbl = time.querySelector(".t")!;
    this.playBtn.onclick = () => { app.playing = !app.playing; this.refreshTime(); };
    this.timeIn.oninput = () => { app.hour = +this.timeIn.value; this.refreshTime(); };
    this.help = el(`<div id="help" class="ui"><div class="card"><h2>Building the cove</h2><table>
      <tr><td>Orbit · zoom · pan</td><td>Right-drag · scroll · <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> or arrows</td></tr>
      <tr><td>Low, upward shots</td><td>Right-drag down to tip the view up · scroll toward a subject · <kbd>U</kbd> hides the interface</td></tr>
      <tr><td>Turn the view · zoom · reset</td><td><kbd>Q</kbd> <kbd>E</kbd> · <kbd>+</kbd> <kbd>−</kbd> · <kbd>F</kbd></td></tr>
      <tr><td>Tools</td><td><kbd>1</kbd> select · <kbd>2</kbd> houses · <kbd>3</kbd> docks · <kbd>4</kbd> terrain · <kbd>5</kbd> paint · <kbd>6</kbd> props · <kbd>7</kbd> remove</td></tr>
      <tr><td>Houses</td><td>Drag out a footprint (or click). Select one: pull the <b>arrows</b> to stretch, <b>Shift-drag</b> an arrow for a new wing, drag the <b>ring</b> to move, drag the <b>diamond</b> up/down for floors. Click a wall to cycle window / wall / door.</td></tr>
      <tr><td>Stilts</td><td>Houses over water or on slopes stand on stilts at deck height automatically — the panel can force stilts or key a house into the slope.</td></tr>
      <tr><td>Docks & walkways</td><td>Click to lay posts, or drag a segment. Start or end on a walkway to branch, on a house wall for a door. <kbd>[</kbd> <kbd>]</kbd> raise/lower the next post — steep runs become stairs. Rope style makes sagging bridges. Double-click, right-click or <kbd>Esc</kbd> to finish.</td></tr>
      <tr><td>Edit a walkway</td><td>Drag any post — including the far end of a pier — to move it. Orange cones set its height; a dead end's cream arrow pulls out a new stretch.</td></tr>
      <tr><td>Wings & height variety</td><td>Small teal arrows along a selected house's walls pull one stretch of wall out into a wing. Orange cones on top lift one stretch a floor higher — the rest becomes a roof terrace with a door onto it (drag down to cut a terrace in instead).</td></tr>
      <tr><td>Built into the rock</td><td>Houses on steep ground perch on a sandstone outcrop automatically; pick <b>Rock outcrop</b> in the panel to force it.</td></tr>
      <tr><td>Brush size · rotate</td><td><kbd>[</kbd> <kbd>]</kbd> (or Shift+scroll) · <kbd>R</kbd></td></tr>
      <tr><td>Delete · cancel</td><td><kbd>Del</kbd> / <kbd>Backspace</kbd> · <kbd>Esc</kbd></td></tr>
      <tr><td>Undo · redo</td><td><kbd>Ctrl</kbd>+<kbd>Z</kbd> · <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd></td></tr>
      <tr><td>Time of day</td><td><kbd>N</kbd> play/pause · <kbd>,</kbd> <kbd>.</kbd> an hour back/forward</td></tr>
      </table><p style="color:var(--dim);font-size:12px;margin:14px 0 0">Your cove saves itself in this browser. Press <kbd>?</kbd> or <kbd>Esc</kbd> to close.</p></div></div>`);
    this.help.onclick = e => { if (e.target === this.help) this.toggleHelp(); };

    tools.onChange = () => this.refresh();
    tools.toast = m => this.toast(m);
    app.onChange = () => this.refreshSoon();
    window.addEventListener("keydown", e => this.key(e));
    this.refresh(); this.refreshTime();
    setInterval(() => this.refreshTime(), 500);
    if (!localStorage.getItem("grotto.seenHelp")) { localStorage.setItem("grotto.seenHelp", "1"); setTimeout(() => this.toast("Press ? for controls · right-drag to look around"), 1200); }
  }

  toast(msg: string) {
    this.toastEl.textContent = msg; this.toastEl.classList.add("on");
    clearTimeout(this.toastT); this.toastT = window.setTimeout(() => this.toastEl.classList.remove("on"), 2600);
  }
  toggleHelp() { this.help.classList.toggle("on"); }
  undo() { if (this.app.undo()) { this.tools.select(null); this.toast("Undone"); } }
  redo() { if (this.app.redo()) { this.tools.select(null); this.toast("Redone"); } }
  private refreshTimer = 0;
  private refreshSoon() { clearTimeout(this.refreshTimer); this.refreshTimer = window.setTimeout(() => this.refreshPanelValues(), 120); }
  refreshTime() {
    this.timeIn.value = String(this.app.hour);
    this.timeLbl.textContent = formatHour(this.app.hour);
    this.playBtn.innerHTML = svg(this.app.playing ? "pause" : "play");
  }

  private key(e: KeyboardEvent) {
    if ((e.target as HTMLElement)?.tagName === "INPUT" && (e.target as HTMLInputElement).type !== "range") return;
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
    const blob = new Blob([JSON.stringify({ grotto: 1, world: this.app.world.save(), hour: this.app.hour })], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "my-cove.grotto.json"; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  private importFile() {
    const i = document.createElement("input"); i.type = "file"; i.accept = ".json,application/json";
    i.onchange = async () => {
      const f = i.files?.[0]; if (!f) return;
      try { const o = JSON.parse(await f.text()); this.app.begin(); this.app.world.load(o.world); this.app.markAll(); this.tools.select(null); this.toast("Cove loaded"); }
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
  private refreshPanelValues() { if (this.tools.sel) this.buildPanel(); }
  private hintText() {
    const t = this.tools;
    const k = (x: string) => `<kbd>${x}</kbd>`;
    switch (t.tool) {
      case "select": return t.sel ? `${k("Del")} remove · ${k("Esc")} done` : `click to edit · right-drag to orbit · ${k("?")} help`;
      case "house": return `drag or click · ${k("R")} turn`;
      case "walk": return t.chain ? `click to add · ${k("[")}${k("]")} height · ${k("Esc")} finish` : `click to start · snaps to docks & walls`;
      case "terrain": case "paint": return `drag to ${t.tool === "paint" ? "paint" : t.terrainOp} · ${k("[")}${k("]")} size`;
      case "prop": return t.propType === "hull" ? `snaps to the shore · ${k("R")} flip` : t.propType === "grotto" ? `snaps into a cliff · ${k("R")} dock side` : `click to place · ${k("R")} turn`;
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
      i.oninput = () => fn(+i.value); host.appendChild(i);
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
          [["#fff1c9", "stretch"], ["#6fdcc9", "wing"], ["#f2a65a", "lift"]]);
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
        title("Post", [["#6fdcc9", "move"], ["#e6a676", "height"], ["#fff1c9", "extend"]]);
        stepper(row("Height"), n.y.toFixed(2), () => this.nodeEdit(s.id, "y", -0.25), () => this.nodeEdit(s.id, "y", 0.25));
        seg(row("Landing"), [["0", "None"], ["1", "S"], ["1.5", "L"]], String(n.pad), v2 => this.nodeEdit(s.id, "pad", +v2));
        actions([["Remove", () => t.deleteSelection(), "warn"]]);
      } else if (s.kind === "edge") {
        const e = app.world.edges.get(s.id); if (!e) return;
        title("Walkway", [["#6fdcc9", "move ends"]]);
        seg(row("Style"), [["deck", "Deck"], ["rope", "Rope"]], e.style, v2 => this.edgeEdit(s.id, "style", v2));
        slider(row("Width"), 0.7, 2, 0.1, e.width, x => this.edgeEdit(s.id, "width", x));
        chip(row("Rail"), e.rail ? "On" : "Off", e.rail, () => this.edgeEdit(s.id, "rail", !e.rail));
        actions([["Remove", () => t.deleteSelection(), "warn"]]);
      } else if (s.kind === "prop") {
        const pr = app.world.props.get(s.id); if (!pr) return;
        title(PROP_INFO[pr.type].label);
        const regrow = () => { if (pr.type === "grotto") app.carveGrotto(pr); app.changed({ structures: true, terrain: pr.type === "grotto" }); this.refresh(); };
        variantRows(pr, (k, v) => { app.begin(); pr.opts = { ...pr.opts, [k]: v }; regrow(); });
        if (isGreenery(pr.type)) {
          // live sliders: one undo step per gesture
          let lastT = 0;
          const live = (fn: () => void) => { const now = performance.now(); if (now - lastT > 1200) app.begin(); lastT = now; fn(); app.changed({ structures: true }); };
          slider(row("Turn"), 0, 360, 5, ((pr.rot * 180 / Math.PI) % 360 + 360) % 360, v => live(() => { pr.rot = v * Math.PI / 180; }));
          slider(row("Size"), 0.6, 1.6, 0.05, pr.scale ?? 1, v => live(() => { pr.scale = v; }));
          if (pr.type === "palm") {
            slider(row("Height"), 0.6, 1.6, 0.05, +(pr.opts?.height ?? 1), v => live(() => { pr.opts = { ...pr.opts, height: v }; }));
            slider(row("Lean"), 0, 1.4, 0.05, pr.opts?.lean !== undefined ? +pr.opts.lean : 0.6, v => live(() => { pr.opts = { ...pr.opts, lean: v }; }));
          }
        }
        const acts: [string, () => void, string?][] = [["Reroll", () => { app.begin(); pr.seed = Math.random(); pr.opts = undefined; regrow(); }], ["Remove", () => t.deleteSelection(), "warn"]];
        if (pr.type !== "grotto") acts.unshift([pr.type === "hull" ? "Flip" : "Turn", () => t.rotate()]);
        actions(acts);
      }
      return;
    }
    switch (t.tool) {
      case "house":
        title("Houses");
        seg(row("Type"), Object.entries(HOUSE_PRESETS).map(([k, v]) => [k, v.label] as [string, string]), t.preset, v => { t.preset = v; this.refresh(); t.updateGhost(); });
        break;
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
        const groups: [string, PropType[]][] = [["Green", ["palm", "bougainvillea", "scrub", "rock"]], ["Dock", ["barrels", "crates", "lantern", "nets", "laundry", "crane"]], ["Boats", ["rowboat", "sloop"]], ["Big", ["hull", "grotto", "lighthouse"]]];
        const short: Record<string, string> = { bougainvillea: "Blooms", nets: "Nets", hull: "Tavern", grotto: "Grotto" };
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
    const n = this.app.world.nodes.get(id); if (!n) return;
    this.app.begin();
    if (op === "y") n.y = Math.max(Math.max(this.app.world.height(n.x, n.z), 0.2) + 0.2, n.y + v); else n.pad = v;
    this.app.changed({ structures: true }); this.tools.refreshHandles(); this.refresh();
  }
  private edgeEdit(id: string, op: string, v: any) {
    const e = this.app.world.edges.get(id); if (!e) return;
    this.app.begin();
    (e as any)[op] = v;
    this.app.changed({ structures: true }); this.refresh();
  }
}
