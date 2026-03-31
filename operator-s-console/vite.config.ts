import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// The console build is intentionally deterministic; stale Browserslist metadata
// should not create recurring warning noise during normal local or CI builds.
process.env.BROWSERSLIST_IGNORE_OLD_DATA = "true";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  base: "/operator/",
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom"],
  },
  build: {
    // Keep the warning threshold above the console's normal production bundle
    // size instead of forcing brittle vendor chunk boundaries.
    chunkSizeWarningLimit: 1200,
  },
}));
