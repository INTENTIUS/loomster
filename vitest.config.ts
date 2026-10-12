import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", ".chant/**/*.test.ts", "ops/**/*.test.ts", "scripts/**/*.test.ts"],
  },
});
