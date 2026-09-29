import type { App } from "./app";
import { Tools, ToolId, HOUSE_PRESETS } from "./tools";
import { PALETTES } from "./houses";
import { PROP_INFO } from "./props";
import { formatHour } from "./lighting";
import type { PropType } from "./world";

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
  #panel { right: 16px; top: 64px; width: 268px; max-height: calc(100vh - 170px); overflow: auto; padding: 14px; }
  #panel h2 { margin: 0 0 2px; font: 600 16px Fraunces, Georgia, serif; }
  #panel .sub { color: var(--dim); font-size: 12px; margin-bottom: 10px; line-height: 1.45; }
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
  #hint { left: 50%; bottom: 18px; transform: translateX(-50%); padding: 8px 14px; font-size: 12.5px; color: var(--dim); max-width: min(620px, 60vw); text-align: center; }
  #hint b { color: var(--ink); font-weight: 600; }
  #toast { left: 50%; top: 18px; transform: translate(-50%, -10px); padding: 9px 16px; font-size: 13px; opacity: 0; transition: all .2s; pointer-events: none; }
  #toast.on { opacity: 1; transform: translate(-50%, 0); }
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
      <tr><td>Turn the view · zoom · reset</td><td><kbd>Q</kbd> <kbd>E</kbd> · <kbd>+</kbd> <kbd>−</kbd> · <kbd>F</kbd></td></tr>
      <tr><td>Tools</td><td><kbd>1</kbd> select · <kbd>2</kbd> houses · <kbd>3</kbd> docks · <kbd>4</kbd> terrain · <kbd>5</kbd> paint · <kbd>6</kbd> props · <kbd>7</kbd> remove</td></tr>
      <tr><td>Houses</td><td>Drag out a footprint (or click). Select one: pull the <b>arrows</b> to stretch, <b>Shift-drag</b> an arrow for a new wing, drag the <b>ring</b> to move, drag the <b>diamond</b> up/down for floors. Click a wall to cycle window / wall / door.</td></tr>
      <tr><td>Stilts</td><td>Houses over water or on slopes stand on stilts at deck height automatically — the panel can force stilts or key a house into the slope.</td></tr>
      <tr><td>Docks & walkways</td><td>Click to lay posts, or drag a segment. Start or end on a walkway to branch, on a house wall for a door. <kbd>[</kbd> <kbd>]</kbd> raise/lower the next post — steep runs become stairs. Rope style makes sagging bridges. Double-click, right-click or <kbd>Esc</kbd> to finish.</td></tr>
      <tr><td>Edit a walkway post</td><td>Select it, drag it to move, drag the orange cones for height.</td></tr>
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
    switch (t.tool) {
      case "select": return t.sel ? "<b>Drag handles</b> to reshape · <b>Del</b> removes · <b>Esc</b> deselects" : "<b>Click</b> anything to edit it · <b>right-drag</b> to orbit · <b>?</b> for all controls";
      case "house": return "<b>Drag</b> out a footprint or <b>click</b> to drop a " + HOUSE_PRESETS[t.preset].label.toLowerCase() + " · <b>R</b> turns it";
      case "walk": return t.chain ? `<b>Click</b> to add a post · next post ${t.walkLift >= 0 ? "+" : ""}${t.walkLift.toFixed(2)} (<b>[ ]</b>) · <b>double-click</b> or <b>Esc</b> to finish` : "<b>Click</b> to start a walkway — over water it becomes a dock on posts · end on a wall for a door";
      case "terrain": return `<b>Drag</b> to ${t.terrainOp} · brush ${t.brush.toFixed(1)} (<b>[ ]</b>)`;
      case "paint": return `<b>Drag</b> to paint ${t.paintType} · brush ${t.brush.toFixed(1)} (<b>[ ]</b>)`;
      case "prop": return `<b>Click</b> to place · <b>R</b> or Shift+scroll to turn`;
      case "erase": return "<b>Click</b> a house, walkway, boat or prop to remove it";
    }
  }
  private buildPanel() {
    const p = this.panel, t = this.tools, app = this.app;
    p.innerHTML = "";
    const h2 = (title: string, sub?: string) => { p.insertAdjacentHTML("beforeend", `<h2>${title}</h2>${sub ? `<div class="sub">${sub}</div>` : ""}`); };
    const lbl = (s: string) => p.insertAdjacentHTML("beforeend", `<div class="lbl">${s}</div>`);
    const seg = (opts: [string, string][], cur: string, fn: (v: string) => void) => {
      const d = document.createElement("div"); d.className = "seg";
      for (const [v, l] of opts) { const b = document.createElement("button"); b.className = "btn" + (v === cur ? " on" : ""); b.textContent = l; b.onclick = () => fn(v); d.appendChild(b); }
      p.appendChild(d);
    };
    const btns = (items: [string, () => void, string?][]) => {
      const d = document.createElement("div"); d.className = "seg";
      for (const [l, fn, cls] of items) { const b = document.createElement("button"); b.className = "btn" + (cls ? " " + cls : ""); b.textContent = l; b.onclick = fn; d.appendChild(b); }
      p.appendChild(d);
    };
    const slider = (label: string, min: number, max: number, step: number, val: number, fn: (v: number) => void) => {
      const r = document.createElement("div"); r.className = "row";
      r.innerHTML = `<span style="width:64px">${label}</span><input type="range" min="${min}" max="${max}" step="${step}" value="${val}"><b>${val.toFixed(2)}</b>`;
      const i = r.querySelector("input")!, b = r.querySelector("b")!;
      let started = false;
      i.oninput = () => { b.textContent = (+i.value).toFixed(2); fn(+i.value); started = true; };
      i.onchange = () => { started = false; };
      void started;
      p.appendChild(r);
    };
    const s = t.sel;
    if (t.tool === "select" && s) {
      if (s.kind === "house") {
        const h = app.world.houses.get(s.id); if (!h) return;
        const v = h.volumes[s.vi] ?? h.volumes[0];
        const kind = v.kind ?? "room";
        h2(kind === "lookout" ? "Lookout" : kind === "tower" ? "Tower" : "House", h.volumes.length > 1 ? `Editing part ${s.vi + 1} of ${h.volumes.length} — click another part to switch.` : "Pull the handles in the scene to reshape it.");
        lbl("Colours");
        const g = document.createElement("div"); g.className = "grid";
        PALETTES.forEach((pal, i) => {
          const d = document.createElement("div"); d.className = "sw" + (h.palette === i ? " on" : ""); d.title = pal.name;
          d.style.background = pal.wall; d.innerHTML = `<i style="background:${pal.trim}"></i>`;
          d.onclick = () => t.houseEdit("palette", i); g.appendChild(d);
        });
        p.appendChild(g);
        lbl("Walls");
        seg([["plaster", "Plaster"], ["plank", "Painted planks"], ["stone", "Stone base"]], h.style, v2 => t.houseEdit("style", v2));
        if (kind !== "lookout") {
          lbl("Roof");
          seg([["gable", "Gable"], ["hip", "Hip"], ["flat", "Flat terrace"], ["shed", "Lean-to"]], v.roof, v2 => t.houseEdit("roof", v2));
          if (v.roof !== "flat") {
            slider("Pitch", 0.5, 1.6, 0.05, v.pitch, x => t.houseEdit("pitch", x));
            slider("Curve", -1, 1, 0.05, v.curve, x => t.houseEdit("curve", x));
            slider("Eaves", 0.05, 0.45, 0.01, v.overhang, x => t.houseEdit("overhang", x));
          }
        }
        lbl(`Floors · ${v.floors}`);
        btns([["− floor", () => t.houseEdit("floors", -1)], ["+ floor", () => t.houseEdit("floors", 1)], ["Turn ridge", () => t.houseEdit("ridge")]]);
        lbl("Foundation");
        seg([["auto", "Auto"], ["stilts", "Stilts"], ["keyed", "Keyed into slope"]], h.foundation, v2 => t.houseEdit("foundation", v2));
        lbl("Details");
        btns([
          [`Shutters ${h.shutters ? "✓" : ""}`, () => t.houseEdit("toggle", "shutters"), h.shutters ? "on" : ""],
          [`Flower boxes ${h.boxes ? "✓" : ""}`, () => t.houseEdit("toggle", "boxes"), h.boxes ? "on" : ""],
          [`Awnings ${h.awning ? "✓" : ""}`, () => t.houseEdit("toggle", "awning"), h.awning ? "on" : ""],
        ]);
        lbl("Add a wing");
        btns([["Room", () => t.houseEdit("wing", "room")], ["Lean-to", () => t.houseEdit("wing", "shed")], ["Tower", () => t.houseEdit("wing", "tower")], ["Lookout", () => t.houseEdit("wing", "lookout")]]);
        lbl("");
        btns([["Reroll details", () => t.houseEdit("reroll")], [h.volumes.length > 1 && s.vi > 0 ? "Remove this part" : "Remove house", () => t.deleteSelection(), "warn"]]);
      } else if (s.kind === "node") {
        const n = app.world.nodes.get(s.id); if (!n) return;
        h2("Walkway post", "Drag it to move it; drag the orange cones to raise or lower it. Steep runs turn into stairs.");
        lbl(`Height · ${n.y.toFixed(2)}`);
        btns([["Lower", () => this.nodeEdit(s.id, "y", -0.25)], ["Raise", () => this.nodeEdit(s.id, "y", 0.25)]]);
        lbl("Landing");
        seg([["0", "None"], ["1", "Small"], ["1.5", "Large"]], String(n.pad), v2 => this.nodeEdit(s.id, "pad", +v2));
        lbl("");
        btns([["Remove post", () => t.deleteSelection(), "warn"]]);
      } else if (s.kind === "edge") {
        const e = app.world.edges.get(s.id); if (!e) return;
        h2("Walkway", "One stretch between two posts.");
        lbl("Style");
        seg([["deck", "Plank deck"], ["rope", "Rope bridge"]], e.style, v2 => this.edgeEdit(s.id, "style", v2));
        slider("Width", 0.7, 2, 0.1, e.width, x => this.edgeEdit(s.id, "width", x));
        lbl("");
        btns([[`Rope rail ${e.rail ? "✓" : ""}`, () => this.edgeEdit(s.id, "rail", !e.rail), e.rail ? "on" : ""], ["Remove", () => t.deleteSelection(), "warn"]]);
      } else if (s.kind === "prop") {
        const pr = app.world.props.get(s.id); if (!pr) return;
        h2(PROP_INFO[pr.type].label, "Drag it to move it.");
        btns([["Turn (R)", () => t.rotate()], ["Reroll", () => { app.begin(); pr.seed = Math.random(); app.changed({ structures: true }); }], ["Remove", () => t.deleteSelection(), "warn"]]);
      }
      return;
    }
    switch (t.tool) {
      case "select": h2("The cove", "Click a house, walkway, boat or prop to edit it. Pick a tool on the left to build."); break;
      case "house":
        h2("Houses", "Drag out a footprint, or click to drop one. Over water or slopes they rise on stilts.");
        lbl("Type");
        seg(Object.entries(HOUSE_PRESETS).map(([k, v]) => [k, v.label]), t.preset, v => { t.preset = v; this.refresh(); t.updateGhost(); });
        break;
      case "walk":
        h2("Docks & walkways", "Click to lay posts. Over water it's a dock; on land a boardwalk; steep runs become stairs; rope style sags between posts.");
        lbl("Style");
        seg([["deck", "Plank deck"], ["rope", "Rope bridge"]], t.walkStyle, v => { t.walkStyle = v as any; this.refresh(); });
        lbl(`Next post height · ${t.walkLift >= 0 ? "+" : ""}${t.walkLift.toFixed(2)}`);
        btns([["Lower [", () => t.nudgeLift(-1)], ["Raise ]", () => t.nudgeLift(1)], [`Landing ${t.walkPad ? "✓" : ""}`, () => { t.walkPad = !t.walkPad; this.refresh(); }, t.walkPad ? "on" : ""]]);
        if (t.chain) btns([["Finish walkway", () => t.endChain()]]);
        break;
      case "terrain":
        h2("Shape terrain", "Raise and lower the land in terraces. Cliffs form on their own.");
        seg([["raise", "Raise"], ["lower", "Lower"], ["flatten", "Flatten"], ["smooth", "Smooth"]], t.terrainOp, v => { t.terrainOp = v as any; this.refresh(); });
        slider("Brush", 0.5, 6, 0.5, t.brush, x => t.setBrush(x));
        break;
      case "paint":
        h2("Paint the ground");
        seg([["path", "Sandy path"], ["cobble", "Cobbles"], ["greenery", "Greenery"], ["sand", "Sand"], ["erase", "Clear"]], t.paintType, v => { t.paintType = v as any; this.refresh(); });
        slider("Brush", 0.5, 6, 0.5, t.brush, x => t.setBrush(x));
        break;
      case "prop": {
        h2("Props & boats", "Boats go on the water; props can stand on land or on the docks.");
        const groups: [string, PropType[]][] = [["Greenery", ["palm", "bougainvillea", "scrub", "rock"]], ["Dockside", ["barrels", "crates", "lantern", "nets", "laundry", "crane"]], ["Boats", ["rowboat", "sloop"]], ["Landmarks", ["hull", "grotto", "lighthouse"]]];
        for (const [g, items] of groups) { lbl(g); seg(items.map(i => [i, PROP_INFO[i].label]), t.propType, v => { t.propType = v as PropType; this.refresh(); t.updateGhost(); }); }
        break;
      }
      case "erase": h2("Remove", "Click something to remove it. Undo with Ctrl+Z."); break;
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
