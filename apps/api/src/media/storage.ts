import fs from 'node:fs/promises';
import path from 'node:path';
import { env } from '../env.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger('media');

/**
 * Everything that writes a file goes through this one interface, so switching
 * from local disk to object storage is a single implementation swap and no
 * caller changes. Returns the public URL of the stored object.
 */
export interface Storage {
  put(key: string, body: Buffer, contentType: string): Promise<string>;
}

/**
 * Local disk. Fine for development and for a demo deploy on one box: no cloud
 * account needed to run the project. The trade-off is that images are served
 * by this API process rather than a CDN, which is exactly what the S3 adapter
 * below fixes.
 */
function localDisk(): Storage {
  const root = path.isAbsolute(env.UPLOAD_DIR)
    ? env.UPLOAD_DIR
    : path.join(env.apiRoot, env.UPLOAD_DIR);

  return {
    async put(key, body) {
      const target = path.join(root, key);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, body);
      return `${env.PUBLIC_API_URL}/uploads/${key}`;
    },
  };
}

/**
 * S3-compatible object storage (S3, R2, Spaces). The SDK is imported lazily
 * and is NOT a dependency of this project - install it only if you set
 * STORAGE=s3:
 *
 *   npm install @aws-sdk/client-s3 -w @pulse/api
 */
function s3(): Storage {
  // Non-literal specifier keeps TypeScript from requiring the package to be
  // installed for the rest of the project to typecheck.
  const sdk = '@aws-sdk/client-s3';
  const loaded = (async () => {
    const { S3Client, PutObjectCommand } = await import(sdk);
    return { client: new S3Client({ region: env.S3_REGION }), PutObjectCommand };
  })();

  return {
    async put(key, body, contentType) {
      const { client, PutObjectCommand } = await loaded;
      await client.send(
        new PutObjectCommand({
          Bucket: env.S3_BUCKET,
          Key: key,
          Body: body,
          ContentType: contentType,
          CacheControl: 'public, max-age=31536000, immutable',
        }),
      );
      // Served straight from the CDN in front of the bucket - never proxied
      // back through this API.
      return `${env.S3_PUBLIC_URL}/${key}`;
    },
  };
}

export const storage: Storage = env.STORAGE === 's3' ? s3() : localDisk();

log.info(`storage backend: ${env.STORAGE}`);
