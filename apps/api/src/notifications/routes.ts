import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware.js';
import { notFound } from '../lib/http-error.js';
import { prisma } from '../lib/prisma.js';
import { toNotificationDto } from '../lib/serialize.js';

export const notificationsRouter = Router();

const listSchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

notificationsRouter.get('/', requireAuth, async (req, res) => {
  const { cursor, limit } = listSchema.parse(req.query);

  const rows = await prisma.notification.findMany({
    where: { userId: req.userId!, ...(cursor ? { createdAt: { lt: new Date(cursor) } } : {}) },
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: { actor: true },
  });

  const last = rows[rows.length - 1];
  res.json({
    notifications: rows.map(toNotificationDto),
    nextCursor: rows.length === limit && last ? last.createdAt.toISOString() : null,
  });
});

notificationsRouter.get('/unread-count', requireAuth, async (req, res) => {
  const count = await prisma.notification.count({ where: { userId: req.userId!, read: false } });
  res.json({ count });
});

notificationsRouter.patch<{ id: string }>('/:id/read', requireAuth, async (req, res) => {
  // updateMany scopes the write to the owner, so one user cannot mark
  // another user's notification as read by guessing an id.
  const updated = await prisma.notification.updateMany({
    where: { id: req.params.id, userId: req.userId! },
    data: { read: true },
  });
  if (updated.count === 0) throw notFound('Notification not found');
  res.json({ read: true });
});

notificationsRouter.post('/read-all', requireAuth, async (req, res) => {
  const updated = await prisma.notification.updateMany({
    where: { userId: req.userId!, read: false },
    data: { read: true },
  });
  res.json({ read: updated.count });
});
