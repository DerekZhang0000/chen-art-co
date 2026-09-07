const { test } = require("node:test");
const assert = require("node:assert/strict");

const fnPromise = import("../functions/api/products.js");

const CATALOG = [
  { id: "a", name: "A", price: 1000, image: "images/a.jpg", description: "Desc A" },
  { id: "b", name: "B", price: 2500, image: "images/b.jpg", description: "Desc B" },
];

function fakeDb(stockById) {
  return {
    prepare(sql) {
      return {
        bind(...ids) {
          if (!/SELECT/i.test(sql)) throw new Error("unexpected DB call: " + sql);
          const results = ids.filter((id) => id in stockById).map((id) => ({ id, stock: stockById[id] }));
          return { all: async () => ({ results }) };
        },
      };
    },
  };
}

function fakeRequest() {
  return new Request("https://chenart.co/api/products");
}

test("onRequestGet: missing DB binding returns 500", async () => {
  const { onRequestGet } = await fnPromise;
  const res = await onRequestGet({ request: fakeRequest(), env: {} });
  assert.equal(res.status, 500);
});

test("onRequestGet: products.json fetch failing returns 500", async () => {
  const { onRequestGet } = await fnPromise;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("nope", { status: 500 });

  try {
    const res = await onRequestGet({ request: fakeRequest(), env: { DB: fakeDb({}) } });
    assert.equal(res.status, 500);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("onRequestGet: merges catalog metadata with live D1 stock", async () => {
  const { onRequestGet } = await fnPromise;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify(CATALOG), { status: 200 });

  try {
    const res = await onRequestGet({ request: fakeRequest(), env: { DB: fakeDb({ a: 5, b: 0 }) } });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.deepEqual(body, [
      { id: "a", name: "A", price: 1000, image: "images/a.jpg", description: "Desc A", stock: 5 },
      { id: "b", name: "B", price: 2500, image: "images/b.jpg", description: "Desc B", stock: 0 },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("onRequestGet: a product missing from D1 defaults to stock 0, not undefined", async () => {
  const { onRequestGet } = await fnPromise;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify(CATALOG), { status: 200 });

  try {
    const res = await onRequestGet({ request: fakeRequest(), env: { DB: fakeDb({ a: 5 }) } });
    const body = await res.json();
    const productB = body.find((p) => p.id === "b");
    assert.equal(productB.stock, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
