import { applyRoundScores, SCORE, scorePlayer, rankByTotal, winnerIds } from "./championship";

function assert(ok: boolean, name: string): void {
  if (!ok) {
    throw new Error(`FAIL ${name}`);
  }
  console.log(`PASS ${name}`);
}

const boli = scorePlayer(
  {
    id: "a",
    startedAs: "INFILTRATOR",
    survived: true,
    objectivesCompleted: 2,
    eliminations: 0,
    wasHunter: false,
  },
  false,
);
assert(boli === SCORE.boliSurvive + SCORE.boliObjective * 2, "boli survive + 2 objectives");

const hunter = scorePlayer(
  {
    id: "b",
    startedAs: "HUNTER",
    survived: false,
    objectivesCompleted: 0,
    eliminations: 2,
    wasHunter: true,
  },
  true,
);
assert(hunter === SCORE.hunterElimination * 2 + SCORE.hunterVictory, "hunter 2 kills + win");

const converted = scorePlayer(
  {
    id: "c",
    startedAs: "INFILTRATOR",
    survived: false,
    objectivesCompleted: 1,
    eliminations: 1,
    wasHunter: true,
  },
  true,
);
assert(
  converted === SCORE.boliObjective + SCORE.hunterElimination + SCORE.hunterVictory,
  "converted boli: 1 objective + 1 kill + win, no survive",
);

const near = scorePlayer(
  {
    id: "d",
    startedAs: "INFILTRATOR",
    survived: false,
    objectivesCompleted: 0,
    eliminations: 0,
    wasHunter: false,
  },
  false,
);
assert(near === 0, "near objective without done is 0");

const totals = new Map<string, number>([
  ["a", 100],
  ["b", 0],
]);
applyRoundScores(totals, {
  outcome: "INFILTRATOR_WIN",
  players: [
    { id: "a", startedAs: "INFILTRATOR", survived: true, objectivesCompleted: 0, eliminations: 0, wasHunter: false },
    { id: "b", startedAs: "HUNTER", survived: false, objectivesCompleted: 0, eliminations: 0, wasHunter: true },
  ],
});
assert(totals.get("a") === 180, "accumulated survive added to previous total");
assert(totals.get("b") === 0, "losing hunter with no kills stays 0");

const ranks = rankByTotal([
  { id: "a", totalPoints: 200 },
  { id: "b", totalPoints: 200 },
  { id: "c", totalPoints: 100 },
]);
assert(ranks.get("a") === 1 && ranks.get("b") === 1 && ranks.get("c") === 3, "ties keep equal rank");
assert(winnerIds([
  { id: "a", totalPoints: 200 },
  { id: "b", totalPoints: 200 },
  { id: "c", totalPoints: 100 },
]).sort().join(",") === "a,b", "tied winners");

console.log("OK");
