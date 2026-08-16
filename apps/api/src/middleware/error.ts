import { Prisma } from '@prisma/client';
import type { NextFunction, Request, Response } from 'express';
import { MulterError } from 'multer';
import { ZodError } from 'zod';
import { env } from '../env.js';
import { createLogger } from '../lib/logger.js';
import { HttpError } from '../lib/http-error.js';

const log = createLogger('http');

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({
    error: { code: 'route_not_found', message: `No route for ${req.method} ${req.path}` },
  });
}

/**
 * Single exit point for every failure. Express 5 forwards rejected promises
 * from async handlers here automatically, which is why no route in this
 * codebase wraps itself in try/catch just to call next(err).
 */
export function errorHandler(err: unknown, req: Request, res: Response, next: NextFunction) {
  if (res.headersSent) return next(err);

  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message } });
  }

  if (err instanceof ZodError) {
    return res.status(422).json({
      error: {
        code: 'validation_failed',
        message: 'Some fields are invalid',
        fields: err.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      },
    });
  }

  if (err instanceof MulterError) {
    const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    return res.status(status).json({
      error: {
        code: err.code === 'LIMIT_FILE_SIZE' ? 'file_too_large' : 'upload_failed',
        message: err.code === 'LIMIT_FILE_SIZE' ? 'That image is larger than 5 MB' : err.message,
      },
    });
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2025') {
      return res.status(404).json({ error: { code: 'not_found', message: 'Not found' } });
    }
    if (err.code === 'P2002') {
      return res.status(409).json({ error: { code: 'conflict', message: 'Already exists' } });
    }
  }

  // Anything reaching this point is a bug, so it gets logged in full and
  // reported without internals. The request id ties the response the user saw
  // to the stack trace in the logs.
  const requestId = (req as Request & { id?: string }).id;
  log.error('unhandled error', { requestId, err });

  res.status(500).json({
    error: {
      code: 'internal_error',
      message: env.isProd ? 'Something went wrong' : String(err),
      requestId,
    },
  });
}
