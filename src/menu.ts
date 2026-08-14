import { isMenuMusicMuted, playMenuMusic, stopMenuMusic, toggleMenuMusicMuted } from "./audio";
import { getProfile, patchProfile } from "./auth";
import { HUNTER_SKINS, parseCameraMode, skinById, type CameraMode, type ProfileData } from "./profile";
import { usesTouchInput } from "./platform";

export type LobbyMember = {
  id: string;
  name: string;
};

type MenuScreen = "home" | "create" | "customize" | "settings";

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
  const screenCreate = must("#screenCreate");
  const screenCustomize = must("#screenCustomize");
  const screenSettings = must("#screenSettings");
  const homeChrome = must("#homeChrome");
  const createSetup = must("#createSetup");
  const lobby = must("#lobby");
  const errorEl = must("#menuError");
  const homeError = must("#homeError");
  const lobbyError = must("#lobbyError");
  const lobbyStatus = must("#lobbyStatus");
  const codeShow = must("#codeShow");
  const memberList = must("#memberList");
  const joinInput = must("#joinCode") as HTMLInputElement;
  const startBtn = must("#btnStart") as HTMLButtonElement;
  const nameInput = must("#displayName") as HTMLInputElement;
  const skinGrid = must("#skinGrid");
  const unlockNote = must("#unlockNote");
  const profilePopup = must("#profilePopup");
  const btnProfile = must("#btnProfile");
  const btnMute = must("#btnMute");

  const screens: Record<MenuScreen, HTMLElement> = {
    home,
    create: screenCreate,
    customize: screenCustomize,
    settings: screenSettings,
  };

  let screen: MenuScreen = "home";
  let inLobby = false;

  must("#btnNavCreate").addEventListener("click", () => {
    closeProfile();
    showScreen("create");
  });
  must("#btnNavCustomize").addEventListener("click", () => {
    closeProfile();
    showScreen("customize");
  });
  // AJUSTES: cámara en tercera / primera persona.
  must("#btnNavSettings").addEventListener("click", () => {
    closeProfile();
    showScreen("settings");
  });
  must("#btnBackSettings").addEventListener("click", () => showScreen("home"));
  must("#btnSetCamThird").addEventListener("click", () => setCameraMode("thirdPerson"));
  must("#btnSetCamFirst").addEventListener("click", () => setCameraMode("firstPerson"));

  must("#btnBackCreate").addEventListener("click", () => {
    if (inLobby) {
      opts.onLeave();
      return;
    }
    showScreen("home");
  });
  must("#btnBackCustomize").addEventListener("click", () => showScreen("home"));

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

  btnProfile.addEventListener("click", (event) => {
    event.stopPropagation();
    if (profilePopup.classList.contains("hidden")) {
      openProfile();
    } else {
      closeProfile();
    }
  });
  btnMute.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleMenuMusicMuted();
    syncMuteButton();
  });
  must("#btnProfileSave").addEventListener("click", () => saveProfileName());
  must("#btnProfileClose").addEventListener("click", () => closeProfile());
  profilePopup.addEventListener("click", (event) => event.stopPropagation());
  nameInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      saveProfileName();
    }
  });
  document.addEventListener("click", (event) => {
    if (profilePopup.classList.contains("hidden")) {
      return;
    }
    const target = event.target as Node | null;
    if (target && (profilePopup.contains(target) || btnProfile.contains(target))) {
      return;
    }
    closeProfile();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !profilePopup.classList.contains("hidden")) {
      closeProfile();
    }
  });

  must("#btnStart").addEventListener("click", () => opts.onStart());
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

  function showScreen(next: MenuScreen): void {
    screen = next;
    for (const [name, el] of Object.entries(screens) as [MenuScreen, HTMLElement][]) {
      const active = name === next;
      el.classList.toggle("hidden", !active);
      el.setAttribute("aria-hidden", active ? "false" : "true");
    }
    homeChrome.classList.toggle("hidden", next !== "home");
    menu.dataset.screen = next;
    if (next !== "home") {
      closeProfile();
    }
    if (next === "customize") {
      paintSkins(getProfile());
    }
    if (next === "settings") {
      syncCameraButtons();
    }
    if (next === "create" && !inLobby) {
      errorEl.textContent = "";
    }
  }

  function setCameraMode(mode: CameraMode): void {
    patchProfile({ cameraMode: parseCameraMode(mode) });
    syncCameraButtons();
  }

  function syncCameraButtons(): void {
    const mode = getProfile().cameraMode;
    must("#btnSetCamThird").classList.toggle("on", mode === "thirdPerson");
    must("#btnSetCamFirst").classList.toggle("on", mode === "firstPerson");
  }

  function openProfile(): void {
    if (screen !== "home") {
      return;
    }
    nameInput.value = getProfile().displayName;
    profilePopup.classList.remove("hidden");
    btnProfile.setAttribute("aria-expanded", "true");
    if (!usesTouchInput()) {
      nameInput.focus();
      nameInput.select();
    }
  }

  function closeProfile(): void {
    if (!profilePopup.classList.contains("hidden")) {
      nameInput.value = getProfile().displayName;
    }
    profilePopup.classList.add("hidden");
    btnProfile.setAttribute("aria-expanded", "false");
  }

  function syncMuteButton(): void {
    const silenced = isMenuMusicMuted();
    btnMute.classList.toggle("is-muted", silenced);
    btnMute.setAttribute("aria-pressed", silenced ? "true" : "false");
    btnMute.setAttribute("aria-label", silenced ? "Activar música" : "Silenciar música");
  }

  function saveProfileName(): void {
    patchProfile({ displayName: nameInput.value });
    nameInput.value = getProfile().displayName;
    closeProfile();
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
        paintSkins(getProfile());
      });
      skinGrid.append(btn);
    }
    unlockNote.textContent = skinById(profile.equippedSkin).name;
  }

  function resetCreate(): void {
    inLobby = false;
    createSetup.classList.remove("hidden");
    lobby.classList.add("hidden");
    lobbyError.textContent = "";
    errorEl.textContent = "";
    codeShow.textContent = "----";
    memberList.innerHTML = "";
    startBtn.disabled = true;
    startBtn.textContent = "Empezar";
    lobbyStatus.textContent = "Esperando jugadores";
  }

  const versionEl = document.querySelector(".menu-version");
  if (versionEl) {
    versionEl.textContent = `— v${__APP_VERSION__} —`;
  }

  paintSkins(getProfile());
  syncCameraButtons();
  showScreen("home");
  syncMuteButton();
  playMenuMusic();

  return {
    showHome(error = "") {
      menu.classList.remove("hidden");
      resetCreate();
      showScreen("home");
      homeError.textContent = error;
      closeProfile();
      playMenuMusic();
    },
    showLobby(info: { code: string; isHost: boolean; hostId: string; members: LobbyMember[]; you: string }) {
      menu.classList.remove("hidden");
      inLobby = true;
      showScreen("create");
      createSetup.classList.add("hidden");
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
      const ready = info.isHost && info.members.length >= 2;
      startBtn.disabled = !ready;
      startBtn.textContent = info.isHost
        ? info.members.length < 2
          ? "Esperá a un amigo"
          : "Empezar"
        : "Esperando al anfitrión";
      if (!info.isHost) {
        lobbyStatus.textContent = `${info.members.length} jugador${info.members.length === 1 ? "" : "es"} · esperando al anfitrión`;
      } else if (info.members.length < 2) {
        lobbyStatus.textContent = `${info.members.length} jugador${info.members.length === 1 ? "" : "es"} · esperando jugadores`;
      } else {
        lobbyStatus.textContent = `${info.members.length} jugadores · listo para empezar`;
      }
      lobbyError.textContent = "";
    },
    hide() {
      stopMenuMusic();
      menu.classList.add("hidden");
      closeProfile();
    },
    refreshProfile() {
      if (screen === "customize") {
        paintSkins(getProfile());
      }
      if (screen === "settings") {
        syncCameraButtons();
      }
      if (document.activeElement !== nameInput) {
        nameInput.value = getProfile().displayName;
      }
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
