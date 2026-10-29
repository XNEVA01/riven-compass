import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  base: process.env.BASE_PATH ?? "/",
  build: {
    // Vite 8 minifies CSS with lightningcss, whose default (baseline) targets rewrite
    // `@media (max-width: 1180px)` into the range form `@media (width<=1180px)` — dropped
    // whole by Firefox < 120 and Chromium cores < 104 (360/QQ-class browsers), taking
    // every responsive rule with it: the coach page stays two-column at any width and
    // the routes panel's right/bottom border slides off narrow windows. Pin older
    // targets so the classic max-width syntax survives minification.
    cssTarget: ["chrome100", "edge100", "firefox115", "safari15"],
  },
  plugins: [react()],
  resolve: {
    // WASM-only runtime (14 MB) instead of the WebGPU build (28 MB); ppu-paddle-ocr imports the bare name
    alias: [{ find: /^onnxruntime-web$/, replacement: "onnxruntime-web/wasm" }],
  },
  worker: { format: "es" },
  optimizeDeps: { exclude: ["onnxruntime-web", "ppu-paddle-ocr"] },
  test: {
    include: ["src/**/*.test.ts"],
    // the solver tests do real work; CI runners are a few times slower than a desktop
    testTimeout: 30_000,
  },
});
