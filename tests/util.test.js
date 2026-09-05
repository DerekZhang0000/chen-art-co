const { test } = require("node:test");
const assert = require("node:assert/strict");
const { safeParseJson } = require("../js/util.js");

test("safeParseJson: parses valid JSON", () => {
  assert.deepEqual(safeParseJson('{"a":1}'), { a: 1 });
});

test("safeParseJson: empty string falls back to {}", () => {
  assert.deepEqual(safeParseJson(""), {});
});

test("safeParseJson: non-JSON text (e.g. an HTML 404 body) falls back to {} without throwing", () => {
  assert.deepEqual(safeParseJson("Not found"), {});
  assert.deepEqual(safeParseJson("<html>404</html>"), {});
});

test("safeParseJson: whitespace-only string falls back to {}", () => {
  assert.deepEqual(safeParseJson("   "), {});
});

test("safeParseJson: literal 'null' parses to null, not coerced to {}", () => {
  assert.equal(safeParseJson("null"), null);
});
