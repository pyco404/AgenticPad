# True 3D structures and living water (prototype)

**Status: prototype, 2026-10-12, uncommitted, awaiting visual approval.** Four structures are real 3D
models; everything else is still pictures on fixed planes ([world-directional-assets.md](world-directional-assets.md)).
Water moves everywhere. Nothing else is migrated.

Compare in the browser: `/?solid=0` shows the four structures' original pictures, `/?water=0` the still water.

## What is 3D

| Structure | World object | Reference art | Triangles |
| --- | --- | --- | --- |
| Normal house | gold cottage `dress-house-yellow` at (230, 1076) | `cottage-gold.png` | ~460 |
| Special building | Hall of Fame (`site:library`) | `hall-of-fame.png` | ~340 |
| Market stall | `market-blue` at (1250, 1415) | `market-blue.png` | ~230 |
| Notice board | Notice Board (`site:board`) | `leaderboard.png` | ~120 |

Each is one physical model on fixed local axes (x right, y front, z up), built once and shared
(`web/lib/world/solid-models.ts`). Walls, foundations, roofs with real thickness and overhang,
gable ends, chimney, dormer, posts, canopy, counter, crates, barrel, the board's panel with its
edge thickness, braces and roof. Doors, windows, banners, produce and the board's display are the
reference art's own pixels, cut out and laid on the walls; the same window continues on the sides
and back. The camera only changes uniforms: rotating never rebuilds geometry.

## How it is drawn

- **WebGL2, no library.** One small program; `web/app/village/game/solid-renderer.ts`.
- **Projection.** The vertex shader is `project()`'s own orthographic basis, so a 3D model lands on
  exactly the pixels the 2D world expects, and clip depth is distance toward the camera.
- **Pixel look.** One 256-pixel atlas (`solid-materials.ts`): surfaces cut from the art where a clean
  patch exists (thatch, crate wood, the board's roof), else drawn in palettes sampled from it
  (plaster, coursed stone, clay tiles, planks, striped canvas). `texelFetch`, nearest, no
  antialiasing; surfaces tile mirrored at the source picture's own pixel size; light in eight steps
  from the south-west, as the art is lit. Cut-out decals discard below half alpha.
- **Grounding.** Each model casts a flat shadow, written once per pixel so overlaps do not darken.
- **Fitting into the 2D world.** A 3D model is an ordinary painter layer with bounds and depth, so
  agents pass in front of and behind it exactly as they do any building. All visible models render
  in one pass per camera change and are read off the GPU once into a 2D cache; frames between
  camera changes only blit from it.
- **Draw calls.** Two per visible model per camera change (shadow, model), one GPU read per
  camera change, none while the camera is still.

## Water

`web/app/village/game/solid-water.ts`: one full-screen fragment pass a frame on its own canvas,
stacked by the page between the ground canvas and the scenery canvas, so nothing is read back
and bridges, piers, banks and trees stay over it.

- **Where the water is** comes from the ground image's own blue pixels, measured once into a mask
  at 4 world units a texel: bridge decks, banks and piers are excluded by what they are.
- **River:** streaks three to five cells long moving downstream along `riverCentre`'s own tangent
  (north, into the lake), each lane its own pace, faster mid-stream and up to 1.7x through the
  crossings; dark troughs behind some streaks; foam flicker on the banks.
- **Ponds, the lake and the sea:** slow drifting glints, an occasional sparkle, ripple rings that
  spread and fade.
- Every effect is decided per 4-unit cell on the ground plane, so it reads as crisp pixels at any
  zoom and keeps moving while the camera turns. Night tints it with everything else.
- **Elevation-ready:** a stretch is identified in the shader by region; a stream or a fall with its
  own surface height and flow is another region, not a new system.

## Layers

The world canvas is now a stack the browser composites: ground (baked per camera change), water
(per frame), scenery and agents (main canvas, baked scenery plus live actors), the night's tint
(`mix-blend-mode: multiply`), labels. Pointer input still goes to the main canvas.

## Performance

Measured with `scripts/profile-world-rotation.mjs` on this machine's Intel UHD 620 (headless Chrome,
`--use-angle=gl`), continuous 360° rotation, the full world (8,542 objects, 7,388 trees):

| 1,000 agents | Mean frame | p95 | Paint interval | Heap |
| --- | --- | --- | --- | --- |
| Before (HEAD 3a6a7e1) | 91 ms | 148 ms | 139 ms (~7 fps) | 37-40 MB |
| Now, 3D prototypes and water on | 57 ms | 77 ms | 74 ms (~13.5 fps) | 34-37 MB, flat |

Most of the gain is the renderer, not 3D: objects no longer keep a raster canvas each that grew
with every pose (~180 rebuilt per rotating frame before, ~14 tree templates now); the scenery is
baked once per camera change and between changes only the layers that overlap an agent are drawn
again.

An earlier version copied each 3D model and the water from WebGL into the 2D canvas every frame;
each copy made the GPU finish the 2D canvas's pending work, and at 1,000 agents that cost 50 ms a
frame. Hence the batch and the stacked water canvas.

## Can this carry the whole village?

The models, materials and shaders can. The hybrid compositing cannot, past a few dozen models:
every 3D structure is still read back into the 2D painter so agents can pass behind it. For the
full migration:

1. **All scenery in WebGL, one depth buffer.** Buildings, props and trees as instanced draws: one
   mesh per kind, a per-instance buffer of position and orientation, one draw call per kind
   (a few dozen in all) instead of thousands of canvas draws. Depth replaces the painter sort.
2. **Agents into the same pass** as depth-tested camera-facing quads (their facing is already
   world-relative, `lib/world/facing.ts`), so occlusion is per pixel and nothing is read back.
3. **Trees:** a small family of instanced crossed-plane or low-poly canopies with one atlas;
   frustum culling by chunk; at far zoom, a cheaper canopy.
4. **The Arena next,** on the same builder: wall ring, stands, gates and floor as real geometry.

Until then the prototype stays limited to these four, and every other structure keeps its picture.
