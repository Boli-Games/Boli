/** Championship session: 5 rounds, server-owned scores / ready / final votes. */

export const TOTAL_ROUNDS = 5;

/**
 * Points from events the sim already records.
 * Bolis: survival at round end + objectives they were inside when `done` flipped.
 * Hunters: player eliminations (not NPCs) + hunter-team round win.
 * Missing in the sim (not scored): interrupted objectives, damage dealt, ammo leftover.
 */
export const SCORE = {
  boliSurvive: 80,
  boliObjective: 50,
  hunterElimination: 60,
  hunterVictory: 80,
} as const;

export type FinalChoice = "replay" | "menu";

export type ChampionshipPhase = "playing" | "round_results" | "championship_results";

export type RoundOutcome = "HUNTER_WIN" | "INFILTRATOR_WIN";

export type PlayerRoundFacts = {
  id: string;
  startedAs: "INFILTRATOR" | "HUNTER";
  survived: boolean;
  objectivesCompleted: number;
  eliminations: number;
  wasHunter: boolean;
};

export type RoundReport = {
  outcome: RoundOutcome;
  players: PlayerRoundFacts[];
};

export type ScoreRow = {
  id: string;
  name: string;
  role: string;
  roundPoints: number;
  totalPoints: number;
  rank: number;
  connected: boolean;
  ready: boolean;
  vote: FinalChoice | null;
  winner: boolean;
};

export type ChampionshipView = {
  phase: ChampionshipPhase;
  roundNumber: number;
  totalRounds: number;
  outcome: RoundOutcome | null;
  rows: ScoreRow[];
  readyCount: number;
  readyNeed: number;
  voteReplay: number;
  voteMenu: number;
  locked: boolean;
};

export function sanitizeReport(raw: RoundReport, allowedIds: Set<string>): RoundReport {
  const outcome: RoundOutcome = raw.outcome === "HUNTER_WIN" ? "HUNTER_WIN" : "INFILTRATOR_WIN";
  const seen = new Set<string>();
  const players: PlayerRoundFacts[] = [];
  for (const item of raw.players ?? []) {
    if (!item || typeof item.id !== "string" || !allowedIds.has(item.id) || seen.has(item.id)) {
      continue;
    }
    seen.add(item.id);
    const startedAs = item.startedAs === "HUNTER" ? "HUNTER" : "INFILTRATOR";
    const wasHunter = Boolean(item.wasHunter) || startedAs === "HUNTER";
    players.push({
      id: item.id,
      startedAs,
      survived: startedAs === "INFILTRATOR" && Boolean(item.survived),
      objectivesCompleted: startedAs === "INFILTRATOR" ? clampInt(item.objectivesCompleted, 0, 8) : 0,
      eliminations: wasHunter ? clampInt(item.eliminations, 0, 16) : 0,
      wasHunter,
    });
  }
  return { outcome, players };
}

export function scorePlayer(facts: PlayerRoundFacts, hunterWin: boolean): number {
  let points = 0;
  if (facts.startedAs === "INFILTRATOR") {
    if (facts.survived) {
      points += SCORE.boliSurvive;
    }
    points += facts.objectivesCompleted * SCORE.boliObjective;
  }
  if (facts.wasHunter) {
    points += facts.eliminations * SCORE.hunterElimination;
    if (hunterWin) {
      points += SCORE.hunterVictory;
    }
  }
  return points;
}

export function roleLabel(facts: PlayerRoundFacts): string {
  if (facts.startedAs === "HUNTER") {
    return "Cazador";
  }
  if (facts.wasHunter) {
    return "Boli → Cazador";
  }
  return "Boli";
}

export function applyRoundScores(
  totals: Map<string, number>,
  report: RoundReport,
): Map<string, { roundPoints: number; totalPoints: number; role: string }> {
  const hunterWin = report.outcome === "HUNTER_WIN";
  const next = new Map<string, { roundPoints: number; totalPoints: number; role: string }>();
  for (const facts of report.players) {
    const roundPoints = scorePlayer(facts, hunterWin);
    const totalPoints = (totals.get(facts.id) ?? 0) + roundPoints;
    totals.set(facts.id, totalPoints);
    next.set(facts.id, { roundPoints, totalPoints, role: roleLabel(facts) });
  }
  return next;
}

export function rankByTotal(totals: Array<{ id: string; totalPoints: number }>): Map<string, number> {
  const ordered = [...totals].sort((a, b) => {
    if (b.totalPoints !== a.totalPoints) {
      return b.totalPoints - a.totalPoints;
    }
    return a.id.localeCompare(b.id);
  });
  const ranks = new Map<string, number>();
  let lastTotal = Number.NaN;
  let lastRank = 0;
  ordered.forEach((row, index) => {
    const rank = row.totalPoints === lastTotal ? lastRank : index + 1;
    ranks.set(row.id, rank);
    lastTotal = row.totalPoints;
    lastRank = rank;
  });
  return ranks;
}

export function winnerIds(totals: Array<{ id: string; totalPoints: number }>): string[] {
  if (totals.length === 0) {
    return [];
  }
  const best = Math.max(...totals.map((row) => row.totalPoints));
  return totals.filter((row) => row.totalPoints === best).map((row) => row.id);
}

function clampInt(value: unknown, min: number, max: number): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : 0;
  return Math.max(min, Math.min(max, n));
}
