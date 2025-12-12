/**
 * Face detection worker (stub)
 * Replace with MediaPipe or TF.js for production.
 * Accepts ImageBitmap frames and returns a faceCount number.
 *
 * Security: Worker isolates heavy ML from main thread to keep UI responsive.
 */
self.addEventListener("message", (e: MessageEvent) => {
  if ((e.data as any)?.type === "analyze") {
    // STUB: Random-ish result with a strong bias towards 1 face present.
    const r = Math.random();
    const faceCount = r < 0.85 ? 1 : r < 0.92 ? 0 : 2; // mostly 1, sometimes 0 or 2
    (self as any).postMessage({ type: "result", faceCount });
  }
});

