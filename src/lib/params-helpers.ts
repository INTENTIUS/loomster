/**
 * Shared build-time-parameter helpers (chant#1064 migration).
 *
 * `splitCsv`/`parseJson` used to be duplicated locally inside several
 * `params.ts` files. A `params.ts` declarator that calls a function DEFINED
 * IN THE SAME FILE can never fold — chant's fold engine only resolves a call
 * expression through the file's own `import`s (composite-factory-style
 * resolution), never a same-file helper. Moving these into an imported
 * sibling module is what lets `splitCsv(params.someCsvValue)`/
 * `parseJson(params.someJsonValue, ...)` fold: the callee resolves through
 * the import, the (already-build-time-parameter-resolved) argument resolves
 * to a literal, and chant invokes the real, pure function with it — same
 * mechanism a composite factory call already uses.
 */

/**
 * `params.<name>` when the chant CLI populated it, the named env var
 * otherwise, `undefined` when neither is set — the two-source read
 * `./stack-name.ts`'s `segment()` documents, generalized for the seam inputs
 * that still need it.
 *
 * Two chant paths never populate `params.*`, so a declared `env:` mapping
 * alone is not enough for either:
 *
 * - `chant run --components`, the deploy driver — component discovery never
 *   resolves build-time parameters (intentius/chant#1108).
 * - `chant build <subdir>`, which is every `npm run synth:*` script — the CLI
 *   searches for `chant.config.ts` in the built directory and its immediate
 *   parent only (`loadChantConfig(infraPath)` then
 *   `loadChantConfig(dirname(infraPath))`), so building `src/shared-foundation`
 *   looks in `src/shared-foundation` and `src`, finds nothing, and resolves no
 *   `buildParams` at all. Verified: `chant build src --param tier=production`
 *   prints `[param]` provenance, `chant build src/shared-foundation --param
 *   tier=production` fails with "unknown build parameter".
 *
 * Living in `src/lib/**` matters twice over: chant.config.ts exempts this
 * directory from EVL003 (the computed `process.env[name]` index), and a file
 * of exported function declarations can never fold anyway — which is the
 * point. The ambient read is confined here, and the resource-bearing file
 * that needs the value is left with a single call chant resolves through its
 * own imports and invokes for real.
 */
export function paramOrEnv(paramValue: unknown, envVar: string): string | undefined {
  if (typeof paramValue === "string") return paramValue;
  return process.env[envVar];
}

/** Comma-separated string -> trimmed, non-empty string array, or `undefined` for an empty/unset value. */
export function splitCsv(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  const parts = value.split(",").map((s) => s.trim()).filter(Boolean);
  return parts.length > 0 ? parts : undefined;
}

/** Parse a JSON-blob build-time parameter, or `undefined` for an empty/unset value. Throws a descriptive error (naming the parameter) on invalid JSON. */
export function parseJson<T>(raw: string | undefined, paramName: string): T | undefined {
  if (!raw) return undefined;
  // `new Error(...)` is constructed unconditionally, outside the try/catch,
  // then thrown conditionally — chant's EVL002 forbids a resource
  // constructor (any `new Xxx(...)`, including a plain `Error`) from
  // appearing inside a try/catch itself.
  let parsed: T | undefined;
  let failureMessage: string | undefined;
  try {
    parsed = JSON.parse(raw) as T;
  } catch (err) {
    failureMessage = (err as Error).message;
  }
  const parseError = new Error(`build parameter "${paramName}" must be valid JSON — ${failureMessage}`);
  if (failureMessage !== undefined) throw parseError;
  return parsed;
}
