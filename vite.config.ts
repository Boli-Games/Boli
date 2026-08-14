import { execSync } from "node:child_process";
import { defineConfig } from "vite";

/** 10 commits → 1.0, 20 → 2.0, 29 → 2.9 */
function appVersionFromCommits(count: number): string {
  return `${Math.floor(count / 10)}.${count % 10}`;
}

function tryGitCount(): number {
  try {
    const shallow = execSync("git rev-parse --is-shallow-repository", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (shallow === "true") {
      try {
        execSync("git fetch --unshallow --quiet", { stdio: "ignore" });
      } catch {
        try {
          execSync("git fetch --deepen=10000 --quiet", { stdio: "ignore" });
        } catch {
          /* keep whatever history the clone already has */
        }
      }
    }
    const n = Number(
      execSync("git rev-list --count HEAD", {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim(),
    );
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

/** Vercel often has no usable git history, so a shallow `rev-list` becomes 0 or 1. */
function tryGitHubCount(): number {
  const owner = process.env.VERCEL_GIT_REPO_OWNER || "Boli-Games";
  const repo = process.env.VERCEL_GIT_REPO_SLUG || "Boli";
  const ref = process.env.VERCEL_GIT_COMMIT_SHA || process.env.VERCEL_GIT_COMMIT_REF || "main";
  const url = `https://api.github.com/repos/${owner}/${repo}/commits?sha=${encodeURIComponent(ref)}&per_page=1`;
  try {
    const out = execSync(
      `curl -sI -H "User-Agent: boli-build" -H "Accept: application/vnd.github+json" ${JSON.stringify(url)}`,
      { encoding: "utf8", timeout: 8000, stdio: ["ignore", "pipe", "ignore"] },
    );
    const match = out.match(/[?&]page=(\d+)>;\s*rel="last"/i);
    const n = match ? Number(match[1]) : 0;
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

function gitCommitCount(): number {
  const fromGit = tryGitCount();
  if (fromGit > 1) {
    return fromGit;
  }
  const fromGitHub = tryGitHubCount();
  return fromGitHub > 0 ? fromGitHub : fromGit;
}

export default defineConfig(() => {
  const commitCount = gitCommitCount();
  const appVersion = appVersionFromCommits(commitCount);
  console.info(`[boli] menu version v${appVersion} (${commitCount} commits)`);
  return {
    server: {
      port: 5173,
    },
    define: {
      __APP_VERSION__: JSON.stringify(appVersion),
    },
    plugins: [
      {
        name: "menu-version",
        transformIndexHtml(html) {
          return html.replace(
            /<div class="menu-version">[\s\S]*?<\/div>/,
            `<div class="menu-version">— v${appVersion} —</div>`,
          );
        },
      },
    ],
  };
});
