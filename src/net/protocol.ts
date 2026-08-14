import type { GameState } from "../sim/types";
import type { InfiltratorInput } from "../sim/infiltrator";
import type { HunterInput } from "../sim/hunter";
import type { ChampionshipView, FinalChoice, RoundReport } from "./championship";

export const MAX_PLAYERS = 8;

export type { ChampionshipView, FinalChoice, RoundReport };

export type NetInput = InfiltratorInput &
  HunterInput & {
    shoot: boolean;
    shotSeq: number;
    targetId: string | null;
  };

export type LobbyMember = {
  id: string;
  name: string;
};

export type ClientMsg =
  | { t: "hello"; name: string }
  | { t: "start" }
  | { t: "input"; input: NetInput }
  | { t: "snapshot"; snap: Omit<GameState, "world"> }
  | { t: "roundEnd"; report: RoundReport }
  | { t: "ready"; ready: boolean }
  | { t: "vote"; choice: FinalChoice };

export type ServerMsg =
  | { t: "welcome"; you: string; hostId: string; members: LobbyMember[] }
  | { t: "lobby"; hostId: string; members: LobbyMember[] }
  | { t: "start"; hunterId: string; hiderIds: string[]; seed: number; roundNumber: number; totalRounds: number }
  | { t: "input"; from: string; input: NetInput }
  | { t: "snapshot"; snap: Omit<GameState, "world"> }
  | { t: "championship"; state: ChampionshipView }
  | { t: "error"; message: string }
  | { t: "closed"; reason: string };

const CODE_CHARS = "ACDEFGHJKMNPQRTUVWXY34679";

export function randomRoomCode(): string {
  let code = "";
  for (let i = 0; i < 4; i++) {
    code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return code;
}

export function emptyInput(): NetInput {
  return {
    forward: 0,
    strafe: 0,
    yaw: 0,
    pitch: 0,
    boliMode: false,
    sprint: false,
    crouch: false,
    shoot: false,
    shotSeq: 0,
    targetId: null,
  };
}
