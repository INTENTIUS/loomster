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
