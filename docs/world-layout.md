# Organic field layout

The field keeps its Phaser scene, world coordinates, building IDs and assets. The Arena remains at `(1400, 975)`. The two enclosing octagonal roads and rectangular Arena road have been removed.

## Districts

- The Arena, Notice Board, fountain and small market clearing form the town core.
- Strategy Lab sits west beside crop beds, the training yard and camp paths.
- Hiring Hall and cottages sit southwest near the western market lane to Bazaar.
- Hall of Fame, Treasury and Lookout occupy uneven northern sites, separated by trees and a pond.
- Game Hall, riverside cottages and workshops lead to the eastern bridge and Launch Pad.
- Rulebook House stands by the southern gardens, with a winding lane leading out to the lake.

Six winding country lanes branch away from town. They stop within wilderness instead of outlining the map edges. All streets, trails and plazas share the grey stone colour and texture; their widths still vary. Ponds, the river, western ocean, small mountain, woods and farm beds break up the grass. Forest clearing strength now changes gradually with distance and direction.

## Movement and expansion

`curvedPath` samples road bends into shared world coordinates. Rendering and the existing Roads graph consume those same points, so walking does not follow a different curve from the picture. Junctions share vertices; door spurs split the nearest lane where they join. An already connected door needs no extra spur. Local street circuits give agents alternate routes without forming a world perimeter.

The existing ground routing, Arena gates and match positions remain in place. Zoom, pan, spawning, agent selection, Find My Agent, building cards, labels and responsive sizing retain their existing implementations. Wallet, holder eligibility, autoplay, matches and payouts are unchanged.

Growth uses seeded irregular neighbourhood clearings instead of rows along rings. Plot thresholds, stable IDs within the new plan and monotonic opening behavior remain. Plots avoid streets, rivers, ponds, fixed landmarks and each other. The legacy `INNER` and `OUTER` region constants remain as invisible expansion/camera/forest boundaries; they are not rendered roads.

## Changed files

- `web/app/village/game/world.ts`: country lanes, sampled curves, shared junctions and door spurs.
- `web/app/village/game/town.ts`: landmark positions, streets, trails, plaza and destinations.
- `web/app/village/game/map.ts`: consistent grey stone streets and country paths.
- `web/app/village/game/pieces.ts`: relocated props, cottages, workshops and farm beds.
- `web/app/village/game/dressing.ts`: market clearing and plaza dressing.
- `web/app/village/game/gardens.ts`: shared pond footprints and relocated fountain stonework.
- `web/app/village/game/landmarks.ts`: scenic footprints shared by growth and navigation.
- `web/app/village/game/growth.ts`: irregular expansion plots and scenery clearance.
- `web/app/village/game/forest.ts`: gradual irregular clearing density.
- `test/world.test.ts`: connected winding routes, open boundaries and building clearance.
- `test/old-town.test.ts`: landmark contracts, entrance access and alternative routes.
- `test/growth.test.ts`: pond clearance alongside existing expansion checks.
- `test/duels.test.ts`: agents meet on the nearest path without assuming a straight high street.
- `test/fixtures/old-town.json`: the intentionally redesigned landmark/prop layout. Road geometry is checked by navigation tests rather than a large sampled-point snapshot.
- `docs/world-layout.md`: this explanation.

## Validation

Run the six field-related suites with launchpad disabled and enabled:

```sh
npm exec vitest run test/village.test.ts test/world.test.ts test/old-town.test.ts test/village-landscape.test.ts test/growth.test.ts test/duels.test.ts
NEXT_PUBLIC_LAUNCHPAD=1 npm exec vitest run test/village.test.ts test/world.test.ts test/old-town.test.ts test/village-landscape.test.ts test/growth.test.ts test/duels.test.ts
```

Also run root and web typechecks and the web production build. Browser previews cover desktop, maximum zoom out, dragging, mobile resizing and a simulated agent roster. No standalone lint script is configured in this project.
