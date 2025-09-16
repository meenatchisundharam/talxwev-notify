import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs", "esm", "iife"],
  globalName: "TalxwevNotify",
  dts: true,
  sourcemap: true,
  clean: true,
  minify: true,
  target: "es2019"
});
