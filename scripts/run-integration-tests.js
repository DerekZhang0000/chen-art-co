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
"use strict";

const { spawn } = require("node:child_process");
const { ROOT, loadDevVars, ensureLocalD1, startWrangler, killTree, waitForServer } = require("./lib/localServer.js");

const TOOL_NAME = "run-integration-tests";
const PORT = 8799;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const REQUIRED_VARS = ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "RESEND_API_KEY", "SELLER_EMAIL"];

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
  const devVars = loadDevVars(REQUIRED_VARS, { toolName: TOOL_NAME });
  ensureLocalD1({ toolName: TOOL_NAME });

  console.log(`${TOOL_NAME}: starting wrangler pages dev on port ${PORT}...`);
  const wrangler = startWrangler(PORT);

  let exitCode = 1;
  try {
    await waitForServer(`${BASE_URL}/`);
    console.log(`${TOOL_NAME}: server is up - running integration tests...\n`);
    exitCode = await runIntegrationTests({
      ...process.env,
      ...devVars,
      INTEGRATION_BASE_URL: BASE_URL,
    });
  } catch (err) {
    console.error(`${TOOL_NAME}: ${err.message}`);
  } finally {
    console.log(`${TOOL_NAME}: shutting down wrangler...`);
    killTree(wrangler);
  }

  process.exit(exitCode);
}

main();
