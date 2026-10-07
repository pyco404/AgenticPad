# Autonomous world activities

Agents autonomously farm, gather, carry deliveries, explore, return home and
rest between matches. Users observe; there are no movement controls. **Only
Bluff & Fold earns agent rewards.** Town activities and Notice Board jobs are
cosmetic entertainment and never affect ranked scores or payouts.

House residents participate in all the same activities and autonomous Notice
Board errands. Their inclusion does not change house reward eligibility.

## Shared simulation and persistence

`web/lib/world/activities.ts` is the renderer-independent activity state machine.
Identity-seeded preferences and cycle-seeded choices vary routines. Nearby
capable destinations have higher selection weight. Capacity limits and stable
small offsets spread agents around work sites. Delivery has separate pickup,
travel and unloading stages; source and target must differ.

`web/lib/world/simulation.ts` supplies the server clock, arc-length route playback,
serializable checkpoints and cosmetic Notice Board claims. Checkpoints preserve
agent IDs, homes, cycle/trip IDs, phase timing, paths, the fair routing cursor,
recent completions and current job claims. The last four completions per agent
are retained; duplicate callbacks and stale trip tokens cannot complete twice.

`src/db/world-activities.ts` runs independently of browser sessions. `npm start`
starts it automatically after migrations. One non-overlapping pass runs about
every two seconds, advances a shared tick, then saves a checkpoint in
`world_activities`. A PostgreSQL row lock serializes replicas; a second worker
at the same timestamp does not advance the world twice. There are at most eight
new routes per simulated second, including return journeys.

An API process restart resumes the saved journey, work or rest. Normal activity
continues while every browser is closed. If the API itself was down, recovery
processes at most a minute of transitions before resuming the saved routine;
it does not invent hours of completed jobs. The world requires a running API
worker to advance. Failed passes roll back and retry without committing partial
claims or completions.

New agents join automatically. Retired agents leave the simulation. Bluff & Fold
playback interrupts an errand and takes priority; other agents, including other
token agents belonging to the same wallet, keep their own routines. Homes remain
stable across feed refreshes and checkpoints. Opened neighbourhoods persist
through the checkpoint's peak population count.

## Navigation and presentation

`web/lib/world/` holds the renderer-independent geometry and the two modules
above, with compatibility exports at the existing browser module paths. It
lives under `web/` because the web service builds from that directory alone;
the API, which ships the whole repository, imports it from there. Neither the match engine nor the
API imports Phaser or the village renderer. `src/world/navigation.ts` reuses
the map's pure water, road, building, oval-arena,
forest and growth geometry, plus existing art dimensions, without loading
Phaser. It reserves building/wall footprints and checks routes against dry
ground. Actual route arrival is required before work starts. Rejected goals
cause a short rest and another attempt. The Arena work site is outside its gate.

`GET /field` adds an optional `worldActivity` snapshot to each public agent,
with a route, server timestamps, phase, position and revision. No wallet/private
account data is added. Reads never finish jobs or mutate the simulation. The
client uses a monotonic elapsed clock against the snapshot, interpolates along
the saved route's bends and stops at its endpoint if the feed becomes stale.
Agent and Field use this same state. The Agent follow camera remains autonomous.

Work tools, gathering baskets/sparkles, delivery parcels, exploration maps and
look-around pauses, and resting seat/sleep pixels make phases visible. They use
native pixel drawing and the existing pose clock; no replacement character
assets are required. Offscreen positions continue to advance. Drawing/pose
updates are bounded, and tiny props are omitted in the distant global view.
Reduced-motion settings keep poses still while reflecting current snapshots.

Older APIs without the snapshot field and local mock previews can still use the
browser-session simulation through the compatibility export in
`web/app/village/game/activities.ts`. Production snapshots are authoritative;
a temporarily missing state does not start a competing local routine.

## Notice Board jobs

`GET /world/jobs` exposes cosmetic town errands with title, expiry, capacity and
accepted count. Jobs rotate every 30 minutes. Agents autonomously accept a
compatible job when choosing a routine; no user acceptance or movement endpoint
exists. Claims are persisted atomically with activity state, limited to one per
agent/job and the posted capacity. Jobs with too little remaining time are not
accepted. Expiry cancels unfinished work without a completion. Ordinary routines
continue when no matching job is available. The existing Notice Board card also
keeps its match highlights.

## Rewards boundary

World completions contain activity/source/destination identifiers, times,
distance and success for observation only. They award **no XP, resources,
reputation, reward points or tokens**. They must never affect power, conviction,
ranked scores, payout eligibility or allocation, and are never connected to a
reward wallet. The previously proposed activity economy was cancelled by the
user's clarification on 2026-10-07.

Existing holder qualification, per-token agents, Bluff & Fold autoplay, wallet
features, match scoring and payout approvals are unchanged.

## Deployment and verification

Deploy both API and web. `npm start` applies `0035_world_activities.sql` and
starts the worker; a development API started with `npm run serve` needs
`-- --migrate` when applying this change. The API needs access to the existing
`web/public` map/art files (the repository's normal root deployment includes
them). Set `NEXT_PUBLIC_LAUNCHPAD` consistently on API and web so optional
Launch Pad/Bazaar geometry and destinations agree. No new keys are required.

Run root `npm run check`, web `npm run typecheck`, and the web production build.
`test/world-activities.test.ts` covers restart recovery, timed completion,
bounded history, job claims/expiry, interruption, dry routes, 1,000 residents,
read-only snapshots, database persistence and the absence of score writes.
The PostgreSQL suite covers JSON round trips and simultaneous worker replicas;
HTTP tests cover the additive public contracts. Browser verification uses mocked
feeds and performs no wallet transactions.
