/// <reference lib="webworker" />
// Runs PaddleOCR (PP-OCRv6 tiny) on a screenshot entirely in the browser.
// "onnxruntime-web" is aliased to its WASM-only build in vite.config.ts, shared with ppu-paddle-ocr
import * as ort from "onnxruntime-web";
import { PaddleOcrService } from "ppu-paddle-ocr/web";
import type { OcrItem } from "./parse";

const base = new URL(import.meta.env.BASE_URL, self.location.origin).href;
// ppu-paddle-ocr points the runtime at jsDelivr when it is imported. Clear that, so the runtime uses its own glue code
// and the WASM binary Vite ships next to this worker: same build, and screenshots still read when the CDN is down.
ort.env.wasm.wasmPaths = undefined;
ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;

let ready: Promise<PaddleOcrService> | null = null;
function service() {
  ready ??= Promise.resolve()
    .then(async () => {
      const s = new PaddleOcrService({
        model: {
          detection: `${base}models/PP-OCRv6_tiny_det.ort`,
          recognition: `${base}models/PP-OCRv6_tiny_rec.ort`,
          charactersDictionary: `${base}models/ppocrv6_tiny_dict.txt`,
        },
        // "auto" runs detection at 1920px on a 4K screenshot — minutes-of-waiting slow on this single-threaded
        // wasm worker. The game's text is large; a 1280px cap finds it all at a fraction of the time
        // (recognition still crops from the source image, so its precision is untouched).
        detection: { maxSideLength: 1280 },
        session: { executionProviders: ["wasm"], graphOptimizationLevel: "all" },
      });
      try {
        await s.initialize();
        return s;
      } catch (err) {
        await s.destroy().catch(() => {});
        throw err;
      }
    })
    .catch((err) => {
      ready = null;
      throw err;
    });
  return ready;
}

export interface OcrRequest {
  id: number;
  image: ArrayBuffer;
}
/** init: the reader itself failed to load (network, missing runtime); this worker cannot recover from that */
export type OcrResponse = { id: number; ok: true; width: number; height: number; items: OcrItem[]; ms: number } | { id: number; ok: false; error: string; init?: true };

async function recognizeRequest({ id, image }: OcrRequest) {
  try {
    const t0 = performance.now();
    const bitmap = await createImageBitmap(new Blob([image]));
    const { width, height } = bitmap;
    let canvas: OffscreenCanvas;
    try {
      canvas = new OffscreenCanvas(width, height);
      (canvas.getContext("2d") as OffscreenCanvasRenderingContext2D).drawImage(bitmap, 0, 0);
    } finally {
      bitmap.close();
    }
    let s: PaddleOcrService;
    try {
      s = await service();
    } catch (err) {
      const msg: OcrResponse = { id, ok: false, error: err instanceof Error ? err.message : String(err), init: true };
      self.postMessage(msg);
      return;
    }
    // Consecutive rolls may differ in only a few digits; don't reuse a sampled-image cache key.
    const r = await s.recognize(canvas, { flatten: true, noCache: true });
    const items: OcrItem[] = r.results.map((i) => ({
      text: i.text,
      box: { x: i.box.x, y: i.box.y, w: i.box.width, h: i.box.height },
      conf: i.confidence,
    }));
    const msg: OcrResponse = { id, ok: true, width, height, items, ms: performance.now() - t0 };
    self.postMessage(msg);
  } catch (err) {
    const msg: OcrResponse = { id, ok: false, error: err instanceof Error ? err.message : String(err) };
    self.postMessage(msg);
  }
}

// A shared inference session must finish the current image before starting another.
let queue = Promise.resolve();
self.onmessage = (e: MessageEvent<OcrRequest | { warm: true }>) => {
  const request = e.data;
  if ("warm" in request) {
    // a preload that fails says so (id 0), so the page starts over with a fresh worker
    service().catch((err) => self.postMessage({ id: 0, ok: false, error: err instanceof Error ? err.message : String(err), init: true } satisfies OcrResponse));
    return;
  }
  queue = queue.then(() => recognizeRequest(request));
  return queue;
};
