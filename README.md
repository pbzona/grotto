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
| **Buildings** (2) | **Homes:** drag out a footprint or click to drop a cottage, townhouse, flat-roof house, longhouse, lookout, or tower. Select one to stretch walls, add wings, lift a storey, move it, or edit windows and doors. Over water or gentle slopes houses stand on tarred stilts; on steep ground they perch on a sandstone outcrop. **Shops:** place a covered market on land or on timber stilts over water. The bakery always rests on a solid sandstone base: on land it keys into the slope, and on water it becomes a stone quay joined to an existing dock. The boatyard finds a coastal site with a landward entrance and a slipway leading into shallow water. Markets have seeded fish, fruit, or flower vendors, with different goods, awnings and signs; reroll to change them. Fresh coves begin with two markets, at least one attached to a walkway. They have no trade or production yet. Villagers from connected homes may linger at the market or briefly enter the bakery and boatyard when a walkway reaches the entrance. **Landmarks:** place the hull tavern or lighthouse here. |
| **Docks & walkways** (3) | Click to lay posts or drag a segment. With Select, drag any post (including the far end of a pier) to move it, use the orange cones for height, or pull a dead end's arrow to extend it. Over water it's a dock on posts, on land a boardwalk, and steep runs become stairs. Start or end on an existing walkway to branch (junctions get landings); end against a house wall and a door opens there, on whichever floor matches. `[` `]` raise or lower the next post. Rope style sags between tall posts for bridges. |
| **Terrain** (4) | Raise, lower, flatten and smooth, in terraces. Cliffs form on their own. |
| **Paint** (5) | Sandy paths, cobbles, greenery (with bougainvillea blooms) and sand. |
| **Props & boats** (6) | Palms, bougainvillea, barrels, crates, lanterns, drying nets, laundry, a crane, hanging fruit garlands, vendor pennants, rowboats and sloops that bob at their moorings, and the sea grotto. Buildings and the grotto are sited rather than dropped: the ghost searches around the cursor for ground that fits and clears existing structures. The hull tavern beds into a beach along the shore (R flips it); the grotto cuts into a cliff with water in front (R swaps the dock side). The hull has size, cabin, roof, masts and annex variants; the grotto has size, arch and dock variants. Moving or removing a grotto restores the cliff it cut. |

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
