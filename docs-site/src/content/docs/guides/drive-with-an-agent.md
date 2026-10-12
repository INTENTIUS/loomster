---
title: Drive loomster with an agent
description: Hand loomster to a coding agent with the skill file, chant's MCP server, the page prompts and llms.txt, and what the agent can and can't do without a person.
prompt: setup
---

## Result

A coding agent in your checkout that knows loomster's verbs and its limits, and
brings Loom up locally on request.

## Prerequisites

A coding agent that reads files in your repository (Claude Code, Codex, Cursor or
another), and the repository cloned with `npm install` run.

## Steps

1. Point the agent at the skill. `skills/loomster/SKILL.md` lists every
   lifecycle verb, the order to try them in, and the rules that keep a deploy
   from locking itself out. Agents that load skills from the repository find it
   on their own.

2. Wire [chant](/loomster/concepts/glossary/#chant)'s MCP server, optionally. `chant serve mcp` (stdio) exposes
   `build`, `lint`, `list`, `describe`, `diff` and the Op tools, for inspecting
   and building the graph directly.

3. Give it a page. Every tutorial, guide and getting-started page has an
   "Optional: hand this page to your coding agent" prompt under its title, and
   [llms.txt](/loomster/llms.txt) lists every page with a one-line description.
   The prompt above brings Loom up locally and validates it.

4. Know the limits. Every prompt ends with the same rules: the agent never runs
   `chant approve` or `just grant`, never deploys to or deletes from a real
   account unless you asked in that session, never registers an identity
   provider in Loom, and never pushes or edits the `chant/lifecycle` branch.
   The repository enforces two of those:

   - A gated [Op](/loomster/concepts/glossary/#op) stops at exit 3 until a person
     approves ([Gated Ops](/loomster/concepts/gated-ops/)).
   - Claims and E2E scripts that hold real infrastructure stop at a human gate
     that needs a person at a terminal. You let an agent run named ones with
     `just grant <claim>`, which allows 2 runs in 4 hours by default
     ([Claims](/loomster/reference/claims/#the-gate-and-grants)).

## Next

[With a coding agent](/loomster/for/agents/) lists the pages an agent reads
first.
