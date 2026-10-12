import { test, expect } from "vitest";
import { computeComponentGraph } from "@intentius/chant/components";
import { COMPONENTS_DIR, discoverTeardownOrder } from "./teardown-plan";

// loomster#44: the delete order must cover every discovered component and put
// each consumer before everything it depends on. Checked against the real
// graph, so a new component or a new dependsOn edge is covered without editing
// this test.
test("teardown order is a reverse topological order of every discovered component", async () => {
  const graph = await computeComponentGraph(COMPONENTS_DIR);
  expect(graph.success).toBe(true);

  const order = await discoverTeardownOrder();
  expect([...order].sort()).toEqual([...graph.order].sort());

  for (const { from: consumer, to: dependency } of graph.edges) {
    expect(order.indexOf(consumer), `${consumer} must be deleted before ${dependency}`).toBeLessThan(
      order.indexOf(dependency),
    );
  }
}, 60_000);
