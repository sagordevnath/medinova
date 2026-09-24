import { buildApp } from './app.js';
import { startCronJobs } from './services/cron.service.js';

const { app, env, logger } = buildApp();

// Cron jobs (reminders / no-show / unpaid-hold cleanup) — disable with CRON_ENABLED=false.
const tasks = env.CRON_ENABLED ? startCronJobs(env, logger) : [];

const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT, cron: env.CRON_ENABLED }, 'MediNova API listening');
});

function shutdown(signal: string): void {
  logger.info({ signal }, 'shutting down');
  for (const t of tasks) t.stop();
  server.close(() => process.exit(0));
  // Failsafe for open keep-alive sockets.
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

