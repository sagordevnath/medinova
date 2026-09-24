import pino from 'pino';
import type { Env } from '../config/env.js';

export function createLogger(level: string = 'info') {
  return pino({ level });
}

export function loggerFromEnv(env: Env) {
  return createLogger(env.LOG_LEVEL);
}

export type Logger = ReturnType<typeof createLogger>;
