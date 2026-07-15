import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", ".chant/**/*.test.ts", "ops/**/*.test.ts"],
    // main has no tests yet ahead of the composites/naming-helper work
    // landing (chant#886-#889, #897) — don't fail CI on an empty suite.
    passWithNoTests: true,
  },
});
