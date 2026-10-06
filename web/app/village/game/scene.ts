// Adapted from Agent Quest (MIT, see ./LICENSE).
import * as Phaser from "phaser";
import { inMatch, type Place, type Resident } from "../residents";
import { duelPhase, meetingSpot, pathSpots, ringsInFull, WATCH_RADIUS, type Spot } from "./duels";
import { Building, type BuildingLabel } from "./building";
import { Ground } from "./ground";
import { byGardenPond, drawGardens, GARDEN_PONDS } from "./gardens";
import { byLandscape, LANDSCAPE_BOXES, MOUNTAIN_BOXES, oceanTerrain } from "./landscape";
import { drawScenery } from "./scenery";
import { Hero } from "./hero";
import { CardTable } from "./table";
import { drawDressing, drawSolarLights, loadDressing, overRoad } from "./dressing";
import { loadShips, sailShips } from "./ships";
import { drawArena, loadArena, type ArenaHandle } from "./arena";
import { ARENA_FIELD, GROUNDS, HIDDEN_ROADS, inTown, lots, NEW_TOWN_SITES, RESERVED, ROADS, SITES, SQUARE, stands, townBounds } from "./town";
import { CROSSROADS, inNewTown, onOldGround, PIER, WORLD } from "./world";
import { nightOf, num, VOID, warm } from "./palette";
import { chunkKey, chunksIn, chunkTrees, CHUNK, type ForestRules, type Tree } from "./forest";
import { loadWeapons, weaponOf } from "./weapons";
import { drawMap, loadMap, type VillageMap } from "./map";
import { canopy, NEW_TOWN, openPlots, overlaps, PIECE_ART, plotClearing, type Box, type Plot } from "./growth";
import { Roads, type Point } from "./roads";
import { referenceArt } from "./reference-art";
import { byRiver, RIVER_BANKS, riverTerrain } from "./river";
import { drawRiver } from "./river-scenery";
import { crispText, MONO } from "./text";
import { layOutNames, type NameLabel } from "./labels";
import { playhead } from "@/lib/playhead";
import { sound } from "@/lib/sound";
import { bodyColours, GRID_LARGE, pixelate, portraitUrl, turned } from "@/lib/pixel-portrait";

/** A match being played in the arena: its two sides, the table between them, the running score over it, and the timer that drives both. */
type Brawl = { a: string; b: string; score: Phaser.GameObjects.Text; table: CardTable; ticker: Phaser.Time.TimerEvent };

/**
 * A match out in the village (duels.ts): where its two sides meet, the ring
 * drawn there, when both had arrived - the replay runs from then - and
 * whether its ring is one of those drawn in full.
 */
type Duel = {
  spot: Spot;
  /** The ring and its far-off marker; neither for the Arena's match, which has the Arena. */
  ring: Phaser.GameObjects.Graphics | null;
  marker: Phaser.GameObjects.Text | null;
  metAt: number | null;
  full: boolean;
  /** The Arena's one match (arena.ts), and its match id: the shell is told when it has played out. */
  arena: string | null;
};
/** What the scene keys a match's playing by: the Arena's showing of it, or the match. */
const keyOf = (m: { id: string; key?: string }) => m.key ?? m.id;
/** A ring's size on the ground, round the two sides and the table between them. */
const RING = { width: 156, height: 48 };
/** No ring goes this close to a building's door, where its agents queue. */
const DOOR_CLEARANCE = 120;

/** Agent Quest's own hero size; the map's saved 0.4 leaves them too small to tell apart. */
const HERO_SCALE = 0.55;
/** Space between heroes waiting at a hall. */
const GRID_X = 50;
const GRID_Y = 42;
/** A match takes two spots facing each other, this far apart. */
const PAIR_GAP = 72;
/** The Arena's one match stands in the middle of the sand (town.ts); a replay's stand-ins come in by the south gate. */
const ARENA_SPOT = { x: ARENA_FIELD.x, y: 820 };
const ARENA_GATE = { x: ARENA_FIELD.x, y: 1010 };
/** How long an agent called to a match takes to get there, from wherever it is. */
const ARRIVE_MS = 2500;
/** How far a drag goes before it is a drag and not a tap. */
const DRAG = 8;

/** A stroll is an amble, not an errand: this share of walking speed. */
const STROLL_PACE = 0.7;
/** How long a waiting agent stands at its hall before it might wander, and how long it lingers where it went. */
const AT_HOME_MS: [number, number] = [2_000, 8_000];
const AWAY_MS: [number, number] = [6_000, 14_000];
/** The chance, each time it has stood a while, that it goes for a stroll rather than staying put. */
const STROLL_CHANCE = 0.7;
/** A stroll's end: the agent grounds at the edge of town this often; of the rest, the lake shore this often, anywhere else in the world otherwise. */
const GROUNDS_CHANCE = 0.4;
const SHORE_CHANCE = 0.15;
/** Of all strolls, this share go down the south road to the dock; of those, this share go in for a swim. */
const DOCK_CHANCE = 0.25;
const SWIM_CHANCE = 0.6;
/** Swimming is slower than walking; a swim is a few strokes out and about before climbing back out. */
const SWIM_PACE = 0.35;
const SWIM_LEGS: [number, number] = [2, 4];
/** How far out from the dock a swimmer goes: close enough to be watched from the shore. */
const SWIM_REACH = 200;
/** Within this of a road, a walk keeps to the roads; beyond it, it crosses open ground. */
const NEAR_ROAD = 110;
/** The widest the camera ever looks, in world pixels: the world runs on much further than anyone needs to see at once. */
const MAX_VIEW = 5200;
/** How far past the camera's view the forest is made, and how far before it is destroyed again, in chunks. */
const FOREST_NEAR = 1;
const FOREST_FAR = 2;
/** How many of the forest's chunks are made in one frame, at most. */
const FOREST_PER_FRAME = 4;
/** How far below its chunk a tree's canopy can still show: a tree's foot is its lowest point, its crown well above. */
const FOREST_REACH = 140;
/** How far the forest's canopies keep off a road's edge. */
const FOREST_VERGE = 10;

const between = ([lo, hi]: [number, number]) => lo + Math.random() * (hi - lo);

/** How long a structure takes to rise when it opens while someone is watching, and how long its builder stays at it. */
const RISE_MS = 6_000;
const BUILD_MS = 18_000;

const COLOUR = { text: "#ede6d6", accent: "#e8b84b", live: "#6f9e5c", loss: "#d4745a", muted: "#a79f90" };

export type VillageEvents = {
  ready: () => void;
  selectAgent: (id: string | null) => void;
  selectBuilding: (id: string) => void;
  /** The Arena's match, by id, has played out in full. */
  arenaDone: (matchId: string) => void;
};

export type SceneOptions = {
  base: string;
  buildings: BuildingLabel[];
  still: boolean;
  /** The CSS font-family of the HUD's pixel face, for building names. */
  nameFont: string;
  events: VillageEvents;
};

/** The render scale the game runs at: the canvas is sized in physical pixels and zoomed back down. */
export const renderScale = (scene: Phaser.Scene) => (scene.game.scale.zoom > 0 ? 1 / scene.game.scale.zoom : 1);

export class VillageScene extends Phaser.Scene {
  private roads!: Roads;
  private doors = new Map<string, Point>();
  private buildings = new Map<string, Building>();
  private notes: Record<string, { text: string; lively: boolean }> = {};
  private night: Phaser.GameObjects.Rectangle | null = null;
  private isNight = false;
  private solarLights: { setNight: (on: boolean) => void } | null = null;
  private arena: ArenaHandle | null = null;
  /** Whether someone has panned or zoomed since the village was last framed: a resize then keeps their view. */
  private moved = false;
  private heroes = new Map<string, Hero>();
  private residents = new Map<string, Resident>();
  /** Who is at each place, in the order they arrived, so a newcomer joins the end rather than reshuffling everyone. */
  private order = new Map<Place, string[]>();
  /** Where each hero was last sent, so an update only moves those whose spot changed. */
  private targets = new Map<string, string>();
  private ground!: Ground;
  /** Where retiring agents leave and new ones arrive: the map's own spawn point is in the lake, so the dry ground nearest it. */
  private gate: Point = { x: 0, y: 0 };
  /** Each waiting agent's spot at its hall, which it walks back to after a stroll. */
  private home = new Map<string, Point & { facing?: "left" | "right" }>();
  /** Agents out on a stroll, and the timers that move each one along its routine. */
  private strolling = new Set<string>();
  private routine = new Map<string, Phaser.Time.TimerEvent>();
  /** The dock at the end of the south road, and the open water near it that swimmers make for. */
  private dock: { x: number; y: number; halfWidth: number; halfHeight: number } | null = null;
  private swimSpots: Point[] = [];
  /** Where a stroll may end: the village and the forest's near edge. */
  private strollable: Point[] = [];
  /** The forest's chunks now made, each its trees and the sprite drawn for each (forest.ts). */
  private chunks = new Map<string, { tree: Tree; sprite: Phaser.GameObjects.Image }[]>();
  private forestRules: ForestRules | null = null;
  private forestAt = "";
  private pending: Resident[] | null = null;
  /** The map's trees, so the village can clear them as it grows (growth.ts). */
  private trees: { d: { k: string; x: number; y: number; s: number }; sprite: Phaser.GameObjects.Image | Phaser.GameObjects.Sprite }[] = [];
  /** Which trees have been taken down, and which plots stand. */
  private cleared = new Set<number>();
  private grown = new Set<string>();
  /** The holder count, once known; held until the scene exists. */
  private holders: number | null = null;
  /** Whether the village has been drawn at a count yet: only plots opening after that go up in front of the watcher. */
  private grownOnce = false;
  private placed = false;
  private selected: string | null = null;
  private dragged = false;
  /** How much of the canvas the bar and the page panel cover, in CSS pixels: the village is framed in the rest. */
  private inset = { top: 0, right: 0, bottom: 0 };

  constructor(
    private map: VillageMap,
    private opts: SceneOptions,
  ) {
    super({ key: "village" });
  }

  preload(): void {
    this.load.setPath(`${this.opts.base}/`);
    // The map's own buildings are not loaded: the town's plan (town.ts) says how each is drawn.
    loadMap(this, { ...this.map, textures: this.map.textures.filter((t) => !t.key.startsWith("building-")) });
    this.load.setPath("");
    for (const b of this.opts.buildings) {
      const site = SITES[b.id];
      if (!site) continue;
      const art = b.id === "arena" ? `${site.art}?v=agp-logo-1` : referenceArt(site.art);
      if (site.sheet) this.load.spritesheet(`building-${b.id}`, art, { frameWidth: site.sheet.width, frameHeight: site.sheet.height });
      else this.load.image(`building-${b.id}`, art);
    }
    loadDressing(this);
    // What the village grows with: New Town's buildings, lamps and planters (growth.ts).
    for (const image of new Set(NEW_TOWN.plots.flatMap((p) => p.pieces.map((x) => x.image)))) {
      const key = `growth-${image}`;
      const size: { src: string; width: number; height: number; frames?: number } = PIECE_ART[image];
      if (size.frames) this.load.spritesheet(key, warm(size.src), { frameWidth: size.width, frameHeight: size.height });
      else this.load.image(key, referenceArt(warm(size.src)));
    }
    loadArena(this);
    loadWeapons(this);
    loadShips(this);
  }

  create(): void {
    // Water is real terrain: navigation treats the ocean as wet ground.
    const scenicTerrain = [...oceanTerrain(), ...riverTerrain()];
    const scenicTiles = new Set(scenicTerrain.map(([c, r]) => `${c},${r}`));
    this.map = { ...this.map, terrain: [...this.map.terrain.filter(([c, r]) => !scenicTiles.has(`${c},${r}`)), ...scenicTerrain] };
    this.cameras.main.setBackgroundColor(VOID);
    // The dressing (dressing.ts), then the map with the town's roads (town.ts) in place of its own: its
    // forest, less what stands where the town is - its buildings, their props, its roads.
    const { solids, placed } = drawDressing(this, this.opts.still);
    const taken = lots(placed);
    this.trees = drawMap(this, {
      ...this.map,
      paths: ROADS,
      decorations: this.map.decorations.filter((d) => stands(d, taken) && !overRoad(d, ROADS) && !byGardenPond(d) && !byLandscape(d) && !byRiver(d)),
    });
    drawGardens(this, taken);
    drawScenery(this, this.opts.still);
    drawRiver(this, this.opts.still);

    for (const def of this.opts.buildings) {
      const site = SITES[def.id];
      if (!site) continue;
      const click = () => {
        if (!this.dragged) this.opts.events.selectBuilding(def.id);
      };
      const building = new Building(this, def, site, click, this.opts.nameFont, this.opts.still);
      this.doors.set(def.id, building.door);
      this.buildings.set(def.id, building);
    }
    this.roads = new Roads(
      [...ROADS.map((p) => p.points.map(([x, y]) => ({ x, y }))), ...HIDDEN_ROADS],
      [...this.doors.values()],
    );
    // A building is solid as its picture's box, but the arena as its walls: agents fight inside it.
    const footprints = [...this.buildings].filter(([id]) => !SITES[id]?.blocks).map(([, b]) => b.footprint);
    const blocks = Object.values(SITES).flatMap((s) => s.blocks ?? []);
    this.ground = new Ground(this.map, [...footprints, ...solids], [...blocks, ...GARDEN_PONDS, ...MOUNTAIN_BOXES], RESERVED);
    // Where a match out in the village may meet: along every path.
    this.ringSpots = pathSpots(ROADS);
    // Open ground for a ring when the paths are full: Old Town's and New Town's, not the Wilds'.
    this.ringClearings = this.ground.anywhere.filter((p) => inTown(p) || inNewTown(p));
    // Every safe open tile is a destination, including the world's far edges.
    this.strollable = this.ground.anywhere;
    this.gate = this.ground.nearestDry(this.map.spawn);

    // The pier on the small lake out in the Wilds (world.ts): strollers walk out to its end, and some swim off it.
    this.dock = { x: PIER.x, y: PIER.y + 20, halfWidth: 22, halfHeight: 70 };
    this.swimSpots = this.ground.water.filter((p) => Math.hypot(p.x - PIER.x, p.y - PIER.y) < SWIM_REACH && p.y > PIER.y + 40 && !this.onDock(p));

    // One sailboat on the lake, clear of the pier.
    sailShips(this, this.ground, { count: 1, still: this.opts.still, moored: null, rocks: [], dock: PIER });

    // The forest beyond Old Town (forest.ts): made a chunk at a time round the camera, and destroyed away from it.
    this.forestRules = {
      inOldTown: (p) => onOldGround(p),
      // A small verge either side of every road, so the forest reads as cut back from it.
      onRoad: (p, s) => overRoad({ k: "tree", x: p.x, y: p.y, s }, ROADS, FOREST_VERGE) || CROSSROADS.some((c) => Math.hypot(c.x - p.x, c.y - p.y) < 110),
      taken: [...taken, ...this.newTownLots(), ...GARDEN_PONDS, ...LANDSCAPE_BOXES, ...RIVER_BANKS],
      cleared: [],
    };
    this.events.on("update", () => this.tendForest());

    // Night: the palette's own (palette.ts nightOf) - every colour multiplied darker and a little cooler,
    // so the same hues hold - over the world, under the names so they still read.
    const w = WORLD.x1 - WORLD.x0;
    const h = WORLD.y1 - WORLD.y0;
    this.night = this.add
      .rectangle(WORLD.x0 + w / 2, WORLD.y0 + h / 2, w * 2, h * 2, num(nightOf("#ffffff")), 1)
      .setBlendMode(Phaser.BlendModes.MULTIPLY)
      .setDepth(9_000);
    this.night.setVisible(this.isNight);
    this.solarLights = drawSolarLights(this, this.opts.still);
    this.solarLights.setNight(this.isNight);
    this.arena = drawArena(this, this.opts.still);
    this.arena.setNight(this.isNight);

    this.setUpCamera();
    this.setNotes(this.notes);
    this.opts.events.ready();
    if (this.pending) this.setResidents(this.pending);
    if (this.holders !== null) this.setHolders(this.holders);
  }

  // --- Growth -------------------------------------------------------------

  /**
   * The village grows with its holders (growth.ts): each plot that has opened
   * is built, and the trees on its ground come down. The first count a page
   * hears is the village as it stands, drawn at once. A plot that opens while
   * someone is watching goes up in front of them: a house agent walks over
   * and stands at it while it rises. Presentation only.
   */
  setHolders(count: number): void {
    this.holders = count;
    if (!this.roads) return;
    const live = this.grownOnce && !this.opts.still;
    this.grownOnce = true;
    const fresh = openPlots(NEW_TOWN, count).filter((p) => !this.grown.has(p.id));
    for (const plot of fresh) {
      this.grown.add(plot.id);
      const pieces = this.build(plot);
      // Its ground is cleared for good: the forest never grows a tree there again (forest.ts), and the
      // trees standing there now come down.
      const clearing = plotClearing(plot);
      if (this.forestRules) this.forestRules = { ...this.forestRules, cleared: [...this.forestRules.cleared, clearing] };
      for (const chunk of this.chunks.values()) {
        for (const t of chunk) {
          if (!t.sprite.active || !overlaps(canopy(t.tree), clearing)) continue;
          const sprite = t.sprite;
          if (live) this.tweens.add({ targets: sprite, alpha: 0, duration: 1_500, onComplete: () => sprite.destroy() });
          else sprite.destroy();
        }
      }
      for (const t of this.trees) if (overlaps(canopy(t.d), clearing)) t.sprite.setVisible(false);
      if (live) this.rise(plot, pieces);
    }
    // The land has grown: frame it all, unless someone has moved the view, which is theirs.
    if (fresh.length > 0 && !this.moved) this.fit();
  }

  /** New Town's ground nothing grows on: its fixed buildings and their forecourts (the plots clear their own as they open). */
  private newTownLots(): Box[] {
    return [...NEW_TOWN_SITES].flatMap((id) => {
      const s = SITES[id];
      return s ? [{ x0: s.x - 160, y0: s.y - 230, x1: s.x + 160, y1: s.y + 90 }] : [];
    });
  }

  /**
   * The forest round the camera (forest.ts): every chunk the view comes near
   * is made, and every chunk it has left far behind is destroyed - its
   * sprites gone, not hidden - and made again, the same, if it comes back.
   * The Wilds are thick, so only the chunks in view are drawn: those made
   * ahead of the camera wait hidden, and a few are made a frame, nearest
   * first, so zooming out never stalls a phone on a whole ring of them.
   */
  private tendForest(): void {
    const rules = this.forestRules;
    if (!rules) return;
    const v = this.cameras.main.worldView;
    // In view: a tree's canopy rises above its foot, so a chunk just below the view can show in it.
    const seen: Box = { x0: v.x - 80, y0: v.y - 40, x1: v.right + 80, y1: v.bottom + FOREST_REACH };
    const at = [seen.x0, seen.y0, seen.x1, seen.y1].map((n) => Math.floor(n / CHUNK)).join();
    if (at === this.forestAt) return;
    const grow = (n: number): Box => ({ x0: v.x - n * CHUNK, y0: v.y - n * CHUNK, x1: v.right + n * CHUNK, y1: v.bottom + n * CHUNK });
    const shown = new Set(chunksIn(seen).map((c) => chunkKey(c.cx, c.cy)));
    const keep = new Set(chunksIn(grow(FOREST_FAR)).map((c) => chunkKey(c.cx, c.cy)));
    for (const [key, trees] of this.chunks) {
      if (keep.has(key)) continue;
      for (const t of trees) t.sprite.destroy();
      this.chunks.delete(key);
    }
    const mid = { x: (v.x + v.right) / 2 / CHUNK, y: (v.y + v.bottom) / 2 / CHUNK };
    const missing = chunksIn(grow(FOREST_NEAR))
      .filter(({ cx, cy }) => !this.chunks.has(chunkKey(cx, cy)))
      .sort((a, b) => Math.hypot(a.cx + 0.5 - mid.x, a.cy + 0.5 - mid.y) - Math.hypot(b.cx + 0.5 - mid.x, b.cy + 0.5 - mid.y));
    for (const { cx, cy } of missing.slice(0, FOREST_PER_FRAME)) {
      this.chunks.set(
        chunkKey(cx, cy),
        chunkTrees(cx, cy, rules).map((tree) => {
          const sprite = this.add.image(tree.x, tree.y, tree.k, tree.f).setScale(tree.s);
          sprite.setDepth(tree.y + sprite.displayHeight * 0.5);
          return { tree, sprite };
        }),
      );
    }
    for (const [key, trees] of this.chunks) {
      const on = shown.has(key);
      for (const t of trees) if (t.sprite.active && t.sprite.visible !== on) t.sprite.setVisible(on);
    }
    // Done for this view only once every chunk near it is made; until then, a few more next frame.
    if (missing.length <= FOREST_PER_FRAME) this.forestAt = at;
    this.debugCount();
  }

  /** In development, what the forest holds now, for checking memory on a phone-sized run. Never in a production build. */
  private debugCount(): void {
    if (process.env.NODE_ENV === "production") return;
    let trees = 0;
    for (const c of this.chunks.values()) trees += c.length;
    let drawn = 0;
    for (const c of this.chunks.values()) for (const t of c) if (t.sprite.visible) drawn++;
    (window as unknown as { __village?: object }).__village = { chunks: this.chunks.size, trees, drawn, objects: this.children.length, textures: this.textures.getTextureKeys().length };
  }

  /** Draws a plot's pieces at the depth of their feet, like everything else on the ground. */
  private build(plot: Plot): (Phaser.GameObjects.Image | Phaser.GameObjects.Sprite)[] {
    return plot.pieces.flatMap((p) => {
      const key = `growth-${p.image}`;
      if (!this.textures.exists(key)) return [];
      const size: { foot: number; frames?: number } = PIECE_ART[p.image];
      const obj = size.frames ? this.add.sprite(p.x, p.y, key, 0) : this.add.image(p.x, p.y, key);
      obj.setOrigin(0.5, size.foot).setScale(p.scale).setFlipX(p.flip ?? false).setDepth(p.y);
      if (size.frames && obj instanceof Phaser.GameObjects.Sprite && !this.opts.still) {
        const anim = `${key}:loop`;
        if (!this.anims.exists(anim)) this.anims.create({ key: anim, frames: this.anims.generateFrameNumbers(key, {}), frameRate: 6, repeat: -1 });
        obj.play(anim);
      }
      return [obj];
    });
  }

  /** A plot going up: a house agent comes to build it, and it rises out of the ground. */
  private rise(plot: Plot, pieces: (Phaser.GameObjects.Image | Phaser.GameObjects.Sprite)[]): void {
    for (const obj of pieces) {
      const full = obj.scaleY;
      obj.setScale(obj.scaleX, 0).setAlpha(0.6);
      this.tweens.add({ targets: obj, scaleY: full, alpha: 1, duration: RISE_MS, ease: "Sine.easeOut" });
    }
    const builder = this.builder();
    if (!builder) return;
    const hero = this.heroes.get(builder)!;
    this.roam(builder, true);
    hero.walkTo(plot.door, undefined, {
      pace: STROLL_PACE,
      then: () => this.after(builder, BUILD_MS, () => this.goHome(builder, hero)),
    });
  }

  /** A house agent waiting at its hall and not already out: the one to send to a new plot. */
  private builder(): string | null {
    for (const [id, r] of this.residents) {
      if (r.house && this.heroes.has(id) && this.isHall(r.place) && !this.strolling.has(id) && id !== this.selected) return id;
    }
    return null;
  }

  // --- Camera -------------------------------------------------------------

  /** The part of the world with the buildings and the people in front of them, and whatever the village has grown into. */
  private villageBounds(): Phaser.Geom.Rectangle {
    // Arrive in the landscaped town centre. Outlying districts stay a pan
    // away, rather than shrinking every landmark as the holder count grows.
    const b = townBounds();
    return new Phaser.Geom.Rectangle(b.x0 - 160, b.y0 - 100, b.x1 - b.x0 + 320, b.y1 - b.y0 + 330);
  }

  /**
   * Never so far out that the world stops covering the whole canvas: the
   * village is the page's background, edge to edge, on a screen of any shape.
   * On a tall enough window this outranks maxZoom.
   */
  private minZoom(): number {
    const cam = this.cameras.main;
    // The world is larger than anyone needs to see at once: no further out than MAX_VIEW across.
    return Math.max(cam.width / (WORLD.x1 - WORLD.x0), cam.height / (WORLD.y1 - WORLD.y0), cam.width / MAX_VIEW);
  }

  /**
   * The camera never looks past the world's edge, so there is never an empty
   * strip beside the map. Framing around a panel gives way to this: near an
   * edge, the village sits as close to the middle of the open part as the
   * world allows.
   */
  private updateBounds(): void {
    this.cameras.main.setBounds(WORLD.x0, WORLD.y0, WORLD.x1 - WORLD.x0, WORLD.y1 - WORLD.y0);
    this.rescaleLabels();
  }

  /** Building names keep a readable size on screen however far out the village is zoomed, as a game's map labels do. */
  private rescaleLabels(): void {
    // Capped so the longest name ("Rulebook House") still fits between its neighbours on a phone.
    const scale = Phaser.Math.Clamp((0.85 * renderScale(this)) / this.cameras.main.zoom, 1, 1.45);
    for (const b of this.buildings.values()) b.setLabelScale(scale);
    for (const h of this.heroes.values()) h.setLabelScale(this.heroLabelScale());
  }

  /** Agents' names keep a readable size too, up to a point: past it, they would crowd the whole map. */
  private heroLabelScale(): number {
    return Phaser.Math.Clamp((0.9 * renderScale(this)) / this.cameras.main.zoom, 1, 1.8);
  }

  private maxZoom(): number {
    return 2 * renderScale(this);
  }

  /** The canvas's uncovered part, in canvas pixels: its size, and how far its centre sits from the canvas's. */
  private visible(): { width: number; height: number; dx: number; dy: number } {
    const cam = this.cameras.main;
    const r = renderScale(this);
    const top = this.inset.top * r;
    const right = this.inset.right * r;
    const bottom = this.inset.bottom * r;
    return { width: Math.max(1, cam.width - right), height: Math.max(1, cam.height - top - bottom), dx: right / 2, dy: (bottom - top) / 2 };
  }

  /** Put the world point (x, y) in the middle of the uncovered part. */
  private centreOn(x: number, y: number, duration = 0): void {
    const cam = this.cameras.main;
    const { dx, dy } = this.visible();
    const tx = x + dx / cam.zoom;
    const ty = y + dy / cam.zoom;
    if (duration > 0) cam.pan(tx, ty, duration, "Sine.easeInOut");
    else cam.centerOn(tx, ty);
  }

  private fit(): void {
    this.moved = false;
    const cam = this.cameras.main;
    const v = this.villageBounds();
    const { width, height } = this.visible();
    let zoom = Math.min(width / v.width, height / v.height);
    // On a portrait screen - a phone - fitting all of New Town's width would show nearly the whole world's
    // height, tiny: Old Town fills the width instead, and New Town's rows above and below it are in view,
    // its sides a swipe away.
    if (height > width) {
      const old = townBounds();
      zoom = Math.max(zoom, width / Math.min(1100, old.x1 - old.x0));
    }
    cam.setZoom(Phaser.Math.Clamp(zoom, this.minZoom(), this.maxZoom()));
    this.updateBounds();
    this.centreOn(v.centerX, v.centerY);
  }

  /** The bar, the panel or the tab bar moved: frame the village again in what they leave uncovered. */
  setInsets(inset: { top: number; right: number; bottom: number }): void {
    const i = this.inset;
    if (inset.top === i.top && inset.right === i.right && inset.bottom === i.bottom) return;
    this.inset = inset;
    if (this.roads) this.fit();
  }

  /** Zoom with the world point under (sx, sy) kept where it is on screen. */
  private zoomAround(sx: number, sy: number, zoom: number): void {
    this.moved = true;
    const cam = this.cameras.main;
    const before = cam.getWorldPoint(sx, sy);
    cam.setZoom(Phaser.Math.Clamp(zoom, this.minZoom(), this.maxZoom()));
    this.updateBounds();
    const after = cam.getWorldPoint(sx, sy);
    cam.scrollX += before.x - after.x;
    cam.scrollY += before.y - after.y;
  }

  zoomBy(step: number): void {
    if (!this.roads) return;
    const { width, height } = this.visible();
    this.zoomAround(width / 2, height / 2, this.cameras.main.zoom * (step > 0 ? 1.25 : 0.8));
  }

  private setUpCamera(): void {
    const cam = this.cameras.main;
    this.fit();
    // A resize keeps what is being looked at rather than throwing away where
    // someone has panned or zoomed to; a big one scales the zoom with it.
    // A resize frames the village again - unless someone has moved the view, which it then keeps, still covering the canvas.
    let density = renderScale(this);
    this.scale.on("resize", (size: Phaser.Structs.Size) => {
      cam.setViewport(0, 0, size.width, size.height);
      // A new density changes what every zoom value means, so a view kept from before would be wrong: frame again.
      const now = renderScale(this);
      if (now !== density) {
        density = now;
        return this.fit();
      }
      if (!this.moved) return this.fit();
      const centre = cam.midPoint.clone();
      cam.setZoom(Phaser.Math.Clamp(cam.zoom, this.minZoom(), this.maxZoom()));
      this.updateBounds();
      cam.centerOn(centre.x, centre.y);
    });

    // Drag to look around, with a threshold so a tap still selects.
    let start = { x: 0, y: 0 };
    this.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
      start = { x: p.x, y: p.y };
      this.dragged = false;
    });
    this.input.on("pointermove", (p: Phaser.Input.Pointer) => {
      if (!p.isDown || (this.input.pointer1.isDown && this.input.pointer2.isDown)) return;
      if (!this.dragged && Math.abs(p.x - start.x) + Math.abs(p.y - start.y) > DRAG) this.dragged = this.moved = true;
      if (this.dragged) {
        cam.scrollX -= (p.x - p.prevPosition.x) / cam.zoom;
        cam.scrollY -= (p.y - p.prevPosition.y) / cam.zoom;
      }
    });
    // A tap on nothing clears the selection.
    this.input.on("pointerup", (_p: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
      if (!this.dragged && over.length === 0) this.opts.events.selectAgent(null);
    });

    // The page scrolls in its panel, so the wheel over the village is the village's: it zooms.
    this.input.on("wheel", (p: Phaser.Input.Pointer, _over: unknown, _dx: number, dy: number) => {
      this.zoomAround(p.x, p.y, cam.zoom * Math.exp(-dy * 0.002));
    });

    // Names kept apart every frame: agents walk, and the camera moves and zooms. Rings too.
    this.events.on("update", () => {
      this.frameDuels();
      this.layOutNames();
    });

    // Pinch to zoom on touch, about the point between the fingers.
    this.input.addPointer(1);
    let pinch = { dist: 0, zoom: 0 };
    this.events.on("update", () => {
      const [a, b] = [this.input.pointer1, this.input.pointer2];
      if (!a.isDown || !b.isDown) {
        pinch.dist = 0;
        return;
      }
      this.dragged = true;
      const dist = Phaser.Math.Distance.Between(a.x, a.y, b.x, b.y);
      if (pinch.dist === 0) pinch = { dist, zoom: cam.zoom };
      else this.zoomAround((a.x + b.x) / 2, (a.y + b.y) / 2, pinch.zoom * (dist / pinch.dist));
    });
  }

  /**
   * No two names overlap (labels.ts): building names stay put and win; agents'
   * names are nudged up or down, or hidden until hovered, nearest the middle of
   * the screen first.
   */
  private layOutNames(): void {
    const names: NameLabel[] = [];
    for (const [id, hero] of this.heroes) {
      const n = hero.nameLabel(id);
      if (n) names.push(n);
    }
    // Building names, and the running score over each match, stay put: agents' names move off them.
    const fixed = [...this.buildings.values()].map((b) => b.labelBounds());
    for (const b of this.brawls.values()) {
      if (!b.score.visible) continue;
      const r = b.score.getBounds();
      fixed.push({ x0: r.x, y0: r.y, x1: r.right, y1: r.bottom });
    }
    const placed = layOutNames(names, fixed, this.cameras.main.midPoint);
    for (const [id, p] of placed) this.heroes.get(id)?.placeName(p);
  }

  // --- Residents ----------------------------------------------------------

  /** The lines under the buildings' names; lively ones, with someone there, in the live colour. */
  setNotes(notes: Record<string, { text: string; lively: boolean }>): void {
    this.notes = notes;
    for (const [id, b] of this.buildings) {
      const n = notes[id];
      if (n) b.setNote(n.text, n.lively ? COLOUR.live : COLOUR.text);
    }
  }

  setNight(on: boolean): void {
    this.isNight = on;
    this.night?.setVisible(on);
    this.solarLights?.setNight(on);
    this.arena?.setNight(on);
  }

  /** Marks the signed-in owner's agents; an empty set when nobody is signed in. */
  setMine(ids: ReadonlySet<string>): void {
    this.mine = new Set(ids);
    for (const [id, hero] of this.heroes) hero.setMine(this.mine.has(id));
  }

  /** Brings the camera to the owner's next agent in the village, in turn; false when none is here. */
  findMine(): boolean {
    const here = [...this.mine].filter((id) => this.heroes.has(id));
    if (here.length === 0) return false;
    this.found = (this.found + 1) % here.length;
    const hero = this.heroes.get(here[this.found]!)!;
    this.moved = true;
    this.centreOn(hero.x, hero.y, this.opts.still ? 0 : 600);
    return true;
  }

  select(id: string | null, pan: boolean): void {
    if (this.selected) this.heroes.get(this.selected)?.setSelected(false);
    this.selected = id;
    const hero = id ? this.heroes.get(id) : undefined;
    hero?.setSelected(true);
    if (hero && pan) this.centreOn(hero.x, hero.y, this.opts.still ? 0 : 600);
  }

  setResidents(incoming: Resident[]): void {
    if (!this.roads) {
      this.pending = incoming;
      return;
    }
    this.pending = null;
    this.latest = incoming;
    const list = this.withHeld(incoming);
    const ids = new Set(list.map((r) => r.id));

    for (const [id, hero] of this.heroes) {
      if (ids.has(id)) continue;
      hero.leave();
      this.heroes.delete(id);
      this.residents.delete(id);
      this.targets.delete(id);
      this.unorder(id);
      this.stopRoutine(id);
      this.home.delete(id);
    }

    const spawn = this.gate;
    for (const r of list) {
      const before = this.residents.get(r.id);
      let hero = this.heroes.get(r.id);
      if (!hero) {
        hero = new Hero(this, this.route, r.look, r.name, r.standIn ? ARENA_GATE : spawn, HERO_SCALE, {
          named: !r.house,
          nameColour: r.house ? COLOUR.text : COLOUR.accent,
          still: this.opts.still,
          onClick: () => {
            if (!this.dragged) this.opts.events.selectAgent(r.standIn ?? r.id);
          },
          inWater: (p) => this.ground.inWater(p) && !this.onDock(p),
        });
        this.heroes.set(r.id, hero);
        this.giveFace(r.id, r.standIn);
        hero.setWeapon(weaponOf(r.standIn ?? r.id));
        hero.setLabelScale(this.heroLabelScale());
        if (this.mine.has(r.id)) hero.setMine(true);
        if (r.id === this.selected) hero.setSelected(true);
      } else {
        hero.setName(r.name);
      }
      // A match has played out when its sides stop playing it - back to a hall,
      // or straight into the next one: its result then, and not before.
      if (before?.match && inMatch(before.place) && (r.match ? keyOf(r.match) : null) !== keyOf(before.match)) {
        hero.float(...this.result(before.match));
        // The side that lost goes down, and gets up a few seconds later.
        if (before.match.net < 0) hero.knockDown();
        // Once a match, for the side that heard it first, and only when it ended in view.
        if (!this.heard.has(before.match.id) && this.cameras.main.worldView.contains(hero.x, hero.y)) {
          if (this.heard.size > 500) this.heard.clear();
          this.heard.add(before.match.id);
          sound.fanfare(before.match.net === 0);
        }
      }
      if (before?.place !== r.place) {
        this.unorder(r.id);
        const here = this.order.get(r.place) ?? [];
        here.push(r.id);
        this.order.set(r.place, here);
      }
      this.residents.set(r.id, r);
    }

    for (const [id, spot] of this.spots()) {
      const key = `${Math.round(spot.x)},${Math.round(spot.y)},${spot.facing ?? ""}`;
      if (this.targets.get(id) === key) continue;
      this.targets.set(id, key);
      const hero = this.heroes.get(id)!;
      const waiting = this.isHall(this.residents.get(id)?.place);
      if (waiting) this.home.set(id, spot);
      else {
        // A match or a farewell cuts any stroll short.
        this.stopRoutine(id);
        this.home.delete(id);
      }
      // Out on a stroll, it comes back to its new spot when the stroll ends; no need to call it in.
      if (waiting && this.strolling.has(id)) continue;
      // The hall's grid reshuffles whenever someone comes or goes; stepping to a new spot is not a new
      // arrival, so it leaves a routine already under way alone rather than starting its wait over.
      const then = waiting ? () => this.routine.has(id) || this.standAWhile(id) : undefined;
      // The first time the village fills, everyone is already where they belong.
      // To a match, at a run: it lasts seconds, and the fight is the point.
      const toFight = inMatch(this.residents.get(id)?.place ?? "gate");
      if (this.placed) hero.walkTo(spot, spot.facing, { then, ...(toFight ? { within: ARRIVE_MS } : {}) });
      else {
        hero.standAt(spot, spot.facing);
        then?.();
      }
    }
    if (list.length > 0) this.placed = true;
    this.syncBrawls();
  }

  // --- Strolls --------------------------------------------------------------

  private isHall(place: Place | undefined): boolean {
    return place === "tavern" || place === "forge" || place === "castle";
  }

  /** The way from one point to another: by road inside the village, over dry ground out in the world. */
  private route = (from: Point, to: Point): Point[] =>
    this.roads.near(from, NEAR_ROAD) && this.roads.near(to, NEAR_ROAD) ? this.roads.route(from, to) : this.ground.route(from, to);

  private stopRoutine(id: string): void {
    this.routine.get(id)?.remove();
    this.routine.delete(id);
    this.roam(id, false);
  }

  /** Out on a stroll or back from one: while out, the agent's name shows. */
  private roam(id: string, on: boolean): void {
    if (on) this.strolling.add(id);
    else this.strolling.delete(id);
    this.heroes.get(id)?.setRoaming(on);
  }

  private after(id: string, ms: number, then: () => void): void {
    this.routine.get(id)?.remove();
    this.routine.set(id, this.time.delayedCall(ms, then));
  }

  /** At its hall: stand a while, then perhaps go for a stroll. Nothing moves with reduced motion. */
  private standAWhile(id: string): void {
    if (this.opts.still) return;
    this.after(id, between(AT_HOME_MS), () => {
      if (!this.isHall(this.residents.get(id)?.place)) return;
      if (Math.random() < STROLL_CHANCE) this.stroll(id);
      else this.standAWhile(id);
    });
  }

  /** Out down the south road to the dock, to the agent grounds, the lake shore, or anywhere in the world; a while there, then home. */
  private stroll(id: string): void {
    if (this.dock && Math.random() < DOCK_CHANCE) return this.toTheDock(id);
    const hero = this.heroes.get(id);
    const places =
      Math.random() < GROUNDS_CHANCE ? GROUNDS : Math.random() < SHORE_CHANCE && this.ground.shore.length > 0 ? this.ground.shore : this.strollable;
    const to = places[Math.floor(Math.random() * places.length)];
    if (!hero || !to) return this.standAWhile(id);
    this.roam(id, true);
    // A little off the tile's centre, so two strollers to one tile don't stand in each other.
    const spot = { x: to.x + (Math.random() - 0.5) * 30, y: to.y + (Math.random() - 0.5) * 20 };
    hero.walkTo(spot, undefined, { pace: STROLL_PACE, then: () => this.after(id, between(AWAY_MS), () => this.goHome(id, hero)) });
  }

  /** Down the road to the end of the dock; then a swim off it, or a while looking out over the water. */
  private toTheDock(id: string): void {
    const hero = this.heroes.get(id);
    const dock = this.dock;
    if (!hero || !dock) return this.standAWhile(id);
    this.roam(id, true);
    const end = { x: dock.x + (Math.random() - 0.5) * 24, y: dock.y + 12 };
    hero.walkTo(end, undefined, {
      pace: STROLL_PACE,
      then: () => {
        if (this.swimSpots.length > 0 && Math.random() < SWIM_CHANCE) this.swim(id, hero, end, Math.round(between(SWIM_LEGS)));
        else this.after(id, between(AWAY_MS), () => this.goHome(id, hero));
      },
    });
  }

  /**
   * Off the dock and about the lake: a few strokes to somewhere nearby in open
   * water, a pause, another, then back to the dock to climb out and go home.
   * The hero swims on its own wherever it is in the water (Hero.place).
   */
  private swim(id: string, hero: Hero, dock: Point, strokes: number): void {
    if (strokes <= 0) {
      hero.walkTo(dock, undefined, { straight: true, pace: SWIM_PACE, then: () => this.after(id, between([1_500, 4_000]), () => this.goHome(id, hero)) });
      return;
    }
    const near = this.swimSpots.filter((p) => Math.hypot(p.x - hero.x, p.y - hero.y) < 220);
    const pool = near.length > 0 ? near : this.swimSpots;
    const to = pool[Math.floor(Math.random() * pool.length)]!;
    const spot = { x: to.x + (Math.random() - 0.5) * 40, y: to.y + (Math.random() - 0.5) * 30 };
    hero.walkTo(spot, undefined, {
      straight: true,
      pace: SWIM_PACE,
      then: () => this.after(id, between([800, 2_500]), () => this.swim(id, hero, dock, strokes - 1)),
    });
  }

  /** Back to its spot at the hall, and the routine starts over there. */
  private goHome(id: string, hero: Hero): void {
    const home = this.home.get(id);
    if (!home) return this.roam(id, false);
    hero.walkTo(home, home.facing, {
      pace: STROLL_PACE,
      then: () => {
        this.roam(id, false);
        this.standAWhile(id);
      },
    });
  }

  /** Whether p is on the dock's planks, which lie over the water but are walked, not swum. */
  private onDock(p: Point): boolean {
    const d = this.dock;
    return d !== null && Math.abs(p.x - d.x) < d.halfWidth && Math.abs(p.y - d.y) < d.halfHeight;
  }

  private unorder(id: string): void {
    for (const who of this.order.values()) {
      const i = who.indexOf(id);
      if (i !== -1) who.splice(i, 1);
    }
  }

  private result(match: NonNullable<Resident["match"]>): [string, string] {
    if (match.net === 0) return ["level", COLOUR.muted];
    if (match.exhibition) return match.net > 0 ? ["won", COLOUR.live] : ["lost", COLOUR.loss];
    return match.net > 0 ? [`+${match.net}`, COLOUR.live] : [`−${Math.abs(match.net)}`, COLOUR.loss];
  }

  /** Where everyone should stand: a grid at each hall, facing pairs at the arena, a huddle at the gate. */
  private spots(): Map<string, Point & { facing?: "left" | "right" }> {
    const out = new Map<string, Point & { facing?: "left" | "right" }>();
    for (const [place, ids] of this.order) {
      if (ids.length === 0) continue;
      if (place === "gate") {
        ids.forEach((id, i) => out.set(id, { x: this.gate.x + ((i % 5) - 2) * 18, y: this.gate.y + Math.floor(i / 5) * 18 }));
        continue;
      }
      if (place === "duel" || place === "arena") {
        this.layOutDuels(ids, out);
        continue;
      }
      const door = this.doors.get(place);
      if (!door) continue;
      const cols = Math.ceil(Math.sqrt(ids.length));
      ids.forEach((id, i) => {
        out.set(id, { x: door.x - ((cols - 1) * GRID_X) / 2 + (i % cols) * GRID_X, y: door.y + Math.floor(i / cols) * GRID_Y });
      });
    }
    return out;
  }

  /**
   * The agent's character: the same pixel drawing its pages show, without the
   * plate behind it, made into a texture once and kept for the agent's next
   * visit; its body is dressed in the head's own colours. An agent with no
   * portrait stays the knight it was drawn as.
   */
  /** Each character's body colours, kept with its textures. */
  private bodies = new Map<string, { main: number; dark: number }>();

  private giveFace(id: string, face = id): void {
    const views = { front: `head-${face}`, side: `head-${face}-side`, back: `head-${face}-back` };
    const known = this.bodies.get(face);
    if (known && this.textures.exists(views.back)) {
      this.heroes.get(id)?.setFace(views, known);
      return;
    }
    pixelate(portraitUrl(face, false), GRID_LARGE, true).then((data) => {
      if (!this.sys.isActive()) return;
      if (!data) {
        this.heroes.get(id)?.useSprite();
        return;
      }
      if (!this.textures.exists(views.back)) {
        const { side, back } = turned(data);
        for (const [key, pixels] of [[views.front, data], [views.side, side], [views.back, back]] as const) {
          const tex = this.textures.exists(key) ? null : this.textures.createCanvas(key, pixels.width, pixels.height);
          if (!tex) continue;
          tex.context.putImageData(pixels, 0, 0);
          tex.refresh();
        }
      }
      const colours = bodyColours(data);
      this.bodies.set(face, colours);
      this.heroes.get(id)?.setFace(views, colours);
    });
  }

  // --- Matches at the table -----------------------------------------------

  private brawls = new Map<string, Brawl>();
  /** The signed-in owner's agents, and which of them "find" went to last. */
  private mine = new Set<string>();
  private found = -1;
  /** Matches whose end has already been sounded: both sides leave the arena, but it ends once. */
  private heard = new Set<string>();

  /** A brawl for every match with both its sides in the arena, and none for a match that is over. */
  private syncBrawls(): void {
    const fights = new Map<string, [string, string]>();
    for (const r of this.residents.values()) {
      if (!inMatch(r.place) || r.match?.seat !== "A") continue;
      const o = this.residents.get(r.match.opponent.id);
      if (o?.place === r.place && o.match && keyOf(o.match) === keyOf(r.match)) fights.set(keyOf(r.match), [r.id, o.id]);
    }
    // A ring whose match is over for both its sides - one of them pulled into a newer match - goes.
    for (const id of this.duels.keys()) if (!fights.has(id)) this.removeDuel(id);
    for (const [id, b] of this.brawls) {
      if (fights.has(id)) continue;
      b.ticker.remove();
      b.score.destroy();
      b.table.destroy();
      this.brawls.delete(id);
    }
    for (const [id, [a, b]] of fights) if (!this.brawls.has(id)) this.startBrawl(id, a, b);
    // The crowd is on its feet while the Arena's match is on.
    this.arena?.setCheering([...this.duels.values()].some((d) => d.arena !== null && d.metAt !== null));
  }

  private startBrawl(id: string, a: string, b: string): void {
    const score = crispText(this, 0, 0, "", {
      fontSize: "15px",
      fontFamily: MONO,
      fontStyle: "bold",
      color: COLOUR.accent,
      stroke: "#000000",
      strokeThickness: 4,
    })
      .setOrigin(0.5, 1)
      .setDepth(19_000)
      .setVisible(false);
    const brawl: Brawl = {
      a,
      b,
      score,
      table: new CardTable(this, this.opts.still),
      // Often enough that a round's choices land in step with the live feed's.
      ticker: this.time.addEvent({ delay: 100, loop: true, callback: () => this.keepScore(id) }),
    };
    this.brawls.set(id, brawl);
    this.keepScore(id);
  }

  /**
   * The running score over the fighters: rounds won by each, left and right as
   * they stand, moving when a round's outcome shows on the live feed and not
   * before - the same clock (lib/playhead) - and the winner's side lit at the end.
   */
  private keepScore(id: string): void {
    const brawl = this.brawls.get(id);
    const ha = brawl && this.heroes.get(brawl.a);
    const hb = brawl && this.heroes.get(brawl.b);
    const clock = brawl && this.residents.get(brawl.a)?.match?.clock;
    if (!brawl || !ha || !hb) return;
    // Over them once they have squared up; not while they are still on their way.
    const together = ha.idle && hb.idle && Math.abs(ha.y - hb.y) < 10;
    // Out in the village the replay starts when both have arrived, whenever the server finished the match;
    // in the Arena it keeps the live feed's clock.
    const duel = this.duels.get(id);
    let startedAt = clock?.startedAt ?? 0;
    // The Arena's match, out in the village or in the Arena, plays from when both sides are in.
    if (duel) {
      if (together && duel.metAt === null) duel.metAt = Date.now();
      if (duelPhase(Date.now(), duel.metAt, clock?.playMs ?? null) === "done") return this.endDuel(id);
      if (!duel.full) {
        brawl.score.setVisible(false);
        brawl.table.hide();
        return;
      }
      startedAt = duel.metAt ?? 0;
    }
    brawl.score.setVisible(together && clock !== null && clock !== undefined);
    if (!together || !clock) return;
    const { round, phase, within } = playhead(clock.roundsWon.length, Date.now() - startedAt, clock.playMs);
    brawl.table.place({ x: ha.x, y: ha.y }, { x: hb.x, y: hb.y }, this.heroLabelScale());
    brawl.table.show(round, phase, within, clock.rounds[round] ?? null);
    const shown = phase === "outcome" || phase === "final" ? clock.roundsWon[round] : clock.roundsWon[round - 1];
    const won = shown ?? { A: 0, B: 0 };
    // Seat A stands on the left. At the end a star marks the side that took the match; a level match has none.
    const star = (s: "A" | "B") => (phase === "final" && won[s] > won[s === "A" ? "B" : "A"] ? "★" : "");
    const text = phase === "final" ? `${star("A")}${won.A} – ${won.B}${star("B")}` : `R${round + 1}  ${won.A} – ${won.B}`;
    // A replay in the Arena says so over the fighters, as the Arena's sign does.
    brawl.score.setText(this.residents.get(brawl.a)?.match?.replay ? `REPLAY  ${text}` : text);
    brawl.score.setColor(phase === "final" ? COLOUR.live : COLOUR.accent);
    brawl.score.setScale(this.heroLabelScale());
    // High enough to clear the choices said over each side's head.
    brawl.score.setPosition((ha.x + hb.x) / 2, Math.min(ha.y, hb.y) - 58);
  }

  // --- Duels ---------------------------------------------------------------

  /** Matches out in the village, by match id (duels.ts). */
  private duels = new Map<string, Duel>();
  /** Agents kept at their duel after the server has moved on, until its replay is done. */
  private held = new Map<string, Resident>();
  /** Duels already replayed: a match still in the page's list after its replay is not played again. */
  private replayed = new Set<string>();
  /** What the page last sent, to apply again when a duel lets its agents go. */
  private latest: Resident[] = [];
  /** The spots on the paths a ring may go (duels.ts), and the open ground in town for when the paths are full. */
  private ringSpots: Spot[] = [];
  private ringClearings: Spot[] = [];

  /**
   * The page's list, with each agent at a duel kept there until its replay is
   * done: the server's playback can end before the two sides have even met, and
   * the village plays the match out after, never cutting it short.
   */
  private withHeld(list: Resident[]): Resident[] {
    return list.map((r) => {
      if (r.match && this.replayed.has(keyOf(r.match))) return { ...r, place: r.hall, match: null };
      if (r.match) {
        if (r.place === "duel") this.held.set(r.id, r);
        else this.held.delete(r.id);
        return r;
      }
      const kept = this.held.get(r.id);
      if (!kept || r.place === "gate") {
        this.held.delete(r.id);
        return r;
      }
      return { ...r, place: "duel", match: kept.match };
    });
  }

  /** Whether a ring may go at p: clear ground for both sides, off the Arena's sand, away from every door. */
  private ringOpen = (p: Spot): boolean => {
    const half = PAIR_GAP / 2;
    if (![p, { x: p.x - half, y: p.y }, { x: p.x + half, y: p.y }].every((q) => this.ground.walkable(q))) return false;
    if (RESERVED.some((r) => p.x > r.x0 - 40 && p.x < r.x1 + 40 && p.y > r.y0 - 40 && p.y < r.y1 + 40)) return false;
    // Not on the fountain's plaza: a ring there would sit round the fountain.
    if (((p.x - SQUARE.x) / (SQUARE.rx + 90)) ** 2 + ((p.y - SQUARE.y) / (SQUARE.ry + 50)) ** 2 < 1) return false;
    return [...this.doors.values()].every((d) => Math.hypot(d.x - p.x, d.y - p.y) > DOOR_CLEARANCE);
  };

  /**
   * Each match out in the village at its meeting spot, and the Arena's in the
   * middle of the sand: seat A on the left, the two facing each other.
   */
  private layOutDuels(ids: string[], out: Map<string, Point & { facing?: "left" | "right" }>): void {
    const seen = new Set<string>();
    for (const id of ids) {
      const r = this.residents.get(id);
      const match = r?.match;
      if (!match || seen.has(keyOf(match))) continue;
      seen.add(keyOf(match));
      const other = match.opponent.id;
      const [a, b] = match.seat === "A" ? [id, other] : [other, id];
      const duel = this.duels.get(keyOf(match)) ?? (r.place === "arena" ? this.openArena(keyOf(match), match.id) : this.openDuel(keyOf(match), a, b));
      if (!duel) continue;
      out.set(a, { x: duel.spot.x - PAIR_GAP / 2, y: duel.spot.y, facing: "right" });
      if (ids.includes(b)) out.set(b, { x: duel.spot.x + PAIR_GAP / 2, y: duel.spot.y, facing: "left" });
    }
  }

  /** Where two agents meet, and the ring drawn there. */
  private openDuel(matchId: string, a: string, b: string): Duel | null {
    const at = (id: string) => this.heroes.get(id) ?? this.gate;
    const taken = [...this.duels.values()].filter((d) => d.arena === null).map((d) => d.spot);
    const spot = meetingSpot(at(a), at(b), this.ringSpots, taken, this.ringOpen, undefined, this.ringClearings);
    if (!spot) return null;
    const ring = this.add.graphics().setDepth(spot.y - 30).setAlpha(this.opts.still ? 1 : 0);
    const cy = spot.y + 12;
    ring.fillStyle(0x0c1018, 0.3).fillEllipse(spot.x, cy, RING.width, RING.height);
    ring.lineStyle(3, 0xe8b84b, 0.9).strokeEllipse(spot.x, cy, RING.width, RING.height);
    ring.lineStyle(1, 0x5c4a22, 0.9).strokeEllipse(spot.x, cy, RING.width - 10, RING.height - 6);
    if (!this.opts.still) this.tweens.add({ targets: ring, alpha: 1, duration: 400 });
    const marker = crispText(this, spot.x, spot.y - 24, "⚔", {
      fontSize: "16px",
      fontFamily: MONO,
      color: COLOUR.accent,
      stroke: "#000000",
      strokeThickness: 4,
    })
      .setOrigin(0.5, 1)
      .setDepth(19_000)
      .setVisible(false);
    const duel: Duel = { spot, ring, marker, metAt: null, full: true, arena: null };
    this.duels.set(matchId, duel);
    return duel;
  }

  /** The Arena's match: in the middle of the sand, always drawn in full, and no ring - the Arena is its ring. */
  private openArena(key: string, matchId: string): Duel {
    const duel: Duel = { spot: ARENA_SPOT, ring: null, marker: null, metAt: null, full: true, arena: matchId };
    this.duels.set(key, duel);
    return duel;
  }

  /** The replay is over: its ring fades, its two sides are let go, and the result shows over them. */
  private endDuel(id: string): void {
    const brawl = this.brawls.get(id);
    const arena = this.duels.get(id)?.arena ?? null;
    this.replayed.add(id);
    if (this.replayed.size > 500) this.replayed.clear();
    if (brawl) {
      this.held.delete(brawl.a);
      this.held.delete(brawl.b);
    }
    this.removeDuel(id);
    this.setResidents(this.latest);
    // The shell picks what the Arena shows next (arena.ts) and sends everyone again.
    if (arena) this.opts.events.arenaDone(arena);
  }

  private removeDuel(id: string): void {
    const duel = this.duels.get(id);
    if (!duel) return;
    this.duels.delete(id);
    duel.marker?.destroy();
    const ring = duel.ring;
    if (!ring) return;
    if (this.opts.still) ring.destroy();
    else this.tweens.add({ targets: ring, alpha: 0, duration: 600, onComplete: () => ring.destroy() });
  }

  /**
   * Every frame: the RING_CAP rings nearest the middle of the screen drawn in
   * full and the rest as a marker; and idle agents near a ring in play turn to
   * watch it.
   */
  private frameDuels(): void {
    if (this.duels.size === 0) return;
    const full = ringsInFull(
      [...this.duels].filter(([, d]) => d.arena === null).map(([id, d]) => ({ id, ...d.spot })),
      this.cameras.main.midPoint,
    );
    const scale = this.heroLabelScale();
    for (const [id, d] of this.duels) {
      if (d.arena !== null) continue;
      d.full = full.has(id);
      d.ring?.setVisible(d.full);
      d.marker?.setVisible(!d.full).setScale(scale);
    }
    const watched = [...this.duels.values()].filter((d) => d.full && d.metAt !== null);
    if (watched.length === 0) return;
    for (const [id, hero] of this.heroes) {
      const r = this.residents.get(id);
      if (!r || inMatch(r.place) || r.place === "gate" || !hero.idle) continue;
      const ring = watched.find((d) => Math.hypot(d.spot.x - hero.x, d.spot.y - hero.y) < WATCH_RADIUS);
      if (ring) hero.face(ring.spot.x < hero.x ? "left" : "right");
    }
  }
}
