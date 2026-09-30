import { migrate, db } from "./db.ts";
import { startRunner } from "./runner.ts";
import { ensureBucket } from "./assets.ts";
await migrate();
await ensureBucket();
const stop = await startRunner();
console.log("Runner ready (pg-boss)");
let closing = false;
const close = async () => {
  if (closing) return;
  closing = true;
  await stop();
  await db.end();
  process.exit(0);
};
process.on("SIGTERM", close);
process.on("SIGINT", close);
