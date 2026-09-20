import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Freebuff sets PORT for the preview server. HMR stays disabled.
const port = Number(process.env.PORT || 3000);

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    hmr: false,
    port,
    strictPort: true,
  },
  preview: {
    host: "0.0.0.0",
    port,
  },
});
