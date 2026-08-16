import { pino } from 'pino';
import { env } from '../env.js';

/**
 * Structured JSON in production (so a log aggregator can index the fields),
 * human-readable in development.
 *
 * `redact` is the important part: request logs would otherwise carry bearer
 * tokens and the refresh cookie straight into whatever stores the logs.
 */
export const rootLogger = pino({
  level: env.LOG_LEVEL,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
      '*.password',
      '*.passwordHash',
      '*.accessToken',
    ],
    censor: '[redacted]',
  },
  ...(env.isProd
    ? {}
    : {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
        },
      }),
});

/**
 * Wraps pino's (mergingObject, message) signature as (message, extra) so call
 * sites read naturally and nothing has to remember the argument order.
 */
export function createLogger(scope: string) {
  const child = rootLogger.child({ scope });

  return {
    info: (message: string, extra?: unknown) =>
      extra === undefined ? child.info(message) : child.info({ detail: extra }, message),
    warn: (message: string, extra?: unknown) =>
      extra === undefined ? child.warn(message) : child.warn({ detail: extra }, message),
    error: (message: string, extra?: unknown) =>
      extra === undefined ? child.error(message) : child.error({ detail: extra }, message),
  };
}
