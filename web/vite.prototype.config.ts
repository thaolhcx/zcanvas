// Dev-only: the prototype page with polling file watching (native fs events miss edits here).
import { defineConfig, mergeConfig } from "vite";
import base from "./vite.config.ts";

export default mergeConfig(base, defineConfig({ server: { watch: { usePolling: true, interval: 250 } } }));
