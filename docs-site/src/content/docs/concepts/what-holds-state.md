---
title: Stateful resources
description: Which parts of a Loom deployment hold data a redeploy can't bring back, and what protects each of them.
---

A Loom deployment is mostly stateless infrastructure that redeploys from the
same CloudFormation templates. A few things hold real state, and those are what
backup and restore are about.

| Holds | What | A redeploy brings it back | Protected by |
|---|---|---|---|
| RDS Postgres | Loom's application data: agents, memories, credentials, costs, settings, registered roles | No | 7-day automated backups and point-in-time recovery, `DeletionPolicy: Snapshot`, `loom-backup` snapshots and DR copies, the upgrade Op's pre-migration snapshot |
| Cognito user pool | User records | Configuration only (groups, clients, resource server, scopes come back from code) | `loom-cognito-export`; deletion protection on the production [tiers](/loomster/concepts/tiers-and-instances/) |
| Secrets Manager | The database credential, MCP and A2A OAuth2 client secrets (`loom/*`) | No | Recreated by the stack for the database; Loom's own secrets live with the account |
| S3 artifact bucket | Agent code artifacts | Yes, rebuildable from source | Versioning, `DeletionPolicy: Retain` |
| ECR repositories | Built images | Yes, rebuilt from the pinned Loom source | Left behind by teardown |
| AgentCore | Runtimes, memories, credential providers created from Loom's UI | No | Nothing loomster adds; they live outside CloudFormation |
| CloudFormation templates | The infrastructure | Yes | git |

Two consequences:

- Multi-AZ on `production-ha` is availability. It removes single-AZ failure as a
  way to lose data, but a bad delete replicates to the standby too, so
  production-ha still needs backups.
- Every RDS restore creates a new instance. RDS has no in-place undo, so a
  restore is always followed by a cutover, which is why `loom-restore` is
  gated ([Gated Ops](/loomster/concepts/gated-ops/)).

[Back up and restore](/loomster/guides/back-up-and-restore/) has the steps, and
[Tiers and targets](/loomster/reference/tiers/#recovery-targets) the recovery
targets per tier.
