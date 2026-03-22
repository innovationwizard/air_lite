import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { config, initializeConfig } from './config';
import { logger } from './utils/logger';
import { prisma } from './db/client';
import { authRoutes } from './routes/auth';
import { adminRoutes } from './routes/admin';
import { comprasRoutes } from './routes/compras';
import { finanzasRoutes } from './routes/finanzas';
import { productsRoutes } from './routes/products';
import { inventarioRoutes } from './routes/inventario';
import { ventasRoutes } from './routes/ventas';
import { gerenciaRoutes } from './routes/gerencia';
import { superuserRoutes } from './routes/superuser';
import { biRoutes } from './routes/bi/index';
import { errorHandler } from './middleware/errorHandler';
import { auditMiddleware } from './middleware/audit';

// Start server
const start = async () => {
  try {
    // Initialize config first (loads secrets in production)
    await initializeConfig();
    
    // Now create Fastify app with config
    const app = Fastify({
      logger: logger,
      requestIdLogLabel: 'traceId',
      requestIdHeader: 'x-trace-id',
      genReqId: () => crypto.randomUUID(),
    });

    // Decorate with Prisma
    app.decorate('prisma', prisma);

    // Register plugins
    await app.register(cookie, {
      secret: config.cookieSecret,
      parseOptions: {},
    });

    await app.register(cors, {
      origin: [
        'https://www.airefill.app',
        'https://airefill.app',
        'http://localhost:3000',
        'http://localhost:5173'
      ],
      credentials: true
    });

    // Global rate limit — individual routes may declare stricter limits via config.rateLimit
    await app.register(rateLimit, {
      global: true,
      max: 200,
      timeWindow: '1 minute',
      keyGenerator: (request: { ip: string }) => request.ip,
    });

    // Global middleware
    app.addHook('onRequest', auditMiddleware);

    // Health check (legacy)
    app.get('/health', () => {
      return { status: 'healthy', timestamp: new Date().toISOString() };
    });

    // Health check endpoint
    app.get('/api/v1/health', () => {
      return { status: 'healthy', timestamp: new Date().toISOString(), service: 'airefill-api' };
    });

    // Register API routes with consistent /api/v1/* prefix
    await app.register(authRoutes, { prefix: '/api/v1/auth' });
    await app.register(adminRoutes, { prefix: '/api/v1/admin' });
    await app.register(comprasRoutes, { prefix: '/api/v1/compras' });
    await app.register(finanzasRoutes, { prefix: '/api/v1/finanzas' });
    await app.register(productsRoutes, { prefix: '/api/v1/products' });
    await app.register(inventarioRoutes, { prefix: '/api/v1/inventario' });
    await app.register(ventasRoutes, { prefix: '/api/v1/ventas' });
    await app.register(gerenciaRoutes, { prefix: '/api/v1/gerencia' });
    await app.register(superuserRoutes, { prefix: '/api/v1/superuser' });
    await app.register(biRoutes, { prefix: '/api/v1/bi' });

    // Error handler
    app.setErrorHandler(errorHandler);
    
    await app.listen({ 
      port: config.port, 
      host: '0.0.0.0' 
    });
    logger.info(`Server listening on port ${config.port}`);
  } catch (err) {
    logger.error(err);
    process.exit(1);
  }
};

void start();
