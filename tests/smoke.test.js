"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { boot, agentFor } = require("./harness");

test("uygulama ayağa kalkıyor ve sağlık ucu yanıt veriyor", async () => {
  const { app } = await boot();
  const a = agentFor(app);
  const res = await a.get("/healthz");
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
});
