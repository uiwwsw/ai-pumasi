import test from "node:test";
import assert from "node:assert/strict";
import catalog from "../src/catalog.json" with { type: "json" };
import table from "../src/model-levels.json" with { type: "json" };

test("every model in the catalog has a row in the level table, and no row is left over", () => {
  const ids = (catalog as { id: string }[]).map((m) => m.id).sort();
  // Adding a model to the catalog fails here until its level is looked up and written down.
  assert.deepEqual(Object.keys(table.levels).sort(), ids);
  for (const [id, level] of Object.entries(table.levels))
    assert.ok(level === null || (Number.isInteger(level) && level >= 0 && level <= 100), id);
  assert.match(table.source, /artificialanalysis\.ai/);
});
