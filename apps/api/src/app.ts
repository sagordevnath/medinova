import 'dotenv/config';
import express, { type Express } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import pinoHttp from 'pino-http';
import swaggerUi from 'swagger-ui-express';
import { loadEnv, type Env } from './config/env.js';
import { openApiDoc, swaggerOptions } from './config/openapi.js';
import { requestId } from './middleware/request-id.js';
import { errorHandler, notFound } from './middleware/error.js';
import { apiRouter } from './routes/index.js';
import { createLogger, type Logger } from './utils/logger.js';

export interface BuiltApp {
  app: Express;
  env: Env;
  logger: Logger;
}

/**
 * Compose the Express app. Split from index.ts so tests/acceptance can
 * import the app without binding a port (and control cron separately).
 */
export function buildApp(): BuiltApp {
  const env = loadEnv();
  const logger = createLogger(env.LOG_LEVEL);

  const app = express();
  app.disable('x-powered-by');
  // Behind one reverse proxy (Docker/nginx) — required for correct client IPs
  // in the rate limiter.
  app.set('trust proxy', 1);

  app.use(requestId);
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req as { id?: string }).id ?? 'unknown',
      autoLogging: { ignore: (req) => req.url === '/health' },
    }),
  );
  app.use(helmet());
  // CORS: CLIENT_URL only (no wildcard — credentialed requests).
  app.use(cors({ origin: env.CLIENT_URL, methods: ['GET', 'POST', 'PATCH', 'DELETE'], allowedHeaders: ['Content-Type', 'Authorization'] }));
  app.use(express.json({ limit: '100kb' }));

  // OpenAPI docs (no auth — static UI).
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(openApiDoc, swaggerOptions(env)));
  app.get('/docs.json', (_req, res) => res.json(openApiDoc));

  // Root health for orchestrators + load balancers (README contract).
  app.get('/health', (_req, res) =>
    res.json({ ok: true, service: 'medinova-api', timezone: 'Asia/Dhaka', currency: 'BDT', time: new Date().toISOString() }),
  );

  // Versioned API; /v1 kept as alias so the existing web app keeps working.
  app.use('/api/v1', apiRouter(env, logger));
  app.use('/v1', apiRouter(env, logger));

  app.use(notFound);
  app.use(errorHandler(logger));

  return { app, env, logger };
}
