# Edit consistency and editable grotto terrain

## Decisions

Keep the plain World model and procedural mesh builders. Concentrate gesture history in an
Edits module with begin, commit, cancel, undo and redo. A gesture remains provisional until
commit; cancellation restores its snapshot. No-op gestures preserve redo. App connects this
module to mesh invalidation, deferred scatter work and persistence.

Validate an entire save in temporary data before replacing the live world. Check the version,
grid, buffer sizes, record values, unique IDs and walkway references. Preserve unreadable
browser saves in a recovery key before allowing them to be overwritten. Failed storage writes
must be visible to the user.

Terrain beneath a grotto remains editable. Store base terrain independently of derived grotto
caps. Surface queries combine the base and active caps; terraform tools read and write the base.
Moving, resizing or deleting a grotto recomputes caps instead of restoring stale height backups.
Version 2 saves contain base terrain. Migrate version 1 saves using their stored original levels.

Walkway splits preserve width, style and rails. Starting a branch on an existing edge and then
abandoning it restores the original graph. Graph edits are validated before commit. Panel node
and edge edits use the same walkway settling rules as drags.

## Verification

Use Node model tests for save atomicity, history, graph integrity, migration and terrain
ownership. Use the browser suites for cancellation paths, edit previews, paint/scatter
invalidation, real persistence, house handles and landmark placement. Render each suite on
forced WebGL and automatic backend selection, reporting the backend actually selected.
Collect warmed rebuild timings before making larger rendering changes. Cache unchanged boats
across unrelated structure rebuilds.

## Remaining scale limits

Static structures still merge into one geometry. Terrain edits still invalidate all grounded
structure caches, and graph adjacency queries still scan edges. Measure larger coves before
adding spatial indexing or chunked meshes. Neither requires changing the saved World model.
