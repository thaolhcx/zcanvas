import { migrate, db } from "./db.ts";
import { createApp } from "./app.ts";
import { createSyncServer } from "./sync.ts";
import { config } from "./config.ts";
import { ensureBucket } from "./assets.ts";
import { startQueue, boss } from "./runner.ts";
await migrate();
await ensureBucket();
await startQueue();
const app = await createApp(),
  sync = createSyncServer();
await sync.listen();
await app.listen({ port: config.apiPort, host: "127.0.0.1" });
console.log(`API ${config.publicUrl} · sync ws://127.0.0.1:${config.syncPort}`);
let closing = false;
const close = async () => {
  if (closing) return;
  closing = true;
  await sync.destroy();
  await app.close();
  await boss.stop();
  await db.end();
  process.exit(0);
};
process.on("SIGTERM", close);
process.on("SIGINT", close);
