import { test } from "node:test";
import assert from "node:assert/strict";
import { runFinalSimulation } from "../scripts/final-simulation.mjs";
test("final official event: full HTTP simulation, accounting, restore, process restart and cleanup", async () => {
  const result = await runFinalSimulation();
  assert.equal(result.status, "PASS");
  assert.equal(result.cleanup, true);
});
