# Autonomous world activities — Phase 1

Waiting residents now choose farming, gathering, deliveries or exploration,
walk there, spend time working, complete the activity, walk home and rest.
Matches and retirement interrupt this loop. Users observe; there are no movement
controls. The existing holder-to-agent mapping, autoplay games and payouts are
unchanged.

## Architecture

`web/app/village/game/activities.ts` is a pure, renderer-independent state
machine. Identity-seeded preferences and cycle-seeded choices vary each agent's
routine. Nearby destinations have higher selection weight; capabilities determine
which activities a destination supports. Capacity limits and stable small offsets
spread residents around work sites.

`activity-destinations.ts` describes the existing four North Farm beds, woodland
clearings, river rocks, terrace and building forecourts. Delivery jobs have
separate pickup and unloading stages. The source and target must differ. The
Arena destination is outside the entrance, away from the fighting floor. The
Launch Pad and Bazaar destinations follow their existing feature flag.

The Phaser scene supplies positions, route validation and walking callbacks.
The simulation never moves or teleports a character itself. It uses one shared
250 ms tick and at most eight new routes per tick, including return journeys.
Actual arrival is required before work starts; elapsed travel time alone cannot
complete an activity. Route rejection causes a short rest and another attempt.
Work, initial staggering and rest durations are centralized in `ACTIVITY_CONFIG`.

Feed refreshes preserve current work and update the home destination. Matches,
construction assignments and removal invalidate pending callbacks. A trip token
also rejects duplicate callbacks from an older journey. Completion records are
bounded to the most recent four per resident.

Ground routing checks every crossed tile when smoothing paths, rather than
sampling segments that can miss a narrow water corner. It retains the start and
goal cell centres when necessary. Road paths still use the existing graph and
are checked against ground obstacles before use.

The compact Agent panel and Field inspection show activity and destination,
including delivery routes. Agent view adds a small phase progress bar. Travel
progress is an estimate and stays below 100% until the walking callback confirms
arrival. Rendering retains existing offscreen animation culling. Reduced-motion
mode retains the existing still-world behavior.

## Persistence and rewards boundary

This first phase extends the current **browser-session world simulation**.
Activity state survives live feed refreshes and page navigation within the shell,
but resets when the world is recreated or the page is reloaded. Different viewers
can see different routine timing. There is no new database schema or API.

Completions contain agent/activity/source/destination identifiers, start/completion
times, distance and success. They award **no XP, resources, reputation, reward
points or tokens**. Client completion records are not authoritative and must never
be accepted as payout claims.

Phase 2 must move reward-bearing progression into a server-owned, persisted
simulation with idempotent completion processing before connecting an economy
or reward-pool interface. Later phases add richer work animations and rotating
Notice Board jobs on top of the validated activity lifecycle.

## Files for this phase

- `web/app/village/game/activities.ts`: state machine, selection, timing and results.
- `web/app/village/game/activity-destinations.ts`: capability and capacity metadata.
- `web/app/village/game/scene.ts`: lifecycle, shared tick, routes and HUD snapshots.
- `web/app/village/game/hero.ts`: consume the route already validated by the scene.
- `web/app/village/game/ground.ts`: safe smoothing around water and obstacle corners.
- `web/app/village/game/presentation.ts`: activity state in selected-agent snapshots.
- `web/app/village/agent-status.tsx`: compact progress display.
- `test/activities.test.ts`: selection, work/delivery transitions, cancellation,
  unreachable goals, bounded history, site capacities and 1,000-agent routing.
- `docs/autonomous-activities.md`: architecture, scope and next-phase boundary.

Neither package currently defines a lint script. Use root and web typechecks,
the repository check, affected world tests and the web production build. Browser
verification uses mocked public/owner feeds and performs no wallet transactions.

Validation for this milestone: `npm run check` passed 505 main-suite tests plus
10 tests against real PostgreSQL. The web typecheck and production build passed.
The 76 affected world/activity tests passed, with an additional launch-enabled
run covering 26 tests. A 90-second browser simulation retained activity states
for all 1,000 residents, observed every activity and rest, and confirmed timed
completions, the Agent follow camera and progress UI. It reported no page errors
and made no API mutations. Local previews are in `web/.shots/activities-field.png`
and `web/.shots/activities-agent.png` (ignored by Git).
