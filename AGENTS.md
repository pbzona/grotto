# Working on Grotto

Keep the saved world and the player-facing editor stable while changing the game. Read `README.md` for run instructions and the save/edit behavior before touching those areas.

## Follow the change through

- `src/world.ts` owns persisted records, terrain queries, save validation and migration. Treat version 2 saves as a compatibility contract. New saved fields need validation and round-trip tests; derived state stays out of saves.
- `src/house-model.ts`, `src/house-ops.ts`, `src/walkway-rules.ts`, `src/placement.ts`, `src/world-ops.ts`, `src/seed.ts` and `src/random.ts` hold rules that can run in Node. Keep runtime imports from this group independent of Three.js, DOM, `App`, and the mesh builders. Use `import type` for type-only imports and `.ts` on local imports so Node's native TypeScript test runner can load them.
- `src/houses.ts`, `src/walks.ts`, `src/landmarks.ts`, `src/props.ts`, and `src/shops.ts` build geometry. When changing a building, align its model footprint, entrance, collision and preview with its mesh and picking owner. Dock landings extend beyond edge centrelines: check `shopNodeClash` and `landmarkClash` in both placement orders, while leaving the intended shop doorway connection possible.
- `src/tools.ts` owns pointer gestures, picking and ghosts; `src/ui.ts` owns controls. Put player edits behind a named `WorldOps` operation. Build and validate a candidate before replacing a record in its map; preserve old records for callers holding references. Return a rejection reason without changing the world, or return a `WorldChange` and pass it to `App.recordChange` so carving, rendering, navigation resync and saving see the change. Internal terrain buffers, mesh caches and generation remain mutable for performance. Walkway clicks plan a `WalkTarget` in `Tools`, then `WorldOps.startWalk` / `connectWalk` own pending posts, splits, settling and rejection. Extension handles use `previewExtension` / `finishExtension`. Keep graph writes and validation in model operations when changing walkway gestures.
- `src/edits.ts` owns gesture history. Begin before the first change, preview within one gesture, then commit once or cancel. Test undo, redo, cancellation and invalid placement when changing an edit path.
- `src/app.ts` coordinates rebuilding, caches, persistence and history; `src/main.ts` wires the frame loop. Keep geometry and browser state out of model rules. App's small `WorldOps` forwarding methods are retained for browser tests and older call sites.

## Verify

Run `npm run check` after code changes. Run `npm run test:browser` after changes to tools, UI, generation, geometry, saves or rendering; it exercises both forced WebGL and automatic backend selection. Add Node tests in `test/*.test.ts` for model rules and browser assertions in `test/*.js` for pointer, preview and visual behavior. Generated-world tests should use representative seeds and check invariants rather than generated IDs.

Leave unrelated files alone. Keep commits small, with short messages and no coauthor lines.
