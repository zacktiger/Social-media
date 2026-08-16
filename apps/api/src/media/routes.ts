import crypto from 'node:crypto';
import { Router } from 'express';
import multer from 'multer';
import sharp from 'sharp';
import { requireAuth } from '../auth/middleware.js';
import { badRequest } from '../lib/http-error.js';
import { limitUpload } from '../middleware/rate-limit.js';
import { storage } from './storage.js';

export const mediaRouter = Router();

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']);

/**
 * Files are buffered in memory, not written to a temp directory: they are
 * resized and pushed to storage immediately, so the disk round trip would be
 * pure overhead. The 5 MB cap is what keeps that safe.
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
});

/**
 * Three renditions per upload:
 *   thumb    200x200 square, for avatars and dense lists
 *   feed     600px wide, what the timeline actually renders
 *   original capped at 1600px, what you get when you open the image
 *
 * All re-encoded to WebP, which typically lands 25-35% smaller than the JPEG
 * that came in, and strips EXIF (including GPS) as a side effect.
 */
const RENDITIONS = [
  { name: 'thumb', width: 200, height: 200, quality: 80 },
  { name: 'feed', width: 600, height: null, quality: 82 },
  { name: 'original', width: 1600, height: null, quality: 85 },
] as const;

mediaRouter.post('/upload', requireAuth, limitUpload, upload.single('file'), async (req, res) => {
  if (!req.file) throw badRequest('No file uploaded', 'no_file');
  if (!ALLOWED.has(req.file.mimetype)) {
    throw badRequest(`Unsupported image type: ${req.file.mimetype}`, 'bad_mime');
  }

  // Never trust the declared mimetype - read the actual header.
  const image = sharp(req.file.buffer, { failOn: 'error' });
  const metadata = await image.metadata().catch(() => null);
  if (!metadata?.width || !metadata.height) throw badRequest('Not a readable image', 'bad_image');

  const id = `${req.userId}/${crypto.randomUUID()}`;

  const urls = await Promise.all(
    RENDITIONS.map(async (rendition) => {
      const buffer = await sharp(req.file!.buffer)
        .rotate() // honour EXIF orientation before it gets stripped
        .resize(rendition.width, rendition.height, {
          fit: rendition.height ? 'cover' : 'inside',
          withoutEnlargement: true,
        })
        .webp({ quality: rendition.quality })
        .toBuffer();

      const url = await storage.put(`${id}/${rendition.name}.webp`, buffer, 'image/webp');
      return [rendition.name, url] as const;
    }),
  );

  res.status(201).json({
    media: Object.fromEntries(urls) as Record<'thumb' | 'feed' | 'original', string>,
    width: metadata.width,
    height: metadata.height,
  });
});
