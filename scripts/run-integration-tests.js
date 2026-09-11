// Runs the local integration suite (tests/integration/) against a REAL
// `wrangler pages dev` process using the REAL values in `.dev.vars`.
//
// Unlike `npm test`, this makes real network calls: it creates a real
// Stripe test-mode Checkout Session and sends real emails via Resend to
// whatever SELLER_EMAIL/buyer address the tests use. See README.md
// ("Local integration tests") before running this. Intended to be run
// manually/occasionally, never from CI.
//
// Steps: parse .dev.vars -> ensure local D1 schema/seed exist -> spawn
// `wrangler pages dev` on a dedicated port -> wait for it to respond ->
// run `node --test tests/integration/` against it -> tear everything down.

const fs = require("node:fs");
const path = require("node:path");
const { spawn, execFileSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const DEV_VARS_PATH = path.join(ROOT, ".dev.vars");
const PORT = 8799;
const BASE_URL = `http://127.0.0.1:${PORT}`;
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

function loadDevVars() {
  if (!fs.existsSync(DEV_VARS_PATH)) {
    console.error(
      "run-integration-tests: no .dev.vars file found at the project root.\n" +
        "Create one with STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, RESEND_API_KEY, and SELLER_EMAIL - see README.md."
    );
    process.exit(1);
  }
  const vars = parseDevVars(fs.readFileSync(DEV_VARS_PATH, "utf8"));
  const required = ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "RESEND_API_KEY", "SELLER_EMAIL"];
  const missing = required.filter((key) => !vars[key]);
  if (missing.length) {
    console.error(`run-integration-tests: .dev.vars is missing required key(s): ${missing.join(", ")}`);
    process.exit(1);
  }
  return vars;
}

function ensureLocalD1() {
  console.log("run-integration-tests: ensuring local D1 schema exists...");
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
    console.warn(`run-integration-tests: couldn't check existing D1 stock (${err.message}) - skipping seed to avoid a duplicate-key error.`);
    alreadySeeded = true;
  }

  if (alreadySeeded) {
    console.log("run-integration-tests: local D1 already has stock rows - skipping seed.sql.");
  } else {
    console.log("run-integration-tests: seeding local D1 with starting stock...");
    execFileSync(NPX, ["wrangler", "d1", "execute", "chen-art-co-inventory", "--local", "--file=./db/seed.sql"], {
      cwd: ROOT,
      stdio: "inherit",
      shell: true,
    });
  }
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

function runIntegrationTests(env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--test", "tests/integration/*.integration.test.js"], {
      cwd: ROOT,
      stdio: "inherit",
      env,
    });
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

async function main() {
  const devVars = loadDevVars();
  ensureLocalD1();

  console.log(`run-integration-tests: starting wrangler pages dev on port ${PORT}...`);
  const wrangler = spawn(NPX, ["wrangler", "pages", "dev", ".", "--port", String(PORT), "--ip", "127.0.0.1"], {
    cwd: ROOT,
    stdio: "inherit",
    shell: true,
    detached: !IS_WIN,
  });

  let exitCode = 1;
  try {
    await waitForServer(`${BASE_URL}/`);
    console.log("run-integration-tests: server is up - running integration tests...\n");
    exitCode = await runIntegrationTests({
      ...process.env,
      ...devVars,
      INTEGRATION_BASE_URL: BASE_URL,
    });
  } catch (err) {
    console.error(`run-integration-tests: ${err.message}`);
  } finally {
    console.log("run-integration-tests: shutting down wrangler...");
    killTree(wrangler);
  }

  process.exit(exitCode);
}

main();
