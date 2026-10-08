# Six views of one field

The `/field` selector offers Top, Isometric, Front, Back, Left and Right without
navigating or restarting the village. Top remains the default and uses the
existing Phaser art, camera, selection, building cards, navigation and matches.
Returning to Top restores its camera. Each alternate view retains its own pan
and zoom while the field stays mounted. The selector is confined to `/field`;
the dedicated `/agent` camera keeps its existing follow behavior.

## Shared spatial model

`web/lib/world/model.ts` assembles the existing layout into `WorldModel`. It
does not author another map. Its inputs are the existing town, road, landscape,
garden, prop, water and growth definitions, the imported map, and actual loaded
sprite-frame dimensions. `prepareWorldMap` produces exactly the previous
lake/river/ocean tile recipe, world bounds and roads. `createWorldModel` applies
the existing scenery exclusion rules once, deriving the same canopy lots used
by Top and forest generation.

The model includes the exact Top recipes (`map`, `sites`, `pieces`,
`districtPieces`, `lots`, `hiddenRoads`) alongside spatial `objects`:

- Bounds are the existing `WORLD`, including negative coordinates. The raised
  display slab is 120 world units deep; this is presentation, not new terrain.
- Roads retain their sampled center lines and widths, shared with the Roads graph.
- Water comes from uncovered wet terrain cells, excluding the dry crossing and
  shoreline overlays. The upper lake and river remain connected. Garden ponds
  use the existing elliptical footprints; the ocean and southern lake use their
  existing tiles.
- The arena uses `COLOSSEUM` and `COLOSSEUM_FLOOR`, including the existing arena
  anchor. Landmark sites, launch feature gates, market stalls, other dressing,
  plazas, garden rails/benches/solar lights and the mountain retain their positions.
- Movement areas include activity destinations, the hidden navigation paths and
  the actual nearest-dry spawn resolved by the scene.
- Opened plot pieces and forest trees are added by `VillageScene.worldSnapshot`.
  It uses the scene's monotonically opened plots and identical `chunkTrees` seed,
  road exclusions, reserved lots and plot clearings. It does not copy the subset
  of trees currently visible to Top's camera. Cleared trees stay cleared.

Objects have stable IDs, a type, render category, ground coordinates, width,
depth, height, elevation, orientation and optional art/label/anchor metadata.
`x` grows east, `y` grows south and `z` grows upward. A spatial object's `x/y`
is its footprint center. Existing building art is anchored at the south-center
foot of its image; `metadata.topAnchor` preserves that original coordinate while
the model converts to a centered footprint. A tree's trunk stays at its original
foot coordinate. Renderer projections never mutate these values.

The original layout modules remain the authored inputs. Add or move content
there, then extend the model/art adapter if introducing a new kind of object;
do not add camera-specific placement arrays. Pure model/projection modules do
not import Phaser, React, wallet code or the backend.

## Projection basis

`web/lib/world/projection.ts` defines the six orthographic transforms. Coordinates
below are projected world units before camera translation and a uniform zoom.

| View | Screen horizontal | Screen vertical | Far-to-near ordering |
| --- | --- | --- | --- |
| Top | `x` | `y` | `y` |
| Isometric | `(x-y)/sqrt(2)` | `(x+y)/sqrt(6)-z*sqrt(2/3)` | `x+y` |
| Front, from south | `x` | `-z` | `y` |
| Back, from north | `-x` | `-z` | `-y` |
| Left, from west | `-y` | `-z` | `-x` |
| Right, from east | `y` | `-z` | `x` |

Opposite elevations mirror the horizontal axis and reverse occlusion without
changing span or vertical scale. Front/Back span the world width; Left/Right
span its depth. Elevations intentionally collapse the viewing axis: two objects
at different distances can overlap at the same screen position. Isometric uses
an orthonormal camera basis, and `unprojectGround` can recover ground coordinates.
`footprint`, `projectedBounds` and `depthOrder` are shared geometry helpers.

`web/app/village/game/projected-art.ts` supplies the alternate renderer and
explicit Isometric/Front/Back/Left/Right entry points. The preserved Top entry
point is `drawMap` plus the existing scene's art layers, now reading the shared
model. Its historical 0.78 floor compression and upright pixel sprites stay in
place. It is not replaced by the simplified alternate art.

The alternate renderer draws the terrain slab and strata, projected road ribbons,
inset water, bridges, depth-sorted structures, arena tiers/arches, tree canopies,
the mountain and small props. Structure faces sort along the camera axis;
height does not incorrectly determine distance. Ground surfaces draw underneath
structures. In side elevations woodland is a translucent context pass behind
structures to reveal the village; structures still sort along the viewing axis.
Landmark labels stagger with leader lines when needed.

## Live scene and controls

`web/app/village/field-views.tsx` owns the selector and an observational Canvas 2D
renderer. The existing `VillageHandle.snapshot()` reads the same live heroes as
Top; it never starts another simulation or generates another roster. Live agents
appear as position dots, with owned agents in gold. These are map markers drawn
above geometry rather than physical character silhouettes.

Drag, wheel, pinch, existing zoom buttons and keyboard arrows/plus/minus work in
alternate views. The canvas's `0` key and Fit world button fit the entire existing
world. Resizing preserves pan/zoom. Top's minimap and object selection return with
Top; the alternate-view caption explains where to open agents/buildings.

Top's WebGL drawing is skipped while an alternate canvas is visible, while its
scene updates, movement, activity routines and match playback continue. Geometry
draws into a cached canvas when the camera or model revision changes; live overlays
refresh at 10 Hz. The forest prepares at most three chunks per snapshot and then
stays cached across direction changes; a caption shows while it is preparing.
Opened plots invalidate that cache so the same clearings apply in every view.
Canvas density is capped at 2. Large changes of population and zooming across a
fully populated world can still cost more than looking at a small district.

## First-version approximations and limits

- Existing sprites do not provide measured 3D meshes. Building width comes from
  loaded art; depth is approximated from width/art height, and vertical height is
  85% of the anchored art height. Flat farm beds stay nearly flat. The shared
  arena wall height and mountain height use their existing geometry. These
  approximations are assigned once, independent of view, without moving Top art
  or changing its collision footprints.
- Alternate buildings use procedural facades, roofs and windows, not newly drawn
  direction-specific sprites. Arena towers/tiers and tree canopy planes are
  stylized. There is no perspective, arbitrary rotation, terrain-height survey,
  terrain editing or new game engine.
- Side water is a schematic cut/profile across the collapsed viewing axis, not
  a claim that every inland water body reaches the outer cliff. Bridges project
  from the existing dry deck cells. Individual tile boundaries remain the existing
  64-unit shoreline resolution.
- Painter ordering is approximate for intersecting large objects. Translucent
  side trees and always-visible position markers prioritize readability. Markers
  do not imply that a character is visible through a wall in Top.
- Fine flowers, masonry pixels, ambient animals/ship animations, solar glow and
  match-table effects remain details of Top's art. Alternate views preserve the
  spatial landmarks and live positions with simplified representations.
- The full-world elevations naturally make village buildings small relative to
  thousands of world units. Zoom preserves the same proportions instead of
  exaggerating their height. This does not promise a fixed frame rate with 1,000
  visible residents on every device.

## Files and validation

New modules: `web/lib/world/model.ts`, `web/lib/world/projection.ts`,
`web/app/village/game/projected-art.ts`, `web/app/village/field-views.tsx`.
Integration: `web/app/shell.tsx`, `web/app/village/game/index.ts`,
`web/app/village/game/scene.ts`, `web/app/village/game/dressing.ts`,
`web/app/village/game/district-scenery.ts`, `web/app/village/game/gardens.ts`,
`web/lib/world/landmarks.ts`. Tests: `test/world-projections.test.ts`.
Documentation: this file and `docs/world-layout.md`.

Run `npm run check` at the root and `npm run typecheck` plus `npm run build` in
`web/`. Where Turbopack cannot bind a worker port, `npm run build -- --webpack`
runs the production build with Next's other supported bundler. Real Postgres,
HTTP integration tests and browser previews need permission to bind local ports
when using a restricted sandbox. The build fetches the existing Google font.

`test/world-projections.test.ts` checks the unchanged tile recipe, roads and
anchors; scenery reservations; wet/dry bridge tiles; stable identities; immutable
projection inputs; opposite-view spans/mirroring; height/direction; isometric
round trips; and depth order independent of height. Existing world, old-town,
arena, movement, population and growth regressions remain applicable. Run the
field suites with `NEXT_PUBLIC_LAUNCHPAD=1` as well as without it.

Browser verification should cover six views without navigation, restoring Top,
switching back to a saved alternate camera, drag/wheel/pinch/keyboard and existing
zoom buttons, Fit world, desktop/mobile resizing, live position changes, opened
plots and the absence of stale projection controls when leaving `/field`.

Validation for this implementation: root `npm run check` passed (11 real-Postgres
tests, then 524 main-suite tests; the duplicate Postgres file is deliberately
skipped in that second pass). Web typecheck and `npm run build -- --webpack`
passed. The eight field suites also passed with launchpad enabled (47 tests).
Desktop/mobile Chrome previews covered all six views, controls, resizing and
returning to Top with 80 fixture residents and 27 opened plots. Live coordinates
continued changing while the Top renderer was hidden. There were no browser
runtime errors or horizontal page overflow. Existing build warnings concern
workspace lockfile inference and Privy's optional Farcaster dependency.
