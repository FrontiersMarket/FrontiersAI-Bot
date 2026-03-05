import { spinner, note } from "@clack/prompts";
import { checkCommand, bail } from "../lib/utils.mjs";
import { execFileAsync } from "../lib/utils.mjs";

export async function checkPrerequisites() {
  const s = spinner();
  s.start("Checking prerequisites…");

  const [nodeResult, pnpmResult, dockerResult] = await Promise.all([
    checkCommand("node", ["--version"], (v) => v.replace(/^v/, "")),
    checkCommand("pnpm", ["--version"], (v) => v),
    checkCommand("docker", ["--version"], (v) => {
      const m = v.match(/Docker version ([^\s,]+)/i);
      return m ? m[1] : v;
    }),
  ]);

  let dockerRunning = false;
  if (dockerResult.ok) {
    try {
      await execFileAsync("docker", ["info"], { timeout: 8000 });
      dockerRunning = true;
    } catch {}
  }

  s.stop("Prerequisites checked");

  const checks = [
    {
      label: "Node.js >= 22",
      ok: nodeResult.ok && parseInt(nodeResult.version?.split(".")[0] ?? "0", 10) >= 22,
      found: nodeResult.ok ? `v${nodeResult.version}` : null,
      fix: "Install Node.js 22+: https://nodejs.org  (or: nvm install 22)",
    },
    {
      label: "pnpm",
      ok: pnpmResult.ok,
      found: pnpmResult.ok ? `v${pnpmResult.version}` : null,
      fix: "Install pnpm: npm install -g pnpm",
    },
    {
      label: "Docker CLI",
      ok: dockerResult.ok,
      found: dockerResult.ok ? `v${dockerResult.version}` : null,
      fix: "Install Docker Desktop: https://www.docker.com/products/docker-desktop",
    },
    {
      label: "Docker daemon",
      ok: dockerRunning,
      found: dockerRunning ? "running" : null,
      fix: "Start Docker Desktop (or: sudo systemctl start docker)",
    },
  ];

  const failing = checks.filter((c) => !c.ok);

  note(
    checks
      .map((c) =>
        c.ok
          ? `  ✓  ${c.label}${c.found ? `  (${c.found})` : ""}`
          : `  ✗  ${c.label}  ← MISSING`
      )
      .join("\n"),
    "System checks"
  );

  if (failing.length > 0) {
    note(
      failing.map((c) => `  • ${c.label}\n    ${c.fix}`).join("\n\n"),
      "Fix these before continuing"
    );
    bail(`${failing.length} prerequisite(s) not met. Resolve them and re-run.`);
  }
}
