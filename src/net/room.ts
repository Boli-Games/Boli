import PartySocket from "partysocket";
import type { ClientMsg, LobbyMember, ServerMsg } from "./protocol";

export type RoomClient = {
  id: string;
  send: (msg: ClientMsg) => void;
  close: () => void;
};

export function connectRoom(opts: {
  code: string;
  name: string;
  onMessage: (msg: ServerMsg) => void;
  onClose: () => void;
}): RoomClient {
  const host = import.meta.env.VITE_PARTYKIT_HOST ?? (import.meta.env.DEV ? "127.0.0.1:8787" : "");
  if (!host) {
    queueMicrotask(() => opts.onClose());
    return {
      id: "",
      send() {},
      close() {},
    };
  }
  const socket = new PartySocket({
    host,
    party: "boli-room",
    room: opts.code,
  });

  socket.addEventListener("open", () => {
    const hello: ClientMsg = { t: "hello", name: opts.name };
    socket.send(JSON.stringify(hello));
  });
  socket.addEventListener("message", (event) => {
    if (typeof event.data !== "string") {
      return;
    }
    try {
      opts.onMessage(JSON.parse(event.data) as ServerMsg);
    } catch {
      /* ignore */
    }
  });
  socket.addEventListener("close", () => opts.onClose());

  return {
    get id() {
      return socket.id;
    },
    send(msg: ClientMsg) {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(msg));
      }
    },
    close() {
      socket.close();
    },
  };
}

export type { LobbyMember };
