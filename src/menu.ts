export type LobbyMember = {
  id: string;
  name: string;
};

export function bindMenu(opts: {
  onSolo: () => void;
  onCreate: () => void;
  onJoin: (code: string) => void;
  onStart: () => void;
  onLeave: () => void;
}): {
  showHome: (error?: string) => void;
  showLobby: (info: { code: string; isHost: boolean; hostId: string; members: LobbyMember[]; you: string }) => void;
  hide: () => void;
} {
  const menu = must("#menu");
  const home = must("#home");
  const lobby = must("#lobby");
  const errorEl = must("#menuError");
  const lobbyError = must("#lobbyError");
  const codeShow = must("#codeShow");
  const memberList = must("#memberList");
  const joinInput = must("#joinCode") as HTMLInputElement;
  const startBtn = must("#btnStart") as HTMLButtonElement;

  must("#btnSolo").addEventListener("click", () => opts.onSolo());
  must("#btnCreate").addEventListener("click", () => opts.onCreate());
  must("#btnJoin").addEventListener("click", () => {
    const code = joinInput.value.trim().toUpperCase();
    if (code.length < 4) {
      errorEl.textContent = "Escribí el código de 4 letras.";
      return;
    }
    opts.onJoin(code);
  });
  joinInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      must("#btnJoin").click();
    }
  });
  must("#btnStart").addEventListener("click", () => opts.onStart());
  must("#btnLeave").addEventListener("click", () => opts.onLeave());
  must("#btnCopy").addEventListener("click", async () => {
    const code = codeShow.textContent?.trim() ?? "";
    const url = `${window.location.origin}${window.location.pathname}?room=${code}`;
    try {
      await navigator.clipboard.writeText(url);
      lobbyError.textContent = "Enlace copiado.";
    } catch {
      lobbyError.textContent = url;
    }
  });

  return {
    showHome(error = "") {
      menu.classList.remove("hidden");
      home.classList.remove("hidden");
      lobby.classList.add("hidden");
      errorEl.textContent = error;
      lobbyError.textContent = "";
    },
    showLobby(info: { code: string; isHost: boolean; hostId: string; members: LobbyMember[]; you: string }) {
      menu.classList.remove("hidden");
      home.classList.add("hidden");
      lobby.classList.remove("hidden");
      codeShow.textContent = info.code;
      memberList.innerHTML = "";
      for (const member of info.members) {
        const li = document.createElement("li");
        const you = member.id === info.you ? " (vos)" : "";
        const host = member.id === info.hostId ? " · anfitrión" : "";
        li.textContent = `${member.name}${you}${host}`;
        memberList.append(li);
      }
      startBtn.disabled = !info.isHost || info.members.length < 2;
      startBtn.textContent = info.isHost
        ? info.members.length < 2
          ? "Esperá a un amigo"
          : "Empezar"
        : "Esperando al anfitrión";
      lobbyError.textContent = "";
    },
    hide() {
      menu.classList.add("hidden");
    },
  };
}

function must(selector: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(selector);
  if (!el) {
    throw new Error(`No se encontró ${selector}`);
  }
  return el;
}

export function roomCodeFromUrl(): string | null {
  const code = new URLSearchParams(window.location.search).get("room");
  if (!code) {
    return null;
  }
  const clean = code.trim().toUpperCase();
  return clean.length === 4 ? clean : null;
}
