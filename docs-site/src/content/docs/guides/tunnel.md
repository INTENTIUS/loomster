---
title: Open a tunnel to the database
description: Deploy the optional SSM tunnel host (Loom's ec2.yaml) and port-forward localhost to the RDS Proxy with Session Manager, Loom's make tunnel.
---

## Result

`localhost:5432` forwards to your deployment's database: the RDS Proxy on
production and production-ha, the RDS instance on light. You can then connect
`psql` or a migration script to a database that has no public endpoint. The traffic
runs through an EC2 host with no public IP and no SSH key, reached only through
AWS Systems Manager Session Manager. This is the chant version of Loom's
`backend/iac/ec2.yaml` and `make tunnel`.

## Prerequisites

- A deployed `shared-foundation` and `loom-db` (`chant run --components all`).
- The [Session Manager plugin](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html)
  for the AWS CLI.
- The same `LOOM_PROJECT`, `LOOM_ENV` and `LOOM_INSTANCE` the deployment used.
- A route from the private subnets to Systems Manager: a NAT gateway, or the
  `ssm`, `ssmmessages` and `ec2messages` VPC endpoints. If you have neither, set
  `LOOM_TUNNEL_SSM_ENDPOINTS=true` in step 1 and the host's stack creates the
  endpoints. Don't set it if the VPC already has those endpoints with private
  DNS, because AWS rejects a second set.

## Steps

1. Deploy the host. It's off until you do this, and `chant run --components all`
   never deploys it.

   ```sh
   just tunnel-host
   ```

   `chant run loom-tunnel-host` reads the VPC and private subnets from
   shared-foundation and the database's security group and port from loom-db.
   It then deploys `{project}-{env}-{instance}-tunnel-host`: a `t3.micro` running
   the latest Amazon Linux 2023, with `AmazonSSMManagedInstanceCore`, IMDSv2
   only, and an ingress rule on the database's security group from the host.
   Override any input by setting it first: `LOOM_TUNNEL_VPC_ID`,
   `LOOM_TUNNEL_SUBNET_IDS` (comma-separated), `LOOM_TUNNEL_DB_SG_ID`,
   `LOOM_TUNNEL_DB_PORT`, `LOOM_TUNNEL_INSTANCE_TYPE`. A Graviton type such as
   `t4g.micro` gets the arm64 image. With a referenced database
   (`LOOM_DB_MODE=reference-existing`), there's no security group to read, so
   open yours to the host's `oSecurityGroupId` yourself.

2. Open the tunnel. It runs until you press Ctrl-C.

   ```sh
   just tunnel          # localhost:5432
   just tunnel 15432    # another local port
   ```

   The script prints the Secrets Manager command that reads the database
   credentials.

3. Connect, for example with
   `psql "host=localhost port=5432 dbname=loom user=<username> sslmode=require"`.
   The RDS Proxy requires TLS.

The host stays up between tunnels. Delete it with
`aws cloudformation delete-stack --stack-name <prefix>-tunnel-host` when you're
done. `loom-teardown` deletes it first, before the stacks it sits on.

## Next

- [Backup & restore](/loomster/operations/backup-restore/): the restore Op works without a tunnel.
- [Network & IAM](/loomster/adoption/network-and-iam/): the security groups the tunnel relies on.
