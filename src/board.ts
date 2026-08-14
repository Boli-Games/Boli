import type { ChampionshipView, FinalChoice } from "./net/championship";
import { usesTouchInput } from "./platform";

export type BoardApi = {
  hide: () => void;
  showPending: (roundNumber: number, totalRounds: number, title: string) => void;
  render: (view: ChampionshipView, localId: string) => void;
  visible: () => boolean;
};

export function bindBoard(opts: {
  onReady: (ready: boolean) => void;
  onVote: (choice: FinalChoice) => void;
}): BoardApi {
  const root = must("#board");
  const kicker = must("#boardKicker");
  const title = must("#boardTitle");
  const winner = must("#boardWinner");
  const body = must("#boardBody");
  const status = must("#boardStatus");
  const readyWrap = must("#boardReady");
  const finalWrap = must("#boardFinal");
  const btnReady = must("#btnReady") as HTMLButtonElement;
  const btnReplay = must("#btnReplay") as HTMLButtonElement;
  const btnMenu = must("#btnMenu") as HTMLButtonElement;

  let localReady = false;
  let localVote: FinalChoice | null = null;
  let locked = false;

  btnReady.addEventListener("click", () => {
    if (locked || readyWrap.classList.contains("hidden")) {
      return;
    }
    opts.onReady(!localReady);
  });
  btnReplay.addEventListener("click", () => {
    if (locked || finalWrap.classList.contains("hidden")) {
      return;
    }
    opts.onVote("replay");
  });
  btnMenu.addEventListener("click", () => {
    if (locked || finalWrap.classList.contains("hidden")) {
      return;
    }
    opts.onVote("menu");
  });

  function hide(): void {
    root.classList.add("hidden");
    localReady = false;
    localVote = null;
    locked = false;
  }

  function showPending(roundNumber: number, totalRounds: number, heading: string): void {
    root.classList.remove("hidden");
    kicker.textContent = `RONDA ${roundNumber}/${totalRounds}`;
    title.textContent = heading;
    winner.classList.add("hidden");
    winner.textContent = "";
    body.innerHTML = `<p class="board-wait">Calculando puntos…</p>`;
    status.textContent = "";
    readyWrap.classList.add("hidden");
    finalWrap.classList.add("hidden");
    syncTouch();
  }

  function render(view: ChampionshipView, localId: string): void {
    if (view.phase === "playing") {
      hide();
      return;
    }
    root.classList.remove("hidden");
    locked = view.locked;
    const local = view.rows.find((row) => row.id === localId);
    localReady = Boolean(local?.ready);
    localVote = local?.vote ?? null;

    const last = view.phase === "championship_results";
    kicker.textContent = last ? "CAMPEONATO FINALIZADO" : `RONDA ${view.roundNumber}/${view.totalRounds}`;
    title.textContent = last ? "Clasificación final" : outcomeTitle(view.outcome);
    if (last) {
      const names = view.rows.filter((row) => row.winner).map((row) => row.name);
      winner.classList.remove("hidden");
      winner.textContent =
        names.length === 0
          ? "GANADOR DEL CAMPEONATO"
          : names.length === 1
            ? `GANADOR DEL CAMPEONATO · ${names[0]}`
            : `EMPATE · ${names.join(" · ")}`;
    } else {
      winner.classList.add("hidden");
      winner.textContent = "";
    }

    body.innerHTML = renderTable(view, localId);

    readyWrap.classList.toggle("hidden", last);
    finalWrap.classList.toggle("hidden", !last);

    btnReady.classList.toggle("is-on", localReady);
    btnReady.textContent = localReady ? "NO LISTO" : "LISTO";
    btnReady.disabled = locked;
    btnReplay.classList.toggle("is-on", localVote === "replay");
    btnMenu.classList.toggle("is-on", localVote === "menu");
    btnReplay.disabled = locked;
    btnMenu.disabled = locked;

    if (locked) {
      status.textContent = last ? "Decisión unánime. Cerrando…" : "¡Todos listos! Siguiente ronda…";
    } else if (last) {
      if (view.voteReplay + view.voteMenu === 0) {
        status.textContent = "Todos deben coincidir. Podés cambiar de opinión.";
      } else if (view.voteReplay > 0 && view.voteMenu > 0) {
        status.textContent = `Esperando unanimidad… Jugar ${view.voteReplay} · Menú ${view.voteMenu}`;
      } else {
        const picked = view.voteReplay > 0 ? "volver a jugar" : "volver al menú";
        status.textContent = `Esperando a los demás para ${picked}… ${Math.max(view.voteReplay, view.voteMenu)} / ${view.readyNeed}`;
      }
    } else if (localReady) {
      status.textContent = `Esperando a los demás jugadores… ${view.readyCount} / ${view.readyNeed} listos`;
    } else {
      status.textContent = `${view.readyCount} / ${view.readyNeed} listos`;
    }
    syncTouch();
  }

  function syncTouch(): void {
    root.classList.toggle("is-touch", usesTouchInput());
  }

  return {
    hide,
    showPending,
    render,
    visible: () => !root.classList.contains("hidden"),
  };
}

function renderTable(view: ChampionshipView, localId: string): string {
  const rows = view.rows
    .map((row) => {
      const you = row.id === localId ? " is-you" : "";
      const win = row.winner ? " is-winner" : "";
      const gone = row.connected ? "" : " is-gone";
      const mark = view.phase === "round_results" ? (row.ready ? "Listo" : row.connected ? "—" : "Ausente") : row.connected ? "" : "Ausente";
      const round = row.roundPoints >= 0 ? `+${row.roundPoints}` : String(row.roundPoints);
      return `<tr class="${you}${win}${gone}">
        <td class="board-rank">${row.rank}</td>
        <td class="board-name">${escapeHtml(row.name)}${you ? ' <span class="board-you">vos</span>' : ""}</td>
        <td class="board-role">${escapeHtml(row.role)}</td>
        <td class="board-round">${round}</td>
        <td class="board-total">${row.totalPoints}</td>
        <td class="board-mark">${mark}</td>
      </tr>`;
    })
    .join("");
  return `<table class="board-table">
    <thead>
      <tr>
        <th>#</th>
        <th>Jugador</th>
        <th>Rol</th>
        <th>Ronda</th>
        <th>Total</th>
        <th></th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function outcomeTitle(outcome: ChampionshipView["outcome"]): string {
  if (outcome === "HUNTER_WIN") {
    return "El infiltrado cayó";
  }
  if (outcome === "INFILTRATOR_WIN") {
    return "Los bolis se llevaron la ronda";
  }
  return "Resultados de ronda";
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function must(selector: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(selector);
  if (!el) {
    throw new Error(`No se encontró ${selector}`);
  }
  return el;
}
