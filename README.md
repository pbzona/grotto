# Grotto — a cove village builder

A small, cozy, procedural village builder set in a sheltered sandstone cove. You build a fishing
village with a light smugglers'-hideout feel: stilt houses over a turquoise lagoon, a network of
docks and walkways, rope bridges, stairs up the cliffs, a hidden sea grotto, a hull turned tavern
and a lookout on the headland.

Built with Three.js (`WebGPURenderer`, with automatic WebGL 2 fallback). All shading is written
in TSL node materials: terraced sandstone strata, luminous shallows with foam and caustics, and
warm lanterns against a teal night.

## Run

    npm install
    npm run dev        # http://localhost:5173
    npm run build      # static site in dist/

URL flags: `?webgl` forces the WebGL backend, `?dpr=1` caps the pixel ratio, `?fresh` ignores the
saved cove and loads the starter village.

## Building

| | |
|---|---|
| **Houses** (2) | Drag out a footprint or click to drop a preset. Select one to pull the arrows (stretch a wall), **Shift-drag** an arrow for a new wing, drag the ring to move, drag the diamond for floors. Click a wall to cycle window / wall / door. Houses over water or on slopes stand on tarred stilts at deck height; you can force stilts or key a house into a slope. |
| **Docks & walkways** (3) | Click to lay posts or drag a segment. Over water it's a dock on posts, on land a boardwalk, and steep runs become stairs. Start or end on an existing walkway to branch (junctions get landings); end against a house wall and a door opens there, on whichever floor matches. `[` `]` raise or lower the next post. Rope style sags between tall posts for bridges. |
| **Terrain** (4) | Raise, lower, flatten and smooth, in terraces. Cliffs form on their own. |
| **Paint** (5) | Sandy paths, cobbles, greenery (with bougainvillea blooms) and sand. |
| **Props & boats** (6) | Palms, bougainvillea, barrels, crates, lanterns, drying nets, laundry, a crane, rowboats and sloops that bob at their moorings, and landmarks: the hull tavern, a sea grotto that carves itself into the cliff, and a lighthouse. |

Camera: right-drag to orbit, scroll to zoom, WASD or the arrow keys to pan, Q/E to turn, F to reset.
N plays the day, and `,` `.` step the hour. Press `?` in the app for every shortcut.

## Performance

The renderer is built to stay light, since the cove gets shared with people on all kinds of hardware:
the pixel ratio is capped at 1.5, the frame rate at 60 fps (30 when idle or unfocused, and none
at all while hidden), and every static structure is merged into a single draw call. Lamp glow comes
from a CPU-baked light map rather than dynamic lights.

## Tests

Visual and interaction checks drive the dev server with
[agent-browser](https://github.com/vercel-labs/agent-browser): `test/ab-shot.sh` renders an
on-demand frame (`?test`) and screenshots it, and `test/ab-lib.sh` has helpers for projecting
world points to the screen and sending real mouse input.

MIT licensed.
