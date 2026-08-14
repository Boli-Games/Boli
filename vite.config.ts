import { execSync } from "node:child_process";
import { defineConfig } from "vite";

/** 10 commits → 1.0, 20 → 2.0, 29 → 2.9 */
function appVersionFromCommits(count: number): string {
  return `${Math.floor(count / 10)}.${count % 10}`;
}

function gitCommitCount(): number {
  try {
    const n = Number(execSync("git rev-list --count HEAD", { encoding: "utf8" }).trim());
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

export default defineConfig(() => {
  const appVersion = appVersionFromCommits(gitCommitCount());
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
