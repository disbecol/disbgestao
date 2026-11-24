import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

const target = path.resolve(import.meta.dirname, "../../src/gestao-app");
if (
  path.basename(target) !== "gestao-app" ||
  path.basename(path.dirname(target)) !== "src"
) {
  throw Error("Destino de compilação inválido.");
}
export default defineConfig({
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  plugins: [react()],
  build: {
    target: "es2022",
    outDir: target,
    emptyOutDir: true,
    sourcemap: false,
    lib: {
      entry: path.resolve(import.meta.dirname, "src/main.ts"),
      name: "DISB_FORMS_UI",
      formats: ["iife"],
      fileName: () => "forms-react.js",
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    restoreMocks: true,
  },
});
