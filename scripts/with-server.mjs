#!/usr/bin/env node
// Runs a command against a Klik Go server. Reuses one that already answers at BASE_URL,
// otherwise starts the production build (`next start`) and stops it afterwards.
// Usage: node scripts/with-server.mjs -- <command> [args...]
import { spawn } from "node:child_process";

const separator = process.argv.indexOf("--");
const [command, ...args] = separator === -1 ? [] : process.argv.slice(separator + 1);
if (!command) {
  console.error("Usage: node scripts/with-server.mjs -- <command> [args...]");
  process.exit(2);
}

const baseUrl = process.env.BASE_URL ?? "http://localhost:3000";
const healthUrl = new URL("/api/health", baseUrl).toString();
const port = new URL(baseUrl).port || "3000";

async function isUp() {
  try {
    const response = await fetch(healthUrl);
    return response.ok;
  } catch {
    return false;
  }
}

async function waitUntilUp(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isUp()) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

let server;
if (!(await isUp())) {
  console.log(
    `No server at ${baseUrl}; starting \`next start\` on port ${port} (run \`pnpm build\` first).`,
  );
  server = spawn("node_modules/.bin/next", ["start", "--port", port], {
    cwd: new URL("../apps/web/", import.meta.url),
    stdio: "inherit",
    env: process.env,
    detached: true,
  });
  if (!(await waitUntilUp(60_000))) {
    console.error(`Server did not become healthy at ${healthUrl} within 60s.`);
    process.kill(-server.pid, "SIGTERM");
    process.exit(1);
  }
}

const child = spawn(command, args, {
  stdio: "inherit",
  env: { ...process.env, BASE_URL: baseUrl },
});
child.on("exit", (code) => {
  if (server) process.kill(-server.pid, "SIGTERM");
  process.exit(code ?? 1);
});
