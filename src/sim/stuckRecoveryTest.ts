import { createGame } from "./game";
import { tickBolis } from "./boliAi";
import { RHYTHM, type BoliState, type Entity, type GameState } from "./types";

const DT = 1 / 60;

export function runStuckRecoveryTests(): string[] {
  const lines: string[] = [];
  const pass = (name: string, ok: boolean, detail: string) => {
    lines.push((ok ? "PASS  " : "FAIL  ") + name + " — " + detail);
  };

  {
    const { state, rng } = isolatedGame();
    const boli = groundNpc(state);
    place(boli, 200, 520, 500, 520, "WANDER");
    const startX = boli.x;
    let maxStuck = 0;
    tickFor(state, rng, 1.2, () => {
      maxStuck = Math.max(maxStuck, boli.stuckTimer);
    });
    const moved = Math.hypot(boli.x - startX, boli.y - 520);
    const ok =
      boli.state === "WANDER" &&
      moved > 20 &&
      maxStuck < 0.5 &&
      Math.abs(boli.targetX - 500) < 1;
    pass("A libre", ok, `state=${boli.state} moved=${moved.toFixed(1)} maxStuck=${maxStuck.toFixed(2)} useful=${boli.stuckUseful.toFixed(1)}`);
  }

  {
    const { state, rng } = isolatedGame();
    const boli = groundNpc(state);
    place(boli, 146, 22, 146, 100, "WANDER");
    tickFor(state, rng, 2.6);
    const recovered = boli.stuckRecoverTtl > 0 || !sameTarget(boli, 146, 100) || boli.state === "PAUSE";
    pass(
      "B frontal",
      recovered && boli.y < 40 && boli.state !== "DANCE",
      `state=${boli.state} recov=${boli.stuckRecoverTtl.toFixed(2)} y=${boli.y.toFixed(1)} target=${boli.targetX.toFixed(0)},${boli.targetY.toFixed(0)}`,
    );
  }

  {
    const { state, rng } = isolatedGame();
    const boli = groundNpc(state);
    place(boli, 90, 22, 146, 100, "WANDER");
    tickFor(state, rng, 0.9);
    const xAfterHit = boli.x;
    const stuckAfterHit = boli.stuckTimer;
    let xLater = xAfterHit;
    let stuckLater = stuckAfterHit;
    let usefulLater = boli.stuckUseful;
    tickFor(state, rng, 0.9, () => {
      xLater = boli.x;
      stuckLater = boli.stuckTimer;
      usefulLater = boli.stuckUseful;
    });
    const slid = xLater - xAfterHit > 4;
    const timerGrew = stuckLater > stuckAfterHit + 0.4;
    const usefulLow = usefulLater < RHYTHM.speed * RHYTHM.stuckApproachRatio;
    pass(
      "C deslizamiento",
      slid && timerGrew && usefulLow,
      `Δx=${(xLater - xAfterHit).toFixed(1)} stuck ${stuckAfterHit.toFixed(2)}→${stuckLater.toFixed(2)} useful=${usefulLater.toFixed(1)} toward=${boli.stuckToward.toFixed(1)}`,
    );
  }

  {
    const { state, rng } = isolatedGame();
    const boli = groundNpc(state);
    place(boli, 146, 22, 146, 100, "REGROUP");
    boli.regroupPoiId = "check-house";
    state.behaviorCheck = {
      kind: "house",
      ttl: 20,
      x: 146,
      y: 100,
      radius: 42,
      banner: "los bolis entran a la casa chica",
    };
    tickFor(state, rng, 2.7);
    const kept = sameTarget(boli, 146, 100) && boli.regroupPoiId === "check-house";
    const reacted = boli.stuckRecoverTtl > 0 || boli.stuckRetries > 0;
    tickFor(state, rng, 0.6);
    const retried = kept && sameTarget(boli, 146, 100) && boli.stuckRecoverTtl === 0;
    pass(
      "D objetivo especial",
      kept && reacted && retried,
      `kept=${kept} retries=${boli.stuckRetries} recov=${boli.stuckRecoverTtl.toFixed(2)} state=${boli.state} target=${boli.targetX.toFixed(0)},${boli.targetY.toFixed(0)}`,
    );
  }

  {
    const { state, rng } = isolatedGame();
    const boli = groundNpc(state);
    place(boli, 240, 500, 520, 500, "WANDER");
    let maxStuck = 0;
    tickFor(state, rng, 2.4, () => {
      maxStuck = Math.max(maxStuck, boli.stuckTimer);
    });
    const ok = boli.state === "WANDER" && maxStuck < 0.6 && boli.x > 280;
    pass("E continuo", ok, `maxStuck=${maxStuck.toFixed(2)} x=${boli.x.toFixed(1)} useful=${boli.stuckUseful.toFixed(1)}`);
  }

  {
    const { state, rng } = isolatedGame();
    const boli = groundNpc(state);
    place(boli, 260, 500, 268, 500, "WANDER");
    boli.stateTimer = 8;
    tickFor(state, rng, 0.6);
    const afterArrive = boli.state;
    const arrived = afterArrive === "DANCE" || afterArrive === "PAUSE";
    tickFor(state, rng, RHYTHM.danceMax + RHYTHM.pauseMax + 0.4);
    const resumed = boli.state === "WANDER" || boli.state === "REGROUP";
    pass("F cambio normal", arrived && resumed, `afterArrive=${afterArrive} later=${boli.state}`);
  }

  const failed = lines.some((line) => line.startsWith("FAIL"));
  lines.push(failed ? "RESULTADO: FALLÓ" : "RESULTADO: OK");
  return lines;
}

function isolatedGame(): { state: GameState; rng: () => number } {
  const rng = Math.random;
  const state = createGame({ hiderIds: [], hunterId: null, rng });
  state.behaviorCheck = null;
  state.behaviorCheckCooldown = 1e9;
  state.herdPulseCooldown = 1e9;
  state.regroup.poiId = null;
  state.regroup.cooldown = 1e9;
  return { state, rng };
}

function groundNpc(state: GameState): Entity {
  const boli = state.entities.find((entity) => !entity.isPlayer && !entity.downed && entity.layer === "ground");
  if (!boli) {
    throw new Error("no hay NPC en suelo");
  }
  return boli;
}

function place(entity: Entity, x: number, y: number, tx: number, ty: number, stateName: BoliState): void {
  entity.x = x;
  entity.y = y;
  entity.z = 0;
  entity.vz = 0;
  entity.layer = "ground";
  entity.state = stateName;
  entity.targetX = tx;
  entity.targetY = ty;
  entity.goalX = tx;
  entity.goalY = ty;
  entity.route = null;
  entity.routeStep = 0;
  entity.stateTimer = 30;
  entity.regroupPoiId = stateName === "REGROUP" ? "check-house" : null;
  entity.stuckTimer = 0;
  entity.stuckX = x;
  entity.stuckY = y;
  entity.stuckGoalDist = Math.hypot(tx - x, ty - y);
  entity.stuckRecoverTtl = 0;
  entity.stuckRetries = 0;
  entity.stuckSpeed = 0;
  entity.stuckToward = 0;
  entity.stuckUseful = 0;
}

function tickFor(state: GameState, rng: () => number, seconds: number, each?: () => void): void {
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) {
    tickBolis(state, DT, rng);
    each?.();
  }
}

function sameTarget(entity: Entity, x: number, y: number): boolean {
  return Math.hypot(entity.targetX - x, entity.targetY - y) < 8;
}

const node = (globalThis as { process?: { argv?: string[]; exit?: (code: number) => void } }).process;
const invoked = node?.argv?.[1] ?? "";
if (invoked.replace(/\\/g, "/").endsWith("stuckRecoveryTest.ts")) {
  const failed = runStuckRecoveryTests().some((line) => {
    console.log(line);
    return line.startsWith("FAIL");
  });
  node?.exit?.(failed ? 1 : 0);
}
