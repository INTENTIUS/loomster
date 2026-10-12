# For agents

- A change merges on CI: `just check` (typecheck, `chant lint`, unit tests). Run it before proposing a change. Claims are not part of making a change: write, run or rename none unless the person asks.
- Agents run nothing that deploys. The `floci` and `aws` claims (`just claims`, `just claims-affected`, `test/claims.sh`), `test/production-live-e2e.sh`, `test/production-floci-e2e.sh` and the `test/*-runtime-e2e.sh` scripts stop with exit 3 unless a person types `run` in their own terminal (`test/human-gate.sh`). Do not set `LOOM_HUMAN_RUN` or write the grant file; there is no other way in.
- Static claims need no gate: `bash test/claims.sh --only <static claim>` is fine to run.
- A person can grant runs instead with `just grant <claim>...` (an `<area>/<part>`, an area for all its parts, or `e2e/<name>`). An agent then runs exactly what was granted. Each name gets the runs granted, 2 by default: one run, and one more after a fix. When a run fails twice or its runs are spent, stop and report the failing step and log line. A granted run stops itself after 5 minutes with nothing written, or when the grant expires. `just grant --show` lists what is left.
- Claims, BREAK and the gate are described in `docs-site/src/content/docs/reference/claims.md`.
