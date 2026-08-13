import { Server, type Connection, routePartykitRequest } from "partyserver";

const MAX_PLAYERS = 8;

type ClientMsg =
  | { t: "hello"; name: string }
  | { t: "start" }
  | { t: "input"; input: unknown }
  | { t: "snapshot"; snap: unknown };

type ServerMsg =
  | { t: "welcome"; you: string; hostId: string; members: { id: string; name: string }[] }
  | { t: "lobby"; hostId: string; members: { id: string; name: string }[] }
  | { t: "start"; hunterId: string; hiderIds: string[]; seed: number }
  | { t: "input"; from: string; input: unknown }
  | { t: "snapshot"; snap: unknown }
  | { t: "error"; message: string }
  | { t: "closed"; reason: string };

export class BoliRoom extends Server {
  hostId: string | null = null;
  playing = false;
  names = new Map<string, string>();

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
      this.names.set(conn.id, (msg.name ?? "Jugador").slice(0, 18) || "Jugador");
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
      shuffle(ids);
      this.playing = true;
      this.emit({ t: "start", hunterId: ids[0], hiderIds: ids.slice(1), seed: Date.now() });
      return;
    }

    if (msg.t === "input") {
      this.emit({ t: "input", from: conn.id, input: msg.input }, conn.id);
      return;
    }

    if (msg.t === "snapshot") {
      this.emit({ t: "snapshot", snap: msg.snap }, conn.id);
    }
  }

  onClose(conn: Connection): void {
    this.names.delete(conn.id);
    if (conn.id === this.hostId) {
      this.emit({ t: "closed", reason: "El anfitrión se fue." });
      for (const other of this.getConnections()) {
        other.close();
      }
      this.hostId = null;
      this.playing = false;
      this.names.clear();
      return;
    }
    if (!this.playing) {
      this.broadcastLobby();
    }
  }

  members(): { id: string; name: string }[] {
    return [...this.names.entries()].map(([id, name]) => ({ id, name }));
  }

  broadcastLobby(): void {
    if (!this.hostId) {
      return;
    }
    this.emit({ t: "lobby", hostId: this.hostId, members: this.members() });
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
