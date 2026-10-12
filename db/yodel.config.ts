import type { YodelConfig } from "@intentius/sql-yodeler";
import { deployment, historySchema } from "./deployment";

// What yodel needs per environment that chant.config.ts doesn't say: the
// history (and the advisory lock's key) live in schema `yodeler`, apart from
// Loom's `public`, so recording a migration never moves the plan digest and
// Loom's own create_all never sees it. Each key is a profile in
// chant.config.ts.
export default {
  environments: {
    [deployment]: { history: { database: historySchema } },
    scratch: { history: { database: historySchema } },
    replay: { history: { database: historySchema } },
  },
} satisfies YodelConfig;
