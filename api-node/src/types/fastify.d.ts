import { PrismaClient } from '@prisma/client';

// Fastify declaration merging — extends FastifyInstance with the prisma plugin.
// FastifyRequest.user is augmented in src/middleware/auth.ts (AuthenticatedUser).
declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient;
  }
}
