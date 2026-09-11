// Local integration test - makes a real LaunchDarkly flag-eval call (via
// the real LD_CLIENT_SIDE_ID in .dev.vars, if set) as part of loading the
// homepage. Tolerant of either outcome, since the live flag's current
// value is controlled from the LaunchDarkly dashboard, not by this test.
const { test } = require("node:test");
const assert = require("node:assert/strict");

const BASE_URL = process.env.INTEGRATION_BASE_URL || "http://127.0.0.1:8799";

test("GET / resolves the live maintenance-mode flag without crashing", async () => {
  const res = await fetch(`${BASE_URL}/`);
  assert.ok([200, 503].includes(res.status), `expected 200 (normal) or 503 (maintenance), got ${res.status}`);

  const body = await res.text();
  if (res.status === 503) {
    assert.match(body, /maintenance/i);
  } else {
    assert.match(body, /<!doctype html>/i);
  }
});
