# Grotto — a cove village builder

A small, cozy, procedural village builder set in a sheltered sandstone cove. You build a fishing
village with a light smugglers'-hideout feel: stilt houses over a turquoise lagoon, a network of
docks and walkways, rope bridges, stairs up the cliffs, a hidden sea grotto, a hull turned tavern
and a lookout on the headland.

Built with Three.js (`WebGPURenderer`, with automatic WebGL 2 fallback). All shading is written
in TSL node materials: terraced sandstone strata, luminous shallows with foam and caustics, and
warm lanterns against a teal night.

## Run

    npm ci             # Node.js 24+ (native TypeScript model tests)
    npm run dev        # http://localhost:5173
    npm run check      # typecheck, model regressions, production build
    npm run build      # static site in dist/

URL flags: `?webgl` forces the WebGL backend, `?dpr=1` caps the pixel ratio, `?fresh` ignores the
saved cove and loads the starter village.

## Building

| | |
|---|---|
| **Houses** (2) | Drag out a footprint or click to drop a preset. Select one: cream arrows stretch a wall, the small teal arrows along each wall pull that one stretch out into a wing (gable end facing out), the orange cones lift one stretch a storey higher (the rest becomes a roof terrace with a door onto it; drag down to cut a terrace in), the ring moves it and the diamond adds floors. Click a wall to cycle window / wall / door. Over water or gentle slopes houses stand on tarred stilts at deck height; on steep ground they perch on a sandstone outcrop, keyed into the cliff. |
| **Docks & walkways** (3) | Click to lay posts or drag a segment. With Select, drag any post (including the far end of a pier) to move it, use the orange cones for height, or pull a dead end's arrow to extend it. Over water it's a dock on posts, on land a boardwalk, and steep runs become stairs. Start or end on an existing walkway to branch (junctions get landings); end against a house wall and a door opens there, on whichever floor matches. `[` `]` raise or lower the next post. Rope style sags between tall posts for bridges. |
| **Terrain** (4) | Raise, lower, flatten and smooth, in terraces. Cliffs form on their own. |
| **Paint** (5) | Sandy paths, cobbles, greenery (with bougainvillea blooms) and sand. |
| **Props & boats** (6) | Palms, bougainvillea, barrels, crates, lanterns, drying nets, laundry, a crane, rowboats and sloops that bob at their moorings, and landmarks. Landmarks are sited rather than dropped: the ghost searches around the cursor for a spot and heading that suits the ground and clears houses, walkways and props. The hull tavern beds into a beach along the shore, pitched and canted to the slope (R flips it); the sea grotto cuts into a cliff with water in front, and the cliff grows back over its vault (R swaps the dock side). Each has variants you can pick in the panel: hull size, cabin (low, tall or stern), roof, masts and annex (deck or shack); grotto size, arch (round, tall or wide) and dock side. Moving or removing a grotto restores the cliff it cut. |

Camera: right-drag to orbit, scroll to zoom, WASD or the arrow keys to pan, Q/E to turn, F to reset.
N plays the day, and `,` `.` step the hour. Press `?` in the app for every shortcut.

## Model and editing

`src/world.ts` owns plain world data and terrain queries. `src/edits.ts` owns provisional
edits, cancellation, undo and redo. Tools and panel controls begin an edit, preview changes,
and commit once at the end of the gesture. Escape and pointer cancellation restore the
pre-edit world; no-op edits preserve redo. `src/app.ts` connects those edits to saving and
generated geometry. Dirty flags accumulate until a rebuild; painting also invalidates scatter.

The height array stores editable **base terrain**. Grotto caps are derived from the current
props: `level()` and `height()` return the carved surface, while `baseLevel()` and
`height(x, z, true)` read the underlying terrain. Terraforming edits the base, including beneath
a grotto. Moving or removing a grotto reveals those edits.

JSON saves use version 2 and store base terrain, with no carved-cell backups. Version 1 saves
migrate their saved original levels on load. Loading validates the complete payload before
changing the live world. Imports restore the saved hour as well. Autosave skips provisional
gestures and flushes on page hide; storage failures show an export reminder. An unreadable
stored save is copied to `grotto.cove.v1.recovery` before the original can be replaced.

## Performance

The renderer is built to stay light, since the cove gets shared with people on all kinds of hardware:
the pixel ratio is capped at 1.5, the frame rate at 60 fps (30 when idle or unfocused, and none
at all while hidden), and every static structure is merged into a single draw call. Lamp glow comes
from a CPU-baked light map rather than dynamic lights.

## Tests

`npm test` runs model regressions without Three.js or a browser: atomic loading, edit history,
edge splitting, grotto modifiers, legacy migration and terrain edits through undo/redo.

For browser checks, install [agent-browser](https://github.com/vercel-labs/agent-browser) and
its browser, then run `npm run test:browser`. The runner starts Vite on port 5175, runs the
interaction suites on fresh worlds with forced WebGL and automatic backend selection, and
renders an on-demand frame after each suite. Any failed assertion exits nonzero. The output
names the actual backend (automatic selection can fall back to WebGL) and reports warmed
structure-rebuild timings. These timings are diagnostics, not a hardware-independent budget.

`test/regressions.js` covers cancellation, abandoned walkway splits, paint invalidation,
grotto terrain preservation, import failures, storage errors, autosave and page reload.
The older suites cover house handles, placement, erase and shortcuts. They project world points
and dispatch pointer events; `test/ab-lib.sh` also provides real mouse-input helpers.
`test/ab-shot.sh` renders an on-demand frame (`?test`) and screenshots it. Set
`AGENT_BROWSER_EXECUTABLE_PATH` when you need a specific browser executable.

MIT licensed.
