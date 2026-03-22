import { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { logger } from '../utils/logger';
import { errorResponse, validationErrorResponse } from '../utils/responses';

export const errorHandler = (
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply
): void => {
  logger.error({
    err: error,
    traceId: request.id,
    url: request.url,
    method: request.method,
  }, 'Request error');
  
  // Handle Zod validation errors
  if (error instanceof ZodError) {
    const fieldErrors = error.errors.map(err => ({
      field: err.path.join('.'),
      message: err.message,
    }));
    
    return validationErrorResponse(
      reply,
      'Validation failed',
      fieldErrors
    );
  }
  
  // Handle Prisma errors
  if (error.name === 'PrismaClientKnownRequestError') {
    return errorResponse(
      reply,
      'DATABASE_ERROR',
      'A database error occurred',
      500,
      error.message
    );
  }
  
  // Handle Fastify validation errors
  if (error.validation) {
    return validationErrorResponse(
      reply,
      error.message,
      error.validation.map(v => ({
        field: (() => {
          const candidate = v.params?.missingProperty ?? v.instancePath ?? 'unknown';
          return typeof candidate === 'string' ? candidate : JSON.stringify(candidate);
        })(),
        message: v.message || 'Validation failed',
      }))
    );
  }
  
  // Default error response
  const statusCode = error.statusCode || 500;
  const code = statusCode === 500 ? 'INTERNAL_SERVER_ERROR' : 'ERROR';
  
  errorResponse(
    reply,
    code,
    error.message || 'An unexpected error occurred',
    statusCode
  );
};