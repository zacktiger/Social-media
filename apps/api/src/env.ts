import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

// Resolve .env relative to the app, not the shell's cwd, so `npm run dev:api`
// from the repo root works the same as running inside apps/api.
const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(apiRoot, '.env') });

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'silent']).default('info'),

  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),

  JWT_ACCESS_SECRET: z.string().min(16, 'JWT_ACCESS_SECRET must be at least 16 chars'),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),

  WEB_ORIGIN: z.string().url().default('http://localhost:3000'),

  // Run the fan-out worker inside the API process (one terminal in dev).
  INLINE_WORKER: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),

  // --- media -------------------------------------------------------------
  STORAGE: z.enum(['local', 's3']).default('local'),
  UPLOAD_DIR: z.string().default('uploads'),
  /** Base URL this API is reachable at; used to build local media URLs. */
  PUBLIC_API_URL: z.string().url().default('http://localhost:4000'),
  S3_BUCKET: z.string().default(''),
  S3_REGION: z.string().default('us-east-1'),
  S3_PUBLIC_URL: z.string().default(''),

  /**
   * Scales every rate limit budget. Exists because a load test drives
   * thousands of requests from a single IP and would otherwise be measuring
   * the rate limiter instead of the feed. Leave at 1 outside benchmarks.
   */
  RATE_LIMIT_MULTIPLIER: z.coerce.number().positive().default(1),

  FANOUT_THRESHOLD: z.coerce.number().int().positive().default(5000),
  FEED_MAX_LENGTH: z.coerce.number().int().positive().default(800),
  FANOUT_BATCH_SIZE: z.coerce.number().int().positive().default(500),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment configuration:');
  for (const issue of parsed.error.issues) {
    console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
  }
  console.error('\nDid you copy apps/api/.env.example to apps/api/.env ?');
  process.exit(1);
}

export const env = {
  ...parsed.data,
  apiRoot,
  isProd: parsed.data.NODE_ENV === 'production',
};
