# Rotate one shared field

The `/field` world supports mouse/touch orbiting and retains Top, Isometric,
Front, Back, Left and Right as fallback buttons. Top remains the default with
its original Phaser art, camera and object interactions. Dragging empty ground
starts the orbit renderer without navigating or restarting the simulation.
The dedicated `/agent` camera keeps its existing follow behavior.

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

## Camera basis

`web/lib/world/projection.ts` accepts the six named projections or a continuous
`{yaw, tilt}` angle. South is yaw zero, east is +90°, north is 180° and west is
-90°. The ground stays fixed while the basis rotates:

```
across = x*cos(yaw) - y*sin(yaw)
along  = x*sin(yaw) + y*cos(yaw)
screenY = along*sin(tilt) - z*cos(tilt)
```

Front/Back/Left/Right look down at 28°, revealing both ground axes instead of
collapsing terrain into elevations. Left and Right use the physical screen-right
axis of a camera standing west/east, so a full orbit never mirrors the map.
Isometric keeps its high-angle basis (yaw 45°, tilt approximately 35.26°).
Top keeps its original top-down projection and Phaser rendering, including its
historical 0.78 floor compression and upright pixel sprites.

`unprojectGround`, `footprint`, `projectedBounds` and `depthOrder` use this same
basis. Depth ordering follows ground distance along the viewing axis, including
the near edge of structures. Trees and buildings draw together with opaque
canopies. `visibility.ts` uses rising sight rays and cross-axis buckets to hide
live agent markers behind scenery, including the hollow Arena. These volumes
are approximations of the procedural shapes, not pixel-perfect 3D meshes.

`projected-art.ts` retains explicit named entry points and draws the terrain slab,
road ribbons, inset water, bridges, structures, Arena tiers, forests, mountain
and props at every angle. Directional framing fills more vertical space;
framing blends continuously toward the high-angle overview. Whole world fits
all outer edges. Labels stagger with leader lines when needed.

## Top is the source of truth

Every other view draws the world Top draws, captured from Top itself rather
than from a parallel layout (`VillageScene.captureTop`). Once Top's fixed
world is drawn, before any agent, forest chunk or boat exists:

- **Ground.** Every visible layer below the standing art (Phaser depth under
  `WORLD.y0`: terrain tiles, roads, plazas, roundabouts, water, river banks and
  bridge decks, ponds, district patches, garden and crossroad beds, flowers,
  market ground, the arena forecourt and every contact shadow) is rendered once,
  through a camera that sees the whole world from above, into one image at half
  resolution. Each view lays that image on the ground plane, so roads, water,
  bridges and forest edges match Top by construction.
- **Standing art.** Every standing picture Top placed (buildings, houses,
  stalls, tents, flags, banners, lanterns, benches, signs, statues, the fountain,
  the mountain, decoration trees) is recorded with its texture, frame, flip,
  natural size and foot. Views draw that exact frame upright on that foot, like
  Top's standees. `standee()` tags the pictures it stretches, so their natural
  proportions are recovered.
- **Drawn as shapes in Top**, and so taken from the same shared definitions:
  the arena (3D, on `COLOSSEUM`), its four gate torches (`ARENA_TORCHES`, which
  Top's `arena.ts` now draws from too) and the garden fences (`GARDEN_RAILS`,
  drawn as rails and posts).
- **Grown plots and the forest** come from the shared generators
  (`plotObjects`, `treeObject`), carrying the same textures, frames and anchors
  Top's `build()` and forest streaming use; flat pieces (plots, yards, planters)
  lie on the ground plane.

Left out on purpose: the arena's own sprite layers (the 3D arena replaces them),
sailing boats, glows and night effects.

Until the ground image is ready (a moment after the scene starts), views fall
back to the model's procedural surfaces and buildings described below.

## Fallback materials

`projected-materials.ts` loads Top's recoloured ground sheet and water texture
and the tree/prop sprite sheets, and `projected-art.ts` keeps procedural
cottages, roads and water, for the moment before Top's capture is ready. The
Arena always uses its 3D form with `ARENA_PALETTE`.

## Live scene and interaction

`field-views.tsx` owns one orbit controller and observational Canvas 2D renderer.
`VillageHandle.snapshot()` reads the same live heroes as Top; there is no second
simulation or roster. Each agent is drawn as its own Top character: the
`Hero` paints itself onto the projected canvas (`Hero.paintTo`, through
`VillageHandle.paintAgent`) from the same portrait views, drawn body, weapon and
sprite-sheet frames Top uses, with Top's walking gait and activity props (crate,
hoe, basket, map, sparring ring, rest mat). The body and prop routines draw
through a small `Painter` interface that Phaser's Graphics and a 2D canvas
adapter (`projected-agents.ts`) both satisfy, so the two views cannot drift apart.
Figures stand upright, without Top's floor compression; owned agents stand on a
gold ring. An agent without a character yet falls back to a dot.

- Primary mouse drag or one-finger drag turns the camera horizontally and tilts
  it vertically. Drag up to look down toward Top. Tilt is limited to 15–90°.
- Eight CSS pixels of movement distinguish dragging from a tap. In Top, Phaser's
  actual interactive hit masks reserve agents and buildings. Shift/middle drag
  explicitly requests camera movement even over an interactive object.
- Wheel, pinch and the existing zoom buttons zoom. Shift/middle drag and focused
  arrow keys pan; plus/minus zoom and `0` reframes. Pointer capture keeps an orbit
  gesture alive outside the canvas, with release/cancel cleanup.
- Gestures begin only on world canvases. Buttons, panels and normal UI controls
  do not start camera gestures. The dedicated Agent route is unaffected.
- Exponential easing smooths yaw/tilt and framing. The chosen angle is retained
  on release; there is no automatic snap. The six buttons provide canonical
  angles, with smooth turns between the projected views.
- Returning to Top restores its saved original camera and interactive art.
  Dragging from Top begins at its current center, scale and floor compression.
  Both renderers use the original building sprites; a short opacity transition
  softens the change in ground projection and restored camera framing.

Top's WebGL drawing is skipped while orbiting, but simulation, movement and
match playback continue. Geometry redraws only for camera/model changes, capped
at 30 Hz during movement; live positions are read at 10 Hz and the figures animate at 20 Hz. Forest preparation is
bounded to three chunks per snapshot and is reused across rotations. Opened
plots invalidate the same cache. Canvas density is capped at 2.

## Projection limitations

- The camera is orthographic, with continuous yaw/tilt and no perspective lens.
  Building depth/height remain the shared approximations derived from existing
  sprite dimensions. No objects or authored coordinates are moved.
- Orbit views show Top's own pictures as upright cut-outs, not 3D models: a
  building seen from behind shows its front art. Open agents and buildings in
  Top as before.
- The captured ground is half Top's resolution, so very close zoom shows it
  coarser than Top. Animated ground (sea waves, river ripples) is frozen at the
  moment of capture; masked sea waves are left out.
- Painter ordering is approximate for overlapping large footprints, and marker
  sight volumes approximate tree foliage and Arena walls. Labels are overlays.
- Fine sprite detail, ambient animals/ships, glow and match-table effects remain
  in Top. The terrain's existing 64-unit shoreline resolution remains visible.
- Framing low angles on a narrow phone crops distant outer edges to show more
  detail; Whole world or zoom out exposes them. Large populations and woodland
  can reduce frame rate on slower devices; 30 Hz is a cap, not a guarantee.

## Validation

Run root `npm run check`, web `npm run typecheck` and
`npm run build -- --webpack` (the supported alternative when sandbox worker-port
restrictions prevent Turbopack). Field suites also run with
`NEXT_PUBLIC_LAUNCHPAD=1`.

`test/world-projections.test.ts` covers unchanged map recipes, coordinates,
anchors and identities, tilted inverse transforms, opposite orientations,
framing, occlusion, arbitrary angle canonical agreement, a complete orbit,
tilt clamps, frame-rate independent easing and the yaw seam, and that grown
plots and forest trees carry Top's own textures, frames and anchors.

Browser verification covers six fallback views, Top tap versus drag, continuous
full rotation, tilt, wheel/pinch, Shift pan, keyboard controls, mobile sizing,
agent/building clicks, live simulation and gesture cleanup outside `/field`.

The completed pass ran root `npm run check` (534 main tests plus 11 real
Postgres tests), web typecheck and the production webpack build. All 45 focused
world suites also passed with `NEXT_PUBLIC_LAUNCHPAD=1`. Browser checks used
80 residents, desktop density 2, and a 390×844 touch viewport. Touch capture
handoff, pinch zoom and starting a new gesture after touch cancellation passed.
