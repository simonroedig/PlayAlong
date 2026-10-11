import { readFileSync } from "node:fs";
import type { NextConfig } from "next";

const ortVersion: string = JSON.parse(
  readFileSync(new URL("./node_modules/onnxruntime-web/package.json", import.meta.url), "utf8"),
).version;

const nextConfig: NextConfig = {
  // Let phones and other computers on the local network open the dev server (http://192.168.x.y:3000 etc.).
  allowedDevOrigins: ["10.*.*.*", "172.*.*.*", "192.168.*.*", "*.local"],
  env: {
    // scripts/setup.mjs copies the runtime to public/ort/<version>/
    NEXT_PUBLIC_ORT_VERSION: ortVersion,
  },
  async headers() {
    return [
      {
        // Cross-origin isolation unlocks SharedArrayBuffer, which the
        // multi-threaded WebAssembly backend and the audio engine rely on.
        source: "/:path*",
        headers: [
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
        ],
      },
      {
        source: "/ort/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
    ];
  },
};

export default nextConfig;
