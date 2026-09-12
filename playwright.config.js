// Real-browser test layer, run via `npm run test:e2e` / `npm run
// test:e2e:local` (see scripts/run-e2e-tests.js) - covers what the jsdom
// unit suite structurally can't (real CSS/layout, real image loading,
// accessibility, visual regressions).
//
// Two projects so CI-safe and real-side-effect tests stay cleanly split:
//   - "ci": tests/e2e/ - no real Stripe/Resend calls, runs on every push/PR.
//   - "local": tests/e2e-local/ - real Stripe test-mode checkout, run
//     manually via `npm run test:e2e:local`, never in CI.
// scripts/run-e2e-tests.js sets E2E_BASE_URL before invoking whichever
// project it's running, so baseURL below always points at the right port.
const { defineConfig, devices } = require("@playwright/test");

module.exports = defineConfig({
  timeout: 30000,
  expect: {
    timeout: 10000,
  },
  use: {
    baseURL: process.env.E2E_BASE_URL || "http://127.0.0.1:8800",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "ci",
      testDir: "./tests/e2e",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "local",
      testDir: "./tests/e2e-local",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
