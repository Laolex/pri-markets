import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
      "Content-Security-Policy":
        "default-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob: data: https:; script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob: data: https:; script-src-elem 'self' 'unsafe-inline' blob: data: https:; connect-src 'self' https: wss: blob: data:; worker-src 'self' blob:; img-src 'self' data: https:;",
    },
    proxy: {
      "/api/zama-relay": {
        target: "https://relayer.testnet.zama.org",
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/api\/zama-relay/, ""),
      },
    },
  },
  optimizeDeps: { exclude: ["@zama-fhe/relayer-sdk"] },
});
