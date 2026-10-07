import { ACTIVITY_CONFIG, ActivitySimulation, activityHash, type ActivityDestination, type ActivityEntry,
  type ActivityState, type NoticeJob, type Point } from "./activities";

export type WorldMotion = { path: Point[]; startedAt: number; endsAt: number };
export type WorldActivity = { state: ActivityState; position: Point; motion: WorldMotion | null; at: number; revision: string };
export type WorldCheckpoint = { version: 1; at: number; entries: ActivityEntry[]; positions: Record<string, Point>; claims: Record<string, string[]>; cursor?: number };
export const JOB_WINDOW_MS = 30 * 60_000;

/** Cosmetic jobs rotate together across every viewer. No economy or reward data belongs here. */
export function noticeJobs(now: number, destinations: readonly ActivityDestination[]): NoticeJob[] {
  const window = Math.floor(now / JOB_WINDOW_MS);
  const jobs: NoticeJob[] = [];
  for (const d of destinations) {
    const activity = d.capabilities.includes("farm") ? "farming" : d.capabilities.includes("gather") ? "gathering" : "exploration";
    if (!d.capabilities.includes("farm") && !d.capabilities.includes("gather") && !d.capabilities.includes("explore")) continue;
    jobs.push({ id: `${window}:${d.id}:${activity}`, title: `${activity === "farming" ? "Tend" : activity === "gathering" ? "Search" : "Survey"} ${d.name}`,
      expiresAt: (window + 1) * JOB_WINDOW_MS, capacity: Math.min(12, d.capacity), activity, sourceId: null, targetId: d.id });
  }
  const sources = destinations.filter((d) => d.capabilities.includes("delivery-source"));
  for (const [i, d] of sources.entries()) {
    const targets = destinations.filter((t) => t.id !== d.id && t.capabilities.includes("delivery-target"));
    const target = targets[(window + i) % targets.length];
    if (target) jobs.push({ id: `${window}:${d.id}:delivery`, title: `Parcel: ${d.name} → ${target.name}`,
      expiresAt: (window + 1) * JOB_WINDOW_MS, capacity: 8, activity: "delivery", sourceId: d.id, targetId: target.id });
  }
  return jobs;
}

/** Arc-length interpolation never cuts across bends or shorelines. Stops at the saved endpoint on a stale feed. */
const motionLengths = new WeakMap<WorldMotion, { lengths: number[]; total: number }>();
export function motionPosition(motion: WorldMotion, now: number): Point {
  const path = motion.path;
  if (path.length < 2) return path[0] ?? { x: 0, y: 0 };
  let cached = motionLengths.get(motion);
  if (!cached) {
    const lengths = path.slice(1).map((p, i) => Math.hypot(p.x - path[i]!.x, p.y - path[i]!.y));
    cached = { lengths, total: lengths.reduce((a, b) => a + b, 0) }; motionLengths.set(motion, cached);
  }
  const { lengths, total } = cached;
  let distance = total * Math.max(0, Math.min(1, (now - motion.startedAt) / Math.max(1, motion.endsAt - motion.startedAt)));
  for (let i = 0; i < lengths.length; i++) {
    const length = lengths[i]!;
    if (distance <= length && length > 0) {
      const a = path[i]!, b = path[i + 1]!, t = distance / length;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    distance -= length;
  }
  return path.at(-1)!;
}

export function activitySnapshot(e: ActivityEntry, position: Point, now: number): WorldActivity {
  const dest = e.leg === "source" ? e.plan?.source : e.plan?.target;
  const state: ActivityState = { activity: e.plan?.activity ?? "idle", phase: e.phase,
    destinationId: e.leg === "home" ? null : dest?.id ?? null,
    destination: e.leg === "home" ? "Home forecourt" : dest?.name ?? "Home forecourt",
    route: e.plan?.source ? `${e.plan.source.name} → ${e.plan.target.name}` : null,
    carrying: e.plan?.activity === "delivery" && e.leg === "target",
    startedAt: e.phaseAt, completesAt: e.until > e.phaseAt ? e.until : null,
    progress: e.until > e.phaseAt ? Math.max(0, Math.min(e.moving ? 0.95 : 1, (now - e.phaseAt) / (e.until - e.phaseAt))) : 0,
    ...(e.plan?.job ? { job: e.plan.job } : {}) };
  if (e.sparring) state.sparring = e.sparring;
  const motion = e.moving ? { path: e.path, startedAt: e.phaseAt, endsAt: e.until } : null;
  return { state, motion, position: motion ? motionPosition(motion, now) : position, at: now, revision: `${e.trip}:${e.phase}:${e.phaseAt}` };
}

/** The host's clock and routes belong to the API worker, never to an open browser. */
export class WorldSimulation {
  readonly simulation: ActivitySimulation;
  private positions: Map<string, Point>;
  private motions = new Map<string, WorldMotion & { arrived: () => void }>();
  private claims: Record<string, string[]>;
  private now: number;
  constructor(readonly destinations: readonly ActivityDestination[], route: (from: Point, to: Point) => Point[] | null,
    checkpoint: WorldCheckpoint = { version: 1, at: 0, entries: [], positions: {}, claims: {} }) {
    this.now = checkpoint.at;
    this.positions = new Map(Object.entries(checkpoint.positions));
    this.claims = structuredClone(checkpoint.claims);
    this.simulation = new ActivitySimulation(destinations, {
      position: (id) => this.position(id),
      prepare: (id, to) => { const from = this.position(id); return from ? route(from, to) : null; },
      travel: (id, path, arrived) => {
        const state = this.simulation.state(id, this.now)!;
        this.motions.set(id, { path, startedAt: state.startedAt, endsAt: state.completesAt ?? this.now, arrived });
      },
      rest: (id) => {
        const position = this.position(id);
        if (position) this.positions.set(id, position);
        this.motions.delete(id);
      },
      assignJob: (id, plan, now) => {
        const job = noticeJobs(now, destinations).find((j) => j.activity === plan.activity && j.sourceId === (plan.source?.id ?? null) && j.targetId === plan.target.id);
        if (!job || activityHash(`${id}:${job.id}`) % 3 !== 0) return undefined;
        const claims = this.claims[job.id] ?? [];
        if (claims.length >= job.capacity || claims.includes(id) || now + 5 * 60_000 >= job.expiresAt) return undefined;
        this.claims[job.id] = [...claims, id];
        return job;
      },
    });
    this.simulation.restore(checkpoint.entries, this.now, checkpoint.cursor);
  }
  position(id: string): Point | null {
    const motion = this.motions.get(id);
    return motion ? motionPosition(motion, this.now) : this.positions.get(id) ?? null;
  }
  sync(residents: readonly { id: string; home: Point; interrupted?: boolean }[], now: number): void {
    this.now = now;
    const keep = new Set(residents.filter((r) => !r.interrupted).map((r) => r.id));
    for (const id of this.positions.keys()) if (!keep.has(id)) {
      this.simulation.remove(id); this.positions.delete(id); this.motions.delete(id);
    }
    for (const r of residents) if (keep.has(r.id)) {
      if (!this.positions.has(r.id)) this.positions.set(r.id, r.home);
      this.simulation.add(r.id, r.home, now);
    }
  }
  tick(now: number): void {
    if (now < this.now) return;
    this.now = now;
    this.simulation.tick(now);
    for (const [id, motion] of this.motions) if (now >= motion.endsAt) {
      this.positions.set(id, motion.path.at(-1)!);
      this.motions.delete(id); motion.arrived();
    }
    const window = Math.floor(now / JOB_WINDOW_MS);
    for (const id of Object.keys(this.claims)) if (!id.startsWith(`${window}:`)) delete this.claims[id];
  }
  save(): WorldCheckpoint {
    return { version: 1, at: this.now, entries: this.simulation.save(), positions: Object.fromEntries(this.positions), claims: structuredClone(this.claims), cursor: this.simulation.routingCursor };
  }
}

export { ACTIVITY_CONFIG };
