/**
 * chant#906 — scheduled lifecycle pipelines. Unlike `src/gitlab-pipeline.test.ts`
 * (which validates a chant-*generated* `.gitlab-ci.yml` against the live
 * component graph), the four workflows here are hand-authored — chant's
 * component-pipeline generator seam (`generateComponentsPipeline`) has no
 * concept of a cron-scheduled Op invocation, only of the deploy-time
 * component graph (see `.gitlab-ci.yml`/`src/gitlab-pipeline.test.ts`). This
 * test instead proves the emitted `.github/workflows/*.yml` files match the
 * doctrine settled on chant#906: one workflow per stateless lifecycle
 * concern, each a thin `chant run <op>` trigger with a valid cron schedule
 * and an inert-by-default gate, and that no durable/gated Op from chant#905
 * ever appears in any of them.
 */

import { describe, test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseYAML } from "@intentius/chant/yaml";

const WORKFLOWS_DIR = resolve(".github/workflows");

function loadWorkflow(name: string): { raw: string; parsed: Record<string, unknown> } {
  const raw = readFileSync(resolve(WORKFLOWS_DIR, name), "utf-8");
  return { raw, parsed: parseYAML(raw) };
}

/** A conservative 5-field cron shape check — minute hour day month weekday. */
const CRON_SHAPE = /^\S+ \S+ \S+ \S+ \S+$/;

interface Expectation {
  file: string;
  jobName: string;
  cron: string;
  gateVar: string;
  npmScript: string;
}

const SCHEDULED_LIFECYCLE_WORKFLOWS: Expectation[] = [
  { file: "watch.yml", jobName: "watch", cron: "*/15 * * * *", gateVar: "SCHEDULED_WATCH", npmScript: "npm run watch" },
  { file: "reconcile.yml", jobName: "reconcile", cron: "0 * * * *", gateVar: "SCHEDULED_RECONCILE", npmScript: "npm run reconcile" },
  { file: "cost-report.yml", jobName: "cost-report", cron: "0 6 * * 1", gateVar: "SCHEDULED_COST_REPORT", npmScript: "npm run estimate-cost" },
  { file: "audit.yml", jobName: "audit", cron: "0 6 * * *", gateVar: "SCHEDULED_AUDIT", npmScript: "npm run audit" },
];

describe("chant#906 — one scheduled GitHub Actions workflow per stateless lifecycle concern", () => {
  for (const expectation of SCHEDULED_LIFECYCLE_WORKFLOWS) {
    describe(expectation.file, () => {
      const { raw, parsed } = loadWorkflow(expectation.file);

      test("has a valid cron schedule, matching the shape of its Op's own Temporal cadence", () => {
        const on = parsed.on as { schedule?: Array<{ cron: string }> };
        expect(on.schedule).toHaveLength(1);
        expect(on.schedule![0].cron).toMatch(CRON_SHAPE);
        expect(on.schedule![0].cron).toBe(expectation.cron);
      });

      test("also exposes workflow_dispatch for an on-demand run", () => {
        const on = parsed.on as Record<string, unknown>;
        expect(on).toHaveProperty("workflow_dispatch");
      });

      test("is inert by default — the job gates on an opt-in repo variable", () => {
        const jobs = parsed.jobs as Record<string, { if?: string }>;
        const job = jobs[expectation.jobName];
        expect(job).toBeDefined();
        expect(job.if).toContain(`vars.${expectation.gateVar} == 'true'`);
      });

      test("is a thin trigger — its one meaningful run step is the Op's own npm script, nothing else", () => {
        const jobs = parsed.jobs as Record<string, { steps: Array<{ run?: string }> }>;
        const runLines = jobs[expectation.jobName].steps.map((s) => s.run).filter((r): r is string => !!r);
        expect(runLines).toContain(expectation.npmScript);

        // No inline apply/rollback/deploy command anywhere in this workflow's
        // steps — the doctrine (docs/.../orchestration.mdx's "keep logic out
        // of the trigger") means the *only* domain-specific command is the
        // one-shot `chant run <op>` (via its npm script), never a shell
        // sequence that decides or performs a cloud mutation itself.
        for (const line of runLines) {
          expect(line).not.toMatch(/chant\s+run\s+--components/);
          expect(line).not.toMatch(/aws\s+cloudformation/);
        }
      });

      test("never schedules a durable/gated Op from chant#905 (upgrade/rotate/teardown)", () => {
        expect(raw).not.toMatch(/loom-upgrade/);
        expect(raw).not.toMatch(/loom-rotate/);
        expect(raw).not.toMatch(/loom-teardown/);
      });
    });
  }

  test("reconcile.yml additionally requires the chant#890 tier dial (production/production-ha), not just the opt-in variable", () => {
    const { parsed } = loadWorkflow("reconcile.yml");
    const job = (parsed.jobs as Record<string, { if?: string }>).reconcile;
    expect(job.if).toContain("vars.LOOM_TIER == 'production'");
    expect(job.if).toContain("vars.LOOM_TIER == 'production-ha'");
  });

  test("reconcile.yml has write permissions for its PR (contents + pull-requests), matching reconcilePr's `gh pr create`", () => {
    const { parsed } = loadWorkflow("reconcile.yml");
    const permissions = parsed.permissions as Record<string, string>;
    expect(permissions.contents).toBe("write");
    expect(permissions["pull-requests"]).toBe("write");
  });

  test("cost-report.yml and audit.yml touch no cloud credentials — read-only permissions, no `environment:` gate", () => {
    const costReport = loadWorkflow("cost-report.yml").parsed;
    const audit = loadWorkflow("audit.yml").parsed;
    const costReportJobs = costReport.jobs as Record<string, { environment?: string }>;
    const auditJobs = audit.jobs as Record<string, { environment?: string }>;

    expect((costReport.permissions as Record<string, string>).contents).toBe("read");
    expect((audit.permissions as Record<string, string>).contents).toBe("read");
    expect(costReportJobs["cost-report"].environment).toBeUndefined();
    expect(auditJobs.audit.environment).toBeUndefined();
  });

  test("none of the four workflows are GitLab pipelines — chant#906 is GitHub-first, GitLab is out of scope here", () => {
    for (const { file } of SCHEDULED_LIFECYCLE_WORKFLOWS) {
      const { raw } = loadWorkflow(file);
      expect(raw).not.toContain("stages:");
    }
  });
});
