// Shared helper for spinning up a local `wrangler pages dev` + local D1
// instance, used by both scripts/run-integration-tests.js and
// scripts/run-e2e-tests.js. Not a test file itself - just the
// start/wait/stop plumbing both of those scripts need identically.
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawn, execFileSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..", "..");
const DEV_VARS_PATH = path.join(ROOT, ".dev.vars");
const IS_WIN = process.platform === "win32";
const NPX = IS_WIN ? "npx.cmd" : "npx";

function parseDevVars(contents) {
  const vars = {};
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    vars[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return vars;
}

// Reads and validates .dev.vars. Exits the process with a clear message if
// the file is missing or any of `requiredKeys` isn't set - callers that
// don't need any real secrets (e.g. the CI-safe Playwright project) simply
// don't call this at all.
function loadDevVars(requiredKeys, { toolName }) {
  if (!fs.existsSync(DEV_VARS_PATH)) {
    console.error(
      `${toolName}: no .dev.vars file found at the project root.\n` +
        `Create one with ${requiredKeys.join(", ")} - see README.md.`
    );
    process.exit(1);
  }
  const vars = parseDevVars(fs.readFileSync(DEV_VARS_PATH, "utf8"));
  const missing = requiredKeys.filter((key) => !vars[key]);
  if (missing.length) {
    console.error(`${toolName}: .dev.vars is missing required key(s): ${missing.join(", ")}`);
    process.exit(1);
  }
  return vars;
}

// Applies db/schema.sql (idempotent - CREATE TABLE IF NOT EXISTS) and seeds
// db/seed.sql only if product_stock is currently empty, so a developer's
// (or a previous run's) local stock is never silently reset.
function ensureLocalD1({ toolName }) {
  console.log(`${toolName}: ensuring local D1 schema exists...`);
  execFileSync(NPX, ["wrangler", "d1", "execute", "chen-art-co-inventory", "--local", "--file=./db/schema.sql"], {
    cwd: ROOT,
    stdio: "inherit",
    shell: true,
  });

  let alreadySeeded = false;
  try {
    const output = execFileSync(
      NPX,
      ["wrangler", "d1", "execute", "chen-art-co-inventory", "--local", "--json", '--command="SELECT COUNT(*) as cnt FROM product_stock;"'],
      { cwd: ROOT, encoding: "utf8", shell: true }
    );
    const parsed = JSON.parse(output);
    const cnt = parsed?.[0]?.results?.[0]?.cnt;
    alreadySeeded = typeof cnt === "number" && cnt > 0;
  } catch (err) {
    console.warn(`${toolName}: couldn't check existing D1 stock (${err.message}) - skipping seed to avoid a duplicate-key error.`);
    alreadySeeded = true;
  }

  if (alreadySeeded) {
    console.log(`${toolName}: local D1 already has stock rows - skipping seed.sql.`);
  } else {
    console.log(`${toolName}: seeding local D1 with starting stock...`);
    execFileSync(NPX, ["wrangler", "d1", "execute", "chen-art-co-inventory", "--local", "--file=./db/seed.sql"], {
      cwd: ROOT,
      stdio: "inherit",
      shell: true,
    });
  }
}

function startWrangler(port) {
  return spawn(NPX, ["wrangler", "pages", "dev", ".", "--port", String(port), "--ip", "127.0.0.1"], {
    cwd: ROOT,
    stdio: "inherit",
    shell: true,
    detached: !IS_WIN,
  });
}

function killTree(child) {
  if (!child || child.killed || child.exitCode !== null) return;
  if (IS_WIN) {
    try {
      execFileSync("taskkill", ["/pid", String(child.pid), "/T", "/F"]);
    } catch (err) {
      // Process may have already exited between the check above and here.
    }
  } else {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch (err) {
      child.kill("SIGKILL");
    }
  }
}

async function waitForServer(url, timeoutMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await fetch(url);
      return;
    } catch (err) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error(`Timed out waiting for ${url} to respond`);
}

module.exports = { ROOT, NPX, loadDevVars, ensureLocalD1, startWrangler, killTree, waitForServer };
