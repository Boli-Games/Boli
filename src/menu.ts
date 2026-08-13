import {
  authAvailable,
  getProfile,
  isSignedIn,
  openSignIn,
  patchProfile,
  signOut,
} from "./auth";
import { HUNTER_SKINS, skinById, type ProfileData } from "./profile";

export type LobbyMember = {
  id: string;
  name: string;
};

export function bindMenu(opts: {
  onCreate: () => void;
  onJoin: (code: string) => void;
  onStart: () => void;
  onLeave: () => void;
}): {
  showHome: (error?: string) => void;
  showLobby: (info: { code: string; isHost: boolean; hostId: string; members: LobbyMember[]; you: string }) => void;
  hide: () => void;
  refreshProfile: () => void;
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
  const nameInput = must("#displayName") as HTMLInputElement;
  const skinGrid = must("#skinGrid");
  const authStatus = must("#authStatus");
  const unlockNote = must("#unlockNote");
  const btnSignIn = must("#btnSignIn");
  const btnSignOut = must("#btnSignOut");

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
  nameInput.addEventListener("change", () => {
    patchProfile({ displayName: nameInput.value });
    paintProfile();
  });
  nameInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      nameInput.blur();
    }
  });
  btnSignIn.addEventListener("click", () => openSignIn());
  btnSignOut.addEventListener("click", () => {
    void signOut();
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

  function paintProfile(): void {
    const profile = getProfile();
    if (document.activeElement !== nameInput) {
      nameInput.value = profile.displayName;
    }
    const signed = isSignedIn();
    btnSignIn.classList.toggle("hidden", !authAvailable() || signed);
    btnSignOut.classList.toggle("hidden", !signed);
    btnSignIn.textContent = signed ? "Entrar" : authAvailable() ? "Entrar" : "Invitado";
    if (!authAvailable()) {
      authStatus.textContent = "Invitado (este navegador).";
      btnSignIn.classList.add("hidden");
    } else if (signed) {
      authStatus.textContent = "Sesión activa. El perfil viaja con tu cuenta.";
    } else {
      authStatus.textContent = "Entrá para llevar el perfil a otra PC.";
    }
    paintSkins(profile);
  }

  function paintSkins(profile: ProfileData): void {
    skinGrid.innerHTML = "";
    for (const skin of HUNTER_SKINS) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "skin";
      btn.title = `${skin.name} — ${skin.hint}`;
      btn.style.background = `#${skin.color.toString(16).padStart(6, "0")}`;
      const unlocked = profile.unlocked.includes(skin.id);
      btn.classList.toggle("locked", !unlocked);
      btn.classList.toggle("on", profile.equippedSkin === skin.id);
      btn.addEventListener("click", () => {
        if (!unlocked) {
          unlockNote.textContent = skin.hint;
          return;
        }
        patchProfile({ equippedSkin: skin.id });
        unlockNote.textContent = skin.name;
        paintProfile();
      });
      skinGrid.append(btn);
    }
    unlockNote.textContent = skinById(profile.equippedSkin).name;
  }

  paintProfile();

  return {
    showHome(error = "") {
      menu.classList.remove("hidden");
      home.classList.remove("hidden");
      lobby.classList.add("hidden");
      errorEl.textContent = error;
      lobbyError.textContent = "";
      paintProfile();
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
    refreshProfile() {
      paintProfile();
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
