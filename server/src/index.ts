import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { startWorkers } from "./jobs/worker.js";

const app = createApp();

app.listen(env.API_PORT, "0.0.0.0", () => {
  logger.info(`SEAL API listening on :${env.API_PORT}`);
  startWorkers().catch((err) => logger.error("worker failed", err));
});
