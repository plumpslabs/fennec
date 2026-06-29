import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node20",
  clean: true,
  dts: true,
  sourcemap: true,
  splitting: true,
  outDir: "dist",
  external: [
    "@modelcontextprotocol/sdk",
    "playwright",
    "zod",
  ],
});
