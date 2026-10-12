// Holds the docs site to its conventions (docs-site, loomster#45):
//   - a page describes what works today: no roadmap words, no issue-tracker links;
//   - titles and headings are noun phrases, not questions;
//   - every page has a description; every tutorial, guide and getting-started
//     page has a `prompt:` that names its own page and carries the never-line
//     from docs-site/src/prompts.ts word for word;
//   - `claims:` names claims that exist in test/claims/;
//   - a page that uses a house term (chant, Floci, Op, seam, tier, instance)
//     links the glossary entry or a page that defines it;
//   - the lists the code defines match their pages: the Ops (ops/*.op.ts) and
//     reference/ops, the build parameters (chant.config.ts) and
//     reference/parameters, the validation checks (scripts/validate/checks.ts)
//     and reference/screens;
//   - reference/validation's recorded-claims table matches test/claims-record.json
//     (scripts/claims-page.mjs writes it);
//   - every internal link reaches a page or a redirect, and its anchor a heading.
//
//   node scripts/lint-docs.mjs        (npm run lint:docs)
// Exits 1 with one line per problem.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { stale, PAGE } from "./claims-page.mjs";

const DOCS = "docs-site/src/content/docs/";
const SITE = "https://intentius.io/loomster";
const read = (p) => readFileSync(p, "utf8");
const walk = (p) => (statSync(p).isDirectory() ? readdirSync(p).sort().flatMap((e) => walk(join(p, e))) : [p]);

const files = walk(DOCS).filter((f) => /\.mdx?$/.test(f));
/** "guides/tear-down", "tutorial" for tutorial/index, "" for the home page. */
const pageId = (file) => file.slice(DOCS.length).replace(/\.mdx?$/, "").replace(/(^|\/)index$/, "");
const pages = new Map(files.map((f) => [pageId(f), f]));
const problems = [];
const fail = (where, msg) => problems.push(`${where}: ${msg}`);

const neverLine = /neverLine =\s*\n?\s*'([^']+)'/.exec(read("docs-site/src/prompts.ts"))[1];
const redirects = new Set([...read("docs-site/astro.config.mjs").matchAll(/^\s*'(\/[^']+)': '\/loomster\//gm)].map((m) => m[1].replace(/^\/|\/$/g, "")));

function split(text) {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  return { front: m?.[1] ?? "", body: m ? text.slice(m[0].length) : text };
}
function field(front, name) {
  const lines = front.split("\n");
  const at = lines.findIndex((l) => l.startsWith(`${name}:`));
  if (at === -1) return undefined;
  const head = lines[at].slice(name.length + 1).trim();
  if (!/^[|>]/.test(head)) return head.replace(/^(["'])(.*)\1$/, "$2");
  const block = [];
  for (const l of lines.slice(at + 1)) {
    if (l.trim() && !/^\s/.test(l)) break;
    block.push(l.trim());
  }
  return block.join(" ").trim();
}
/** Prose only: no code fences, inline code, MDX imports or component tags. */
function prose(body) {
  let fence = false;
  return body
    .split("\n")
    .map((l) => {
      if (/^\s*(```|~~~)/.test(l)) { fence = !fence; return ""; }
      if (fence || /^(import |export )/.test(l) || /^\s*<\/?[A-Z][^>]*>\s*$/.test(l)) return "";
      return l.replace(/`[^`]*`/g, "``");
    })
    .join("\n");
}
const slug = (h) => h.toLowerCase().replace(/<[^>]+>/g, "").replace(/[`*_]/g, "").replace(/[^\p{L}\p{N}\s-]/gu, "").trim().replace(/\s/g, "-");
const anchors = new Map([...pages].map(([id, f]) => [id, new Set([...read(f).matchAll(/^#{1,6}\s+(.+?)\s*$/gm)].map((m) => slug(m[1])))]));

const claimNames = new Set(walk("test/claims").filter((f) => f.endsWith(".sh")).map((f) => f.slice("test/claims/".length, -3)));

// The house terms, each with the links that count as defining it.
const G = "/loomster/concepts/glossary/";
const TERMS = [
  { term: "chant", re: /(?<![\w./@`-])chant(?![\w/`-])/, links: [`${G}#chant`, "https://intentius.io/chant/", "/loomster/concepts/why-chant/"], defines: ["concepts/why-chant"] },
  { term: "Floci", re: /\bFloci\b/, links: [`${G}#floci`, "/loomster/reference/local-caveats/", "/loomster/getting-started/"], defines: ["reference/local-caveats", "getting-started"] },
  { term: "Op", re: /\bOps?\b/, links: [`${G}#op`, "/loomster/reference/ops/", "/loomster/concepts/gated-ops/"], defines: ["reference/ops", "concepts/gated-ops"] },
  { term: "seam", re: /\bseams?\b/i, links: [`${G}#seam`, "/loomster/concepts/adoption-seams/", "/loomster/reference/adoption-seams/"], defines: ["concepts/adoption-seams", "reference/adoption-seams"] },
  { term: "tier", re: /\btiers?\b/i, links: [`${G}#tier`, "/loomster/concepts/tiers-and-instances/", "/loomster/reference/tiers/"], defines: ["concepts/tiers-and-instances", "reference/tiers"] },
  // An RDS, EC2 or throwaway instance is a database or a host, not a Loom instance.
  { term: "instance", re: /(?<!\b(?:RDS|DB|database|EC2|drill|throwaway|new|restored|old|original|source|live|private|Multi-AZ|the restored|a new|single) )\binstances?\b/i, links: [`${G}#instance`, "/loomster/concepts/tiers-and-instances/"], defines: ["concepts/tiers-and-instances", "reference/naming"] },
];

const ROADMAP = /\b(planned|coming soon|roadmap|not yet|in development|being built|will be added|temporal)\b/i;
const ISSUES = /github\.com\/[^)\s]+\/(?:issues|pull)\/\d+|\b[\w.-]+\/[\w.-]+#\d+\b|\bloomster#\d+|\(#\d+\)|\bchant#\d+/;

for (const [id, file] of pages) {
  const text = read(file);
  const { front, body } = split(text);
  const where = file;
  const p = prose(body);

  // Front matter.
  const title = field(front, "title");
  if (!field(front, "description")) fail(where, "no description");
  if (title && (/^(what|how|why|when|where|who)\b/i.test(title) || title.endsWith("?"))) fail(where, `title "${title}" is a question; use a noun phrase`);
  const claims = /^claims:\s*\[([^\]]*)\]/m.exec(front)?.[1].split(",").map((c) => c.trim()).filter(Boolean) ?? [];
  for (const c of claims) if (!claimNames.has(c)) fail(where, `claims: ${c} is not a claim in test/claims/`);

  // Prompts on task pages.
  const prompt = field(front, "prompt");
  const task = /^(tutorial|guides|getting-started)(\/|$)/.test(id);
  if (task && !prompt) fail(where, "a tutorial, guide or getting-started page needs a prompt:");
  if (prompt && prompt !== "setup") {
    const flat = prompt.replace(/\s+/g, " ");
    if (!flat.includes(neverLine)) fail(where, "the prompt lacks the never-line from docs-site/src/prompts.ts, word for word");
    if (!flat.includes(`${SITE}/${id}${id ? "/" : ""}`)) fail(where, `the prompt doesn't name its page, ${SITE}/${id}/`);
  }

  // Prose rules.
  p.split("\n").forEach((line, i) => {
    const r = ROADMAP.exec(line);
    if (r) fail(`${where}:${i + 1}`, `"${r[0]}": describe what works today`);
    const m = /^#{1,6}\s+(.+)$/.exec(line);
    if (m && (/^(what|how|why|when|where|who)\b/i.test(m[1]) || m[1].trim().endsWith("?"))) fail(`${where}:${i + 1}`, `heading "${m[1]}" is a question; use a noun phrase`);
  });
  body.split("\n").forEach((line, i) => {
    const r = ISSUES.exec(line);
    if (r) fail(`${where}:${i + 1}`, `"${r[0]}": no issue-tracker links in pages`);
  });

  // House terms.
  if (id !== "concepts/glossary") {
    for (const t of TERMS) {
      if (t.defines?.includes(id)) continue;
      // A term inside a link's text already points somewhere.
      const bare = p.replace(/\[[^\]]*\]\([^)]*\)/g, "").replace(/^#{1,6}\s.*$/gm, "");
      if (!t.re.test(bare)) continue;
      if (!t.links.some((l) => text.includes(`](${l}`))) fail(where, `uses "${t.term}" without linking ${t.links[0]} or a page that defines it`);
    }
  }

  // Internal links and anchors.
  for (const m of text.matchAll(/\]\((\/loomster\/[^)\s]*)\)|href="(\/loomster\/[^"]*)"/g)) {
    const url = m[1] ?? m[2];
    const [path, anchor] = url.replace(/^\/loomster\/?/, "").split("#");
    const target = path.replace(/\/$/, "");
    if (target === "llms.txt") continue;
    if (!pages.has(target)) {
      if (!redirects.has(target)) fail(where, `link ${url} reaches no page`);
      else fail(where, `link ${url} goes through a redirect; link the page itself`);
      continue;
    }
    if (anchor && !anchors.get(target).has(anchor)) fail(where, `link ${url}: no heading #${anchor} on ${target || "the home page"}`);
  }
}

// Every link from the README into the site reaches a page.
for (const m of read("README.md").matchAll(/https:\/\/intentius\.io\/loomster\/([^)\s#*]*)/g)) {
  const target = m[1].replace(/\/$/, "");
  if (target !== "llms.txt" && !pages.has(target)) fail("README.md", `link ${m[0]} reaches no page`);
}
for (const f of ["README.md", "skills/loomster/SKILL.md"]) {
  prose(read(f)).split("\n").forEach((line, i) => {
    const r = ROADMAP.exec(line);
    if (r) fail(`${f}:${i + 1}`, `"${r[0]}": describe what works today`);
  });
}

// Lists the code defines, held to their pages.
function compare(what, inCode, onPage, page) {
  for (const n of inCode) if (!onPage.has(n)) fail(page, `${what} ${n} is in the code and not on the page`);
  for (const n of onPage) if (!inCode.has(n)) fail(page, `${what} ${n} is on the page and not in the code`);
}
{
  const page = pages.get("reference/ops");
  const ops = new Set(readdirSync("ops").filter((f) => f.endsWith(".op.ts")).map((f) => f.slice(0, -".op.ts".length)));
  const rows = new Set([...read(page).matchAll(/^\| `(loom-[a-z0-9-]+)` \|/gm)].map((m) => m[1]));
  compare("Op", ops, rows, page);
}
{
  const page = pages.get("reference/parameters");
  const cfg = read("chant.config.ts");
  const block = cfg.slice(cfg.indexOf("buildParams: {"), cfg.indexOf("  lint: {"));
  const envs = new Set([...block.matchAll(/env: "([A-Z0-9_]+)"/g)].map((m) => m[1]));
  const rows = new Set([...read(page).matchAll(/^\| `((?:LOOM|AWS)_[A-Z0-9_]+)` \|/gm)].map((m) => m[1]));
  compare("build parameter", envs, rows, page);
}
{
  const page = pages.get("reference/screens");
  const checks = new Set([...read("scripts/validate/checks.ts").matchAll(/screen: "([^"]+)"/g)].map((m) => m[1]));
  const text = read(page);
  const table = text.slice(text.indexOf("## Validation checks"));
  const rows = new Set([...table.matchAll(/^\| ([^|`]+?) \| `/gm)].map((m) => m[1].trim()));
  compare("validation check", checks, rows, page);
}

if (stale()) fail(PAGE.slice(DOCS.length), "the recorded-claims table does not match test/claims-record.json: run npm run claims:page");

for (const p of problems) console.log(`FAIL  ${p}`);
console.log(problems.length ? `lint-docs: ${problems.length} problem(s)` : `lint-docs: ${pages.size} pages ok`);
process.exit(problems.length ? 1 : 0);
