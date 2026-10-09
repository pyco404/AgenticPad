# Fixed world objects and missing directional artwork

Physical scenery now uses fixed local x/right, y/front and z/up axes tied to each object's world orientation. Camera yaw only changes projection and visible faces. Front artwork is attached to the front plane; it is never mirrored onto the back or substituted with another object's art. An optional `directionalAssets` map accepts correct front/back/left/right frames. Existing source-frame flips remain local to their original front artwork.

Geometry is continuous through diagonal angles, so no discrete asset switching occurs. A five-degree dead band is available for future discrete directional sets. Scene source sprites remain hidden capture inputs. Agents keep their independent animation, facing, sprite instances and shared simulation. UI labels and speech remain readable camera-facing UI. Match tables, cards and chips now project from fixed world axes too.

## Temporary geometry

| Category | Missing-art treatment |
| --- | --- |
| Houses | Timber/plaster walls, matching roof colours, side/rear windows and rear access |
| Major landmarks | Material-matched bodies plus landmark-specific towers, extensions, steps or chimneys |
| Shops | Storefront, counter/awning and rear service door |
| Bazaar/market | Open posts, customer counter, canopy and rear storage |
| Signs/Notice Board | Thin sign panel, two posts and plain rear braces |
| Lookout | Posts, raised platform, fixed front ladder and roof |
| Tents | Triangular fabric volume with a front entrance |
| Trees/shrubs | Seeded asymmetric trunk and faceted foliage volumes; no spinning canopy sprite |
| Benches/tables | Fixed seat/back/legs or tabletop/legs |
| Flags/lamps/torches | Pole, cloth, lantern or flame volumes |
| Fountain | Tiered basin, water surfaces and central column |
| Launch Pad | Platform, rocket, fins and gantry |
| Fences/chests/statues/rocks | Category-specific rails, containers or simple decorative volumes |
| Practice dummy/stumps | Wooden training dummy or stump volumes |
| Unknown future props | Own fixed front art on a neutral support, reported for bespoke geometry |
| Arena/bridge/terrain | Existing Arena and bridge geometry, and projected terrain remain in place |

The original source frames may contain transparent padding. Their own opaque pixel bounds now determine rendered proportions and front UV coordinates; model footprints, positions and routing reservations remain unchanged. Picking uses the same projected faces and texture coordinates. Labels follow visible roofs rather than empty source-image padding.

## Complete loaded-asset inventory

Inventory captured from the 100-resident browser fixture. Growth repeats these same asset keys; the raw grouped inventory is [world-directional-assets.json](world-directional-assets.json). A present front means the existing source asset is available, not that it is a newly authored orthographic facade. Geometry-only trees and some props do not need their source silhouette as a directional face.

No authored back, left or right sets were found for these sprite assets. Arena, procedural torches and terrain require geometry rather than new directional artwork. Correct rear/side artwork remains missing for every sprite entry below.

| Type | Existing front asset / landmark | Back | Left | Right |
| --- | --- | --- | --- | --- |
| arena | `site:arena` — Arena | native geometry | native geometry | native geometry |
| bench | `ac-bench` | missing | missing | missing |
| bridge | `ac-pier` | missing | missing | missing |
| chest | `ac-chest` | missing | missing | missing |
| fence | `farm-fence` | missing | missing | missing |
| fence | `fence` | missing | missing | missing |
| fire | `effects-fire-fire` | missing | missing | missing |
| fire | `torch` | missing | missing | missing |
| flag | `ac-banner` | missing | missing | missing |
| flag | `ac-banner-fame` | missing | missing | missing |
| flag | `ac-banner-gold` | missing | missing | missing |
| flag | `ac-flag` | missing | missing | missing |
| fountain | `dress-fountain` | missing | missing | missing |
| house | `building-alchemist` — Rulebook House | missing | missing | missing |
| house | `dress-house-blue` | missing | missing | missing |
| house | `dress-house-red` | missing | missing | missing |
| house | `dress-house-yellow` | missing | missing | missing |
| house | `growth-apartments` | missing | missing | missing |
| house | `growth-house-a` | missing | missing | missing |
| house | `growth-house-b` | missing | missing | missing |
| house | `growth-office` | missing | missing | missing |
| lamp | `dress-solar-lamp` | missing | missing | missing |
| launch-pad | `building-launchpad` — Launch Pad | missing | missing | missing |
| major-building | `building-castle` — Strategy Lab | missing | missing | missing |
| major-building | `building-chapel` — Treasury | missing | missing | missing |
| major-building | `building-forge` — Game Hall | missing | missing | missing |
| major-building | `building-library` — Hall of Fame | missing | missing | missing |
| major-building | `building-tavern` — Hiring Hall | missing | missing | missing |
| market | `building-bazaar` — Bazaar | missing | missing | missing |
| market | `market-blue` | missing | missing | missing |
| market | `market-red` | missing | missing | missing |
| miscellaneous | `ac-dummy` | missing | missing | missing |
| miscellaneous | `stump-3` | missing | missing | missing |
| miscellaneous | `stump-4` | missing | missing | missing |
| mountain | `wild-mountain` — Mountain | missing | missing | missing |
| rock | `ac-coins` | missing | missing | missing |
| rock | `ac-log` | missing | missing | missing |
| rock | `farm-pumpkin` | missing | missing | missing |
| rock | `prop-gold` | missing | missing | missing |
| shop | `growth-kiosk` | missing | missing | missing |
| shop | `growth-shop` | missing | missing | missing |
| shop | `village-smithy` | missing | missing | missing |
| shrub | `bush-1` | missing | missing | missing |
| shrub | `bush-2` | missing | missing | missing |
| shrub | `bush-4` | missing | missing | missing |
| sign | `ac-hiring-board` | missing | missing | missing |
| sign | `ac-scoreboard` | missing | missing | missing |
| sign | `ac-strategy-board` | missing | missing | missing |
| sign | `building-board` — Notice Board | missing | missing | missing |
| statue | `ac-statue` | missing | missing | missing |
| statue | `ac-trophy` | missing | missing | missing |
| table | `ac-war-table` | missing | missing | missing |
| tent | `ac-tent` | missing | missing | missing |
| tower | `building-watchtower` — Lookout | missing | missing | missing |
| tree | `resources-trees-tree` | missing | missing | missing |

## Current limits and follow-up art

Rear/side models are temporary geometry, not finished pixel-art directional packs. The existing front pictures include perspective and cannot supply accurate hidden architectural details. Treasury, Hall of Fame, Strategy Lab, Game Hall, Hiring Hall, Rulebook House, shop/storefronts and the Lookout need their own authored directional facades or richer bespoke meshes for exact fidelity. Market canopies, tent fabric, foliage, fountain and rocket surfaces would benefit from their own materials/geometry detail. Decorative animal, statue, rock and miscellaneous volumes are deliberately simple.

No unintended physical billboard remains in the migrated render path. Front planes becoming thin edge-on is expected physical projection, not a visibility switch. Flags are thin cloth. Shadows/glows captured into the terrain and readable UI overlays are not directional scenery. Arena geometry, entrance and faded floor logo are unchanged.

## Validation

- Full 360-degree orbit of 14 representative categories, with fixed meshes, valid projected vertices, stable agent instances and screenshots of each side.
- Browser movement/occlusion/zoom/rotation/tilt/route checks with 100 and 1,000 agents; no missing paints, remounts or texture fallbacks.
- Root and web typechecks and production build passed. Desktop/mobile shell tests passed camera persistence, touch controls, route overlays and wallet fixture continuity.
- Unit coverage for fixed match-table vertices, cardinal orientation, boundary dead band, correct face assets, no front-art reuse on rear/sides, opaque-frame proportions, picking, town layout and simulation routes.

Run `node scripts/check-world-objects.mjs` against a local web server to regenerate the detailed runtime inventory and screenshots in `/tmp/oxude-world-objects`.

## Files changed

- `web/lib/world/model.ts`: optional appearance/directional assets and source-frame content bounds.
- `web/lib/world/object-appearance.ts`: object classification, fixed orientation, optional side selection and inventory.
- `web/lib/world/object-geometry.ts`: stationary object-specific meshes and visible-face projection.
- `web/lib/world/object-materials.ts`: shared existing material palette.
- `web/lib/world/picking.ts`: mesh-based hit testing and matching front UV sampling.
- `web/app/village/game/fixed-world-art.ts`: cached mesh rasterization and fixed-face texture mapping.
- `web/app/village/game/projected-art.ts`: replace upright scenery sprite painting with fixed meshes.
- `web/app/village/game/projected-materials.ts`: use the shared material palette.
- `web/app/village/game/scene.ts`: cache source pixel bounds and provide table projection callbacks.
- `web/app/village/game/table.ts`: fix table/card/chip world orientation.
- `web/app/village/world-camera.tsx`: project physical tables and anchor labels to visible roofs.
- `test/world-orientation.test.ts`, `test/field-camera.test.ts`, `web/test/world-table.test.ts`: orientation, asset ownership and geometry-based picking coverage.
- `scripts/check-world-objects.mjs`, `scripts/check-world-agents.mjs`: full-orbit visual audit and physical occlusion regression.
- `docs/world-directional-assets.md`, `docs/world-directional-assets.json`: this report and complete grouped loaded-asset inventory.
