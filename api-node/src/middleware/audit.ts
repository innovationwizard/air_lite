import { FastifyRequest, FastifyReply } from 'fastify';
import { logger } from '../utils/logger';

export const auditMiddleware = async (
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> => {
  const startTime = Date.now();
  
  reply.raw.on('finish', () => {
    const duration = Date.now() - startTime;
    
    const auditLog = {
      traceId: request.id,
      method: request.method,
      url: request.url,
      statusCode: reply.statusCode,
      duration,
      ip: request.ip,
      userAgent: request.headers['user-agent'],
      userId: request.user?.id,
      username: request.user?.username,
    };
    
    if (reply.statusCode >= 400) {
      logger.error(auditLog, 'Request failed');
    } else {
      logger.info(auditLog, 'Request completed');
    }
  });
};