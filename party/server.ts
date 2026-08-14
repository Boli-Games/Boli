import { Server, type Connection, routePartykitRequest } from "partyserver";
import {
  TOTAL_ROUNDS,
  applyRoundScores,
  rankByTotal,
  sanitizeReport,
  winnerIds,
  type ChampionshipPhase,
  type ChampionshipView,
  type FinalChoice,
  type RoundOutcome,
  type RoundReport,
} from "../src/net/championship";

const MAX_PLAYERS = 8;

type ClientMsg =
  | { t: "hello"; name: string }
  | { t: "start" }
  | { t: "input"; input: unknown }
  | { t: "snapshot"; snap: unknown }
  | { t: "roundEnd"; report: RoundReport }
  | { t: "ready"; ready: boolean }
  | { t: "vote"; choice: FinalChoice };

type ServerMsg =
  | { t: "welcome"; you: string; hostId: string; members: { id: string; name: string }[] }
  | { t: "lobby"; hostId: string; members: { id: string; name: string }[] }
  | { t: "start"; hunterId: string; hiderIds: string[]; seed: number; roundNumber: number; totalRounds: number }
  | { t: "input"; from: string; input: unknown }
  | { t: "snapshot"; snap: unknown }
  | { t: "championship"; state: ChampionshipView }
  | { t: "error"; message: string }
  | { t: "closed"; reason: string };

type RosterEntry = {
  name: string;
  connected: boolean;
};

export class BoliRoom extends Server {
  hostId: string | null = null;
  playing = false;
  names = new Map<string, string>();
  champPhase: ChampionshipPhase | "lobby" = "lobby";
  roundNumber = 0;
  totals = new Map<string, number>();
  roster = new Map<string, RosterEntry>();
  lastRound = new Map<string, { roundPoints: number; totalPoints: number; role: string }>();
  ready = new Map<string, boolean>();
  votes = new Map<string, FinalChoice>();
  outcome: RoundOutcome | null = null;
  locked = false;

  onConnect(conn: Connection): void {
    if (this.playing) {
      send(conn, { t: "error", message: "La ronda ya empezó." });
      conn.close();
      return;
    }
    if (this.names.size >= MAX_PLAYERS) {
      send(conn, { t: "error", message: "Sala llena." });
      conn.close();
      return;
    }
    if (!this.hostId) {
      this.hostId = conn.id;
    }
    this.names.set(conn.id, "Jugador");
    send(conn, {
      t: "welcome",
      you: conn.id,
      hostId: this.hostId,
      members: this.members(),
    });
    this.broadcastLobby();
  }

  onMessage(conn: Connection, raw: string | ArrayBuffer): void {
    if (typeof raw !== "string") {
      return;
    }
    let msg: ClientMsg;
    try {
      msg = JSON.parse(raw) as ClientMsg;
    } catch {
      return;
    }

    if (msg.t === "hello") {
      const name = (msg.name ?? "Jugador").slice(0, 18) || "Jugador";
      this.names.set(conn.id, name);
      const entry = this.roster.get(conn.id);
      if (entry) {
        entry.name = name;
      }
      this.broadcastLobby();
      return;
    }

    if (msg.t === "start") {
      if (conn.id !== this.hostId || this.playing) {
        return;
      }
      const ids = [...this.names.keys()];
      if (ids.length < 2) {
        send(conn, { t: "error", message: "Hace falta al menos 2 jugadores." });
        return;
      }
      this.beginChampionship(ids);
      return;
    }

    if (msg.t === "input") {
      this.emit({ t: "input", from: conn.id, input: msg.input }, conn.id);
      return;
    }

    if (msg.t === "snapshot") {
      this.emit({ t: "snapshot", snap: msg.snap }, conn.id);
      return;
    }

    if (msg.t === "roundEnd") {
      this.onRoundEnd(conn, msg.report);
      return;
    }

    if (msg.t === "ready") {
      this.onReady(conn, Boolean(msg.ready));
      return;
    }

    if (msg.t === "vote") {
      this.onVote(conn, msg.choice === "menu" ? "menu" : "replay");
    }
  }

  onClose(conn: Connection): void {
    this.names.delete(conn.id);
    const entry = this.roster.get(conn.id);
    if (entry) {
      entry.connected = false;
    }
    this.ready.delete(conn.id);
    this.votes.delete(conn.id);

    if (conn.id === this.hostId) {
      if (this.playing) {
        this.hostId = null;
        this.emit({ t: "closed", reason: "El anfitrión se fue." });
        for (const other of this.getConnections()) {
          other.close();
        }
      }
      this.resetRoom();
      return;
    }

    if (!this.playing) {
      this.broadcastLobby();
      return;
    }

    this.afterDisconnect();
  }

  onRoundEnd(conn: Connection, raw: RoundReport): void {
    if (conn.id !== this.hostId || this.champPhase !== "playing" || this.locked) {
      return;
    }
    const allowed = new Set(this.roster.keys());
    const report = sanitizeReport(raw, allowed);
    this.lastRound = applyRoundScores(this.totals, report);
    this.outcome = report.outcome;
    this.ready.clear();
    this.votes.clear();
    this.locked = false;
    if (this.roundNumber >= TOTAL_ROUNDS || this.activeIds().length < 2) {
      this.champPhase = "championship_results";
    } else {
      this.champPhase = "round_results";
    }
    this.broadcastChamp();
  }

  onReady(conn: Connection, ready: boolean): void {
    if (this.champPhase !== "round_results" || this.locked || !this.roster.get(conn.id)?.connected) {
      return;
    }
    this.ready.set(conn.id, ready);
    if (this.allReady()) {
      this.locked = true;
      this.broadcastChamp();
      this.beginNextRound();
      return;
    }
    this.broadcastChamp();
  }

  onVote(conn: Connection, choice: FinalChoice): void {
    if (this.champPhase !== "championship_results" || this.locked || !this.roster.get(conn.id)?.connected) {
      return;
    }
    this.votes.set(conn.id, choice);
    const decision = this.unanimousVote();
    if (!decision) {
      this.broadcastChamp();
      return;
    }
    this.locked = true;
    this.broadcastChamp();
    if (decision === "replay") {
      const ids = this.activeIds();
      if (ids.length >= 2) {
        this.beginChampionship(ids);
        return;
      }
      this.locked = false;
      this.broadcastChamp();
      return;
    }
    this.hostId = null;
    this.emit({ t: "closed", reason: "menu" });
    for (const other of this.getConnections()) {
      other.close();
    }
    this.resetRoom();
  }

  afterDisconnect(): void {
    const active = this.activeIds();
    if (this.champPhase === "round_results") {
      if (active.length < 2) {
        this.champPhase = "championship_results";
        this.ready.clear();
        this.votes.clear();
        this.locked = false;
        this.broadcastChamp();
        return;
      }
      if (this.allReady()) {
        this.locked = true;
        this.broadcastChamp();
        this.beginNextRound();
        return;
      }
      this.broadcastChamp();
      return;
    }
    if (this.champPhase === "championship_results") {
      const decision = this.unanimousVote();
      if (decision === "replay" && active.length >= 2) {
        this.locked = true;
        this.broadcastChamp();
        this.beginChampionship(active);
        return;
      }
      if (decision === "menu" || active.length === 0) {
        this.locked = true;
        this.broadcastChamp();
        this.emit({ t: "closed", reason: "menu" });
        for (const other of this.getConnections()) {
          other.close();
        }
        this.resetRoom();
        return;
      }
      this.broadcastChamp();
    }
  }

  beginChampionship(ids: string[]): void {
    if (ids.length < 2) {
      return;
    }
    this.playing = true;
    this.roundNumber = 1;
    this.totals.clear();
    this.lastRound.clear();
    this.ready.clear();
    this.votes.clear();
    this.outcome = null;
    this.locked = false;
    this.roster.clear();
    for (const id of ids) {
      this.roster.set(id, { name: this.names.get(id) ?? "Jugador", connected: true });
      this.totals.set(id, 0);
    }
    this.emitStart(ids);
  }

  beginNextRound(): void {
    const ids = this.activeIds();
    if (ids.length < 2 || this.roundNumber >= TOTAL_ROUNDS) {
      this.champPhase = "championship_results";
      this.locked = false;
      this.broadcastChamp();
      return;
    }
    this.roundNumber += 1;
    this.ready.clear();
    this.votes.clear();
    this.outcome = null;
    this.locked = false;
    this.lastRound.clear();
    this.emitStart(ids);
  }

  emitStart(ids: string[]): void {
    const shuffled = [...ids];
    shuffle(shuffled);
    this.champPhase = "playing";
    this.emit({
      t: "start",
      hunterId: shuffled[0],
      hiderIds: shuffled.slice(1),
      seed: Date.now(),
      roundNumber: this.roundNumber,
      totalRounds: TOTAL_ROUNDS,
    });
    this.broadcastChamp();
  }

  allReady(): boolean {
    const active = this.activeIds();
    return active.length > 0 && active.every((id) => this.ready.get(id) === true);
  }

  unanimousVote(): FinalChoice | null {
    const active = this.activeIds();
    if (active.length === 0) {
      return null;
    }
    const first = this.votes.get(active[0]);
    if (!first) {
      return null;
    }
    return active.every((id) => this.votes.get(id) === first) ? first : null;
  }

  activeIds(): string[] {
    const live = new Set<string>();
    for (const conn of this.getConnections()) {
      live.add(conn.id);
    }
    const ids: string[] = [];
    for (const [id, entry] of this.roster) {
      if (entry.connected && live.has(id)) {
        ids.push(id);
      }
    }
    return ids;
  }

  championshipView(): ChampionshipView {
    const active = new Set(this.activeIds());
    const rowsSource = [...this.roster.entries()].map(([id, entry]) => {
      const last = this.lastRound.get(id);
      return {
        id,
        name: entry.name,
        role: last?.role ?? "—",
        roundPoints: last?.roundPoints ?? 0,
        totalPoints: this.totals.get(id) ?? 0,
        connected: active.has(id),
        ready: this.ready.get(id) === true,
        vote: this.votes.get(id) ?? null,
      };
    });
    const ranks = rankByTotal(rowsSource);
    const winners = this.champPhase === "championship_results" ? new Set(winnerIds(rowsSource)) : new Set<string>();
    const rows = rowsSource
      .map((row) => ({
        ...row,
        rank: ranks.get(row.id) ?? rowsSource.length,
        winner: winners.has(row.id),
      }))
      .sort((a, b) => a.rank - b.rank || b.totalPoints - a.totalPoints || a.name.localeCompare(b.name));
    let voteReplay = 0;
    let voteMenu = 0;
    for (const id of active) {
      const vote = this.votes.get(id);
      if (vote === "replay") {
        voteReplay += 1;
      } else if (vote === "menu") {
        voteMenu += 1;
      }
    }
    const readyNeed = active.size;
    const readyCount = [...active].filter((id) => this.ready.get(id) === true).length;
    return {
      phase: this.champPhase === "lobby" ? "playing" : this.champPhase,
      roundNumber: this.roundNumber,
      totalRounds: TOTAL_ROUNDS,
      outcome: this.outcome,
      rows,
      readyCount,
      readyNeed,
      voteReplay,
      voteMenu,
      locked: this.locked,
    };
  }

  broadcastChamp(): void {
    if (this.champPhase === "lobby") {
      return;
    }
    this.emit({ t: "championship", state: this.championshipView() });
  }

  members(): { id: string; name: string }[] {
    return [...this.names.entries()].map(([id, name]) => ({ id, name }));
  }

  broadcastLobby(): void {
    if (!this.hostId || this.playing || this.champPhase !== "lobby") {
      return;
    }
    this.emit({ t: "lobby", hostId: this.hostId, members: this.members() });
  }

  resetRoom(): void {
    this.hostId = null;
    this.playing = false;
    this.names.clear();
    this.champPhase = "lobby";
    this.roundNumber = 0;
    this.totals.clear();
    this.roster.clear();
    this.lastRound.clear();
    this.ready.clear();
    this.votes.clear();
    this.outcome = null;
    this.locked = false;
  }

  emit(msg: ServerMsg, except?: string): void {
    const raw = JSON.stringify(msg);
    for (const conn of this.getConnections()) {
      if (conn.id !== except) {
        conn.send(raw);
      }
    }
  }
}

function send(conn: Connection, msg: ServerMsg): void {
  conn.send(JSON.stringify(msg));
}

function shuffle(items: string[]): void {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = items[i];
    items[i] = items[j];
    items[j] = tmp;
  }
}

export default {
  async fetch(request: Request, env: Record<string, unknown>): Promise<Response> {
    return (
      (await routePartykitRequest(request, env)) ??
      new Response("boli rooms", { status: 200 })
    );
  },
};
