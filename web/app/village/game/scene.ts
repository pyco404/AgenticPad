// Adapted from Agent Quest (MIT, see ./LICENSE).
import * as Phaser from "phaser";
import type { Place, Resident } from "../residents";
import { Building, type BuildingLabel } from "./building";
import { Ground } from "./ground";
import { Hero } from "./hero";
import { CardTable } from "./table";
import { cleared, drawDressing, drawSolarLights, loadDressing, overRoad } from "./dressing";
import { loadWeapons, weaponOf } from "./weapons";
import { drawMap, loadMap, type VillageMap } from "./map";
import { Roads, type Point } from "./roads";
import { crispText, MONO } from "./text";
import { playhead } from "@/lib/playhead";
import { sound } from "@/lib/sound";
import { bodyColours, GRID_LARGE, pixelate, portraitUrl, turned } from "@/lib/pixel-portrait";

/** A match being played in the arena: its two sides, the table between them, the running score over it, and the timer that drives both. */
type Brawl = { a: string; b: string; score: Phaser.GameObjects.Text; table: CardTable; ticker: Phaser.Time.TimerEvent };

/** Agent Quest's own hero size; the map's saved 0.4 leaves them too small to tell apart. */
const HERO_SCALE = 0.55;
/** Space between heroes waiting at a hall. */
const GRID_X = 50;
const GRID_Y = 42;
/** A match takes two spots facing each other; matches stand this far apart. */
const PAIR_GAP = 72;
const PAIR_X = 150;
const PAIR_Y = 60;
/** Matches stand in rows of this many before the arena, each in its own fixed spot. */
const ARENA_COLS = 3;
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
/** A stroll's end: the lake shore this often, anywhere else in the world otherwise. */
const SHORE_CHANCE = 0.6;
/** Of all strolls, this share go down the south road to the dock; of those, this share go in for a swim. */
const DOCK_CHANCE = 0.4;
const SWIM_CHANCE = 0.6;
/** Swimming is slower than walking; a swim is a few strokes out and about before climbing back out. */
const SWIM_PACE = 0.35;
const SWIM_LEGS: [number, number] = [2, 4];
/** How far out from the dock a swimmer goes: close enough to be watched from the shore. */
const SWIM_REACH = 200;
/** Within this of a road, a walk keeps to the roads; beyond it, it crosses open ground. */
const NEAR_ROAD = 110;

const between = ([lo, hi]: [number, number]) => lo + Math.random() * (hi - lo);

const COLOUR = { text: "#ede6d6", accent: "#e8b84b", live: "#6f9e5c", loss: "#d4745a", muted: "#a79f90" };

export type VillageEvents = {
  ready: () => void;
  selectAgent: (id: string | null) => void;
  selectBuilding: (id: string) => void;
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
  private pending: Resident[] | null = null;
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
    loadMap(this, this.map);
    // The places the map does not have bring their own pictures, from the site's root.
    this.load.setPath("");
    for (const b of this.opts.buildings) if (b.at && b.image) this.load.image(`building-${b.id}`, b.image);
    loadDressing(this);
    loadWeapons(this);
  }

  create(): void {
    this.cameras.main.setBackgroundColor("#141a24");
    // The map, less the trees in the clearings the dressing needs; then the dressing itself (dressing.ts).
    // Nor the trees that stood on its roads.
    drawMap(this, { ...this.map, decorations: this.map.decorations.filter((d) => !cleared(d) && !overRoad(d, this.map.paths)) });
    const solids = drawDressing(this, this.opts.still);

    const labels = new Map(this.opts.buildings.map((b) => [b.id, b]));
    const placed = this.opts.buildings.flatMap((b) => (b.at ? [{ id: b.id, ...b.at }] : []));
    for (const at of [...this.map.buildings, ...placed]) {
      const def = labels.get(at.id);
      if (!def) continue;
      const click = () => {
        if (!this.dragged) this.opts.events.selectBuilding(at.id);
      };
      const building = new Building(this, def, at, click, this.opts.nameFont);
      this.doors.set(at.id, building.door);
      this.buildings.set(at.id, building);
    }
    this.roads = new Roads(
      this.map.paths.map((p) => p.points.map(([x, y]) => ({ x, y }))),
      [...this.doors.values()],
    );
    this.ground = new Ground(this.map, [...[...this.buildings.values()].map((b) => b.footprint), ...solids]);
    this.gate = this.ground.nearestDry(this.map.spawn);

    // The dock: the map's one bridge, at the end of the south road. Swimmers make for open water near it,
    // clear of the rocks in the lake and of the dock itself.
    const bridge = this.map.decorations.find((d) => d.k.includes("bridge"));
    if (bridge && this.ground.inWater(bridge)) {
      this.dock = { x: bridge.x, y: bridge.y, halfWidth: 40, halfHeight: 45 };
      const rocks = this.map.decorations.filter((d) => d.k.includes("rocks"));
      this.swimSpots = this.ground.water.filter(
        (p) =>
          Math.hypot(p.x - bridge.x, p.y - bridge.y) < SWIM_REACH &&
          p.y > bridge.y + 50 &&
          !rocks.some((r) => Math.hypot(r.x - p.x, r.y - p.y) < 70) &&
          !this.onDock(p),
      );
    }

    // Night: a blue dark over the world, under the names so they still read.
    const { width, height } = this.map.world;
    this.night = this.add.rectangle(width / 2, height / 2, width * 3, height * 3, 0x0a1030, 0.45).setDepth(9_000);
    this.night.setVisible(this.isNight);
    this.solarLights = drawSolarLights(this, this.opts.still);
    this.solarLights.setNight(this.isNight);

    this.setUpCamera();
    this.setNotes(this.notes);
    this.opts.events.ready();
    if (this.pending) this.setResidents(this.pending);
  }

  // --- Camera -------------------------------------------------------------

  /** The part of the world with the buildings and the people in front of them. */
  private villageBounds(): Phaser.Geom.Rectangle {
    const xs = this.map.buildings.map((b) => b.x);
    const ys = this.map.buildings.map((b) => b.y);
    // Room at the sides for the outermost buildings' names, which hang past their roofs.
    const left = Math.min(...xs) - 170;
    // Room above the top row for the tallest roof and its name.
    const top = Math.min(...ys) - 230;
    return new Phaser.Geom.Rectangle(left, top, Math.max(...xs) + 170 - left, Math.max(...ys) + 150 - top);
  }

  /**
   * Never so far out that the world stops covering the whole canvas: the
   * village is the page's background, edge to edge, on a screen of any shape.
   * On a tall enough window this outranks maxZoom.
   */
  private minZoom(): number {
    const cam = this.cameras.main;
    return Math.max(cam.width / this.map.world.width, cam.height / this.map.world.height);
  }

  /**
   * The camera never looks past the world's edge, so there is never an empty
   * strip beside the map. Framing around a panel gives way to this: near an
   * edge, the village sits as close to the middle of the open part as the
   * world allows.
   */
  private updateBounds(): void {
    this.cameras.main.setBounds(0, 0, this.map.world.width, this.map.world.height);
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
    cam.setZoom(Phaser.Math.Clamp(Math.min(width / v.width, height / v.height), this.minZoom(), this.maxZoom()));
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

  setResidents(list: Resident[]): void {
    if (!this.roads) {
      this.pending = list;
      return;
    }
    this.pending = null;
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
        hero = new Hero(this, this.route, r.look, r.name, spawn, HERO_SCALE, {
          named: !r.house,
          nameColour: r.house ? COLOUR.text : COLOUR.accent,
          still: this.opts.still,
          onClick: () => {
            if (!this.dragged) this.opts.events.selectAgent(r.id);
          },
          inWater: (p) => this.ground.inWater(p) && !this.onDock(p),
        });
        this.heroes.set(r.id, hero);
        this.giveFace(r.id);
        hero.setWeapon(weaponOf(r.id));
        hero.setLabelScale(this.heroLabelScale());
        if (this.mine.has(r.id)) hero.setMine(true);
        if (r.id === this.selected) hero.setSelected(true);
      } else {
        hero.setName(r.name);
      }
      // A match has played out when its sides stop playing it - back to a hall,
      // or straight into the next one: its result then, and not before.
      if (before?.match && before.place === "arena" && r.match?.id !== before.match.id) {
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
      const toFight = this.residents.get(id)?.place === "arena";
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

  /** Out down the south road to the dock, to the lake shore, or anywhere in the world; a while there, then home. */
  private stroll(id: string): void {
    if (this.dock && Math.random() < DOCK_CHANCE) return this.toTheDock(id);
    const hero = this.heroes.get(id);
    const places = Math.random() < SHORE_CHANCE && this.ground.shore.length > 0 ? this.ground.shore : this.ground.anywhere;
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
      const door = this.doors.get(place);
      if (!door) continue;
      if (place === "arena") {
        this.layOutArena(ids, door, out);
        continue;
      }
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

  private giveFace(id: string): void {
    const views = { front: `head-${id}`, side: `head-${id}-side`, back: `head-${id}-back` };
    const known = this.bodies.get(id);
    if (known && this.textures.exists(views.back)) {
      this.heroes.get(id)?.setFace(views, known);
      return;
    }
    pixelate(portraitUrl(id, false), GRID_LARGE, true).then((data) => {
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
      this.bodies.set(id, colours);
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
      if (r.place !== "arena" || r.match?.seat !== "A") continue;
      const o = this.residents.get(r.match.opponent.id);
      if (o?.place === "arena" && o.match?.id === r.match.id) fights.set(r.match.id, [r.id, o.id]);
    }
    for (const [id, b] of this.brawls) {
      if (fights.has(id)) continue;
      b.ticker.remove();
      b.score.destroy();
      b.table.destroy();
      this.brawls.delete(id);
    }
    for (const [id, [a, b]] of fights) if (!this.brawls.has(id)) this.startBrawl(id, a, b);
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
    brawl.score.setVisible(together && clock !== null && clock !== undefined);
    if (!together || !clock) return;
    const { round, phase, within } = playhead(clock.roundsWon.length, Date.now() - clock.startedAt, clock.playMs);
    brawl.table.place({ x: ha.x, y: ha.y }, { x: hb.x, y: hb.y }, this.heroLabelScale());
    brawl.table.show(round, phase, within, clock.rounds[round] ?? null);
    const shown = phase === "outcome" || phase === "final" ? clock.roundsWon[round] : clock.roundsWon[round - 1];
    const won = shown ?? { A: 0, B: 0 };
    // Seat A stands on the left. At the end a star marks the side that took the match; a level match has none.
    const star = (s: "A" | "B") => (phase === "final" && won[s] > won[s === "A" ? "B" : "A"] ? "★" : "");
    brawl.score.setText(phase === "final" ? `${star("A")}${won.A} – ${won.B}${star("B")}` : `R${round + 1}  ${won.A} – ${won.B}`);
    brawl.score.setColor(phase === "final" ? COLOUR.live : COLOUR.accent);
    brawl.score.setScale(this.heroLabelScale());
    // High enough to clear the choices said over each side's head.
    brawl.score.setPosition((ha.x + hb.x) / 2, Math.min(ha.y, hb.y) - 58);
  }

  /** Each match's spot in the arena, kept for as long as it lasts: when one ends its spot frees, and nobody else moves. */
  private arenaSlots = new Map<string, number>();

  private layOutArena(ids: string[], door: Point, out: Map<string, Point & { facing?: "left" | "right" }>): void {
    // Both sides of a match stand together; a side whose opponent isn't on the field stands alone.
    const units: { key: string; ids: string[] }[] = [];
    const done = new Set<string>();
    for (const id of ids) {
      if (done.has(id)) continue;
      const match = this.residents.get(id)?.match;
      const other = match ? ids.find((o) => o !== id && this.residents.get(o)?.match?.id === match.id) : undefined;
      const pair = other ? [id, other] : [id];
      pair.forEach((p) => done.add(p));
      // Seat A on the left.
      units.push({ key: match?.id ?? id, ids: other && match?.seat === "B" ? [other, id] : pair });
    }
    const live = new Set(units.map((u) => u.key));
    for (const key of this.arenaSlots.keys()) if (!live.has(key)) this.arenaSlots.delete(key);
    const taken = new Set(this.arenaSlots.values());
    for (const u of units) {
      if (this.arenaSlots.has(u.key)) continue;
      let slot = 0;
      while (taken.has(slot)) slot++;
      taken.add(slot);
      this.arenaSlots.set(u.key, slot);
    }
    for (const u of units) {
      const slot = this.arenaSlots.get(u.key)!;
      const col = slot % ARENA_COLS;
      const cx = door.x - ((ARENA_COLS - 1) * PAIR_X) / 2 + col * PAIR_X;
      const y = door.y + Math.floor(slot / ARENA_COLS) * PAIR_Y;
      const [left, right] = u.ids;
      if (right === undefined) out.set(left!, { x: cx, y });
      else {
        out.set(left!, { x: cx - PAIR_GAP / 2, y, facing: "right" });
        out.set(right, { x: cx + PAIR_GAP / 2, y, facing: "left" });
      }
    }
  }

}
