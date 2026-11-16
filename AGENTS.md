# For agents

Working in the INTENTIUS workspace, `../agents/shared.md` applies too. This file adds what is particular to loomster.

- Local gate: `just check` (typecheck, `chant lint`, unit tests).
- Person-started (exit 3 without a person typing `run`, via `test/human-gate.sh`): the `floci` and `aws` claims (`just claims`, `just claims-affected`, `test/claims.sh`), `test/production-live-e2e.sh`, `test/production-floci-e2e.sh` and `test/*-runtime-e2e.sh`. The override variable is `LOOM_HUMAN_RUN`; never set it. Static claims need no gate: `bash test/claims.sh --only <static claim>`.
- Claims, BREAK and the gate are described in `docs-site/src/content/docs/reference/claims.md`.
