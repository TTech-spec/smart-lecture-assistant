// After the build: copy the PWA service worker (sw.js + workbox) next to the
// published site. vite-plugin-pwa writes it to dist/, which the server build
// doesn't publish, so without this the live site has no service worker
// (no offline mode, no notifications).
import { cpSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const from = "dist";
if (!existsSync(join(from, "sw.js"))) {
  console.log("[copy-sw] no dist/sw.js, nothing to copy");
  process.exit(0);
}
const files = readdirSync(from).filter((f) => f === "sw.js" || /^workbox-.*\.js$/.test(f));
const targets = [".output/public", ".vercel/output/static", "dist/client"].filter((d) => existsSync(d));
for (const t of targets) for (const f of files) cpSync(join(from, f), join(t, f));
console.log(`[copy-sw] copied ${files.join(", ")} to ${targets.join(", ") || "(no output folder found)"}`);
