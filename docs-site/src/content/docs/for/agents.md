---
title: With a coding agent
description: "For a person who works through a coding agent, and for the agent: the skill file, the page prompts, llms.txt, and the limits the repository enforces."
---

## Works

- `skills/loomster/SKILL.md` gives an agent every verb, the order to try them
  in, and the rules.
- Each tutorial, guide and getting-started page has a prompt to hand over, and
  [llms.txt](/loomster/llms.txt) lists every page.
- [chant](/loomster/concepts/glossary/#chant)'s MCP server, `chant serve mcp`, exposes build, lint, list, describe,
  diff and the [Ops](/loomster/concepts/glossary/#op).
- An agent can bring Loom up locally, seed it and validate it with no account.

## Differs

- An agent can't approve a gate: gated Ops exit 3 until a person runs
  `chant approve` ([Gated Ops](/loomster/concepts/gated-ops/)).
- Claims and E2E scripts that hold real infrastructure need a person at a
  terminal, or a grant the person gives with `just grant`
  ([Claims](/loomster/reference/claims/#the-gate-and-grants)).
- Every page prompt tells the agent not to deploy to or delete from a real
  account unless you asked in that session.

## First step

[Drive loomster with an agent](/loomster/guides/drive-with-an-agent/).

## Proof

[Validation](/loomster/reference/validation/).

## Then read

Tasks:
[Run Loom locally](/loomster/getting-started/),
[Seed and validate a deploy](/loomster/guides/seed-and-validate/).

Explanation:
[Gated Ops](/loomster/concepts/gated-ops/),
[Architecture](/loomster/concepts/how-it-works/).

Reference:
[Ops](/loomster/reference/ops/),
[Build parameters](/loomster/reference/parameters/),
[Claims](/loomster/reference/claims/).
