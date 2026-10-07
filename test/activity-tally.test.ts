import { expect, it } from "vitest";
import { townActivityTally } from "../web/app/village/activity-tally";
import { placeResidents } from "../web/app/village/residents";
import type { WorldActivity } from "../web/lib/world/simulation";

it("counts house and holder town life without counting matches, retired agents or replay stand-ins", () => {
  const activity: WorldActivity = { state: { activity: "farming", phase: "working", destinationId: "farm", destination: "Farm", route: null, startedAt: 0, completesAt: 1000, progress: .5 }, position: { x: 0, y: 0 }, motion: null, at: 500, revision: "1" };
  const residents = placeResidents([
    { id: "house", name: "House", house: true, retiredAt: null, presetName: null, worldActivity: activity },
    { id: "holder", name: "Holder", house: false, retiredAt: null, presetName: null, worldActivity: activity },
    { id: "retired", name: "Retired", house: false, retiredAt: "2026-10-07", presetName: null, worldActivity: activity },
  ], []);
  expect(townActivityTally(residents).farming).toBe(2);
  expect(townActivityTally([...residents, { ...residents[0]!, place: "arena" }, { ...residents[0]!, place: "duel" }, { ...residents[0]!, standIn: "house" }]).farming).toBe(2);
  const resting = { ...residents[0]!, worldActivity: { ...activity, state: { ...activity.state, phase: "returning" as const } } };
  expect(townActivityTally([resting])).toMatchObject({ farming: 0, resting: 1 });
});
