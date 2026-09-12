// Runs the Playwright real-browser test layer against a local
// `wrangler pages dev` process + local D1.
//
// Two modes, matching the two Playwright projects in playwright.config.js:
//   - default (`ci` project, tests/e2e/): no real Stripe/Resend secrets
//     needed - just local D1 (free, no cloud credentials). Safe to run on
//     every push/PR, and that's exactly what CI does.
//   - `--local` (`local` project, tests/e2e-local/): requires a real
//     STRIPE_SECRET_KEY from .dev.vars and creates a real Stripe test-mode
//     Checkout Session by actually clicking through Checkout in a browser.
//     Same "run deliberately, not in CI" philosophy as
//     scripts/run-integration-tests.js.
"use strict";

const { spawn } = require("node:child_process");
const { ROOT, NPX, loadDevVars, ensureLocalD1, startWrangler, killTree, waitForServer } = require("./lib/localServer.js");

const IS_LOCAL = process.argv.includes("--local");
const TOOL_NAME = IS_LOCAL ? "run-e2e-tests --local" : "run-e2e-tests";
const PROJECT = IS_LOCAL ? "local" : "ci";
// Distinct port from run-integration-tests.js's 8799 and a developer's own
// `npm run dev` on 8788, so none of these collide if run together.
const PORT = IS_LOCAL ? 8801 : 8800;
const BASE_URL = `http://127.0.0.1:${PORT}`;

function runPlaywright(env) {
  return new Promise((resolve) => {
    const child = spawn(NPX, ["playwright", "test", `--project=${PROJECT}`], {
      cwd: ROOT,
      stdio: "inherit",
      shell: true,
      env,
    });
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

async function main() {
  const devVars = IS_LOCAL ? loadDevVars(["STRIPE_SECRET_KEY"], { toolName: TOOL_NAME }) : {};
  ensureLocalD1({ toolName: TOOL_NAME });

  console.log(`${TOOL_NAME}: starting wrangler pages dev on port ${PORT}...`);
  const wrangler = startWrangler(PORT);

  let exitCode = 1;
  try {
    await waitForServer(`${BASE_URL}/`);
    console.log(`${TOOL_NAME}: server is up - running Playwright ("${PROJECT}" project)...\n`);
    exitCode = await runPlaywright({
      ...process.env,
      ...devVars,
      E2E_BASE_URL: BASE_URL,
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
