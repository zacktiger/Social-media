import { PrismaClient } from '@prisma/client';
import { env } from '../env.js';

export const prisma = new PrismaClient({
  log: env.isProd ? ['warn', 'error'] : ['warn', 'error'],
});

export async function disconnectPrisma() {
  await prisma.$disconnect();
}
