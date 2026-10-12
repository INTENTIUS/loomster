---
title: Coming from the AgentCore starter toolkit
description: What Loom adds on top of an agent you deploy with the Bedrock AgentCore starter toolkit, how the toolkit's commands map to Loom's screens and API, and where your own agents fit.
prompt: |
  Read https://intentius.io/loomster/guides/coming-from-agentcore-starter-toolkit/ and, against the person's local Loom (`just local-up`), show the Loom screen or API call for each toolkit command they use.
  If they name an AgentCore runtime they deployed with the toolkit, show how to register it in Loom by ARN; register it only if they ask in this session.
  Never run `chant approve` or `just grant`, never deploy to or delete from a real AWS account unless the person asked for that in this session, never register an identity provider in Loom, and never push or edit the `chant/lifecycle` branch.
---

## Result

An agent you built with the toolkit, or one Loom builds for you, governed in
Loom: in its catalog, behind its groups and approval policies, with its costs,
evaluations and skills.

## Loom's additions

The starter toolkit gets one agent onto AgentCore Runtime from your laptop. Loom
is the platform around many agents: users and groups from Cognito, a catalog,
IAM roles registered by a security admin, approval policies on tool calls,
evaluations, skills from an Agent Registry, MCP servers and A2A agents, and
cost and activity dashboards. loomster deploys Loom itself.

## The first command

```
just local-up       # Loom on your laptop, no AWS account
```

Then open `http://localhost:8080` ([Run Loom locally](/loomster/getting-started/)).
Agents deploy on [Floci](/loomster/concepts/glossary/#floci) too; invoking one
there returns a canned reply.

## Commands

| To do this | Starter toolkit | Loom |
|---|---|---|
| Describe an agent | `agentcore configure --entrypoint agent.py` | Agents > new agent, guided setup (Runtime, Identity and models, Access, Tools and memory, Lifecycle and tags), or import a JSON manifest |
| Deploy it | `agentcore launch` | the end of the guided setup, or `POST /api/agents` with `source: "deploy"` |
| Bring an existing runtime | | register it by ARN: the new-agent screen's "register an existing runtime", or `POST /api/agents` with `{"source": "register", "arn": "<runtime ARN>"}` |
| Invoke | `agentcore invoke '{"prompt": "..."}'` | the agent's Invoke tab, or `POST /api/agents/<id>/invoke` |
| Check status | `agentcore status` | the Agents screen, or `GET /api/agents/<id>/status` |
| Remove | `agentcore destroy` | delete the agent in Loom (`DELETE /api/agents/<id>`) |
| Execution role | created for you | registered by an admin under Security > IAM roles; loomster creates it ([Create an execution role per agent](/loomster/guides/create-an-execution-role-per-agent/)) |
| Memory | configured with the agent | the Memory screen |

## Your own agents

- Loom's deploy path builds agents from configuration on its own harnesses,
  Strands by default, with Google's ADK as an option. You choose the model,
  tools, memory and access; no code of yours is deployed.
- An agent with your own code, deployed with the toolkit or any other way, is a
  runtime ARN. Register it in Loom to put it in the catalog and invoke it
  through Loom.
- The assistant loomster deploys in `loom-agents` is a chant-managed runtime
  from Loom's Strands harness on AgentCore Runtime V2, as Loom's own deploys
  are.

The roles a registered runtime runs with are yours; the Loom role picker lists
only roles registered under Security > IAM roles.

## Behavior differences

- Loom never creates IAM. The toolkit makes an execution role for you; in Loom
  an admin registers one and tags it into the group allowed to use it.
- A user sees only agents whose `loom:group` tag matches one of their groups.
- Model calls go through `bedrock-runtime`, and for some models
  `bedrock-mantle`; both need egress on a private network.

## Next

- [Browse Loom on your laptop](/loomster/tutorial/).
- [Screens](/loomster/reference/screens/) for what each screen does.
