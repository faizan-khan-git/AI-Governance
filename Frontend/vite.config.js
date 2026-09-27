import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The dev server talks to the Backend directly (CORS is enabled there). All
// endpoint configuration is read from .env (VITE_*) — nothing is hardcoded.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: false,
  },
});
