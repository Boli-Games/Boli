import type * as Party from "partykit/server";

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

export default class BoliRoom implements Party.Server {
  hostId: string | null = null;
  playing = false;
  names = new Map<string, string>();

  constructor(readonly room: Party.Room) {}

  onConnect(conn: Party.Connection): void {
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

  onMessage(raw: string | ArrayBuffer, sender: Party.Connection): void {
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
      this.names.set(sender.id, (msg.name ?? "Jugador").slice(0, 18) || "Jugador");
      this.broadcastLobby();
      return;
    }

    if (msg.t === "start") {
      if (sender.id !== this.hostId || this.playing) {
        return;
      }
      const ids = [...this.names.keys()];
      if (ids.length < 2) {
        send(sender, { t: "error", message: "Hace falta al menos 2 jugadores." });
        return;
      }
      shuffle(ids);
      this.playing = true;
      this.broadcast({ t: "start", hunterId: ids[0], hiderIds: ids.slice(1), seed: Date.now() });
      return;
    }

    if (msg.t === "input") {
      this.broadcast({ t: "input", from: sender.id, input: msg.input }, sender.id);
      return;
    }

    if (msg.t === "snapshot") {
      this.broadcast({ t: "snapshot", snap: msg.snap }, sender.id);
    }
  }

  onClose(conn: Party.Connection): void {
    this.names.delete(conn.id);
    if (conn.id === this.hostId) {
      this.broadcast({ t: "closed", reason: "El anfitrión se fue." });
      for (const other of this.room.getConnections()) {
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
    this.broadcast({ t: "lobby", hostId: this.hostId, members: this.members() });
  }

  broadcast(msg: ServerMsg, except?: string): void {
    const raw = JSON.stringify(msg);
    for (const conn of this.room.getConnections()) {
      if (conn.id !== except) {
        conn.send(raw);
      }
    }
  }
}

function send(conn: Party.Connection, msg: ServerMsg): void {
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
