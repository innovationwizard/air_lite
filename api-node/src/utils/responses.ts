import { FastifyReply } from 'fastify';

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: string;
    fieldErrors?: Array<{ field: string; message: string }>;
  };
  traceId?: string;
}

export const successResponse = <T>(
  reply: FastifyReply,
  data: T,
  statusCode: number = 200
): void => {
  reply.status(statusCode).send({
    success: true,
    data,
    traceId: reply.request.id,
  } as ApiResponse<T>);
};

export const errorResponse = (
  reply: FastifyReply,
  code: string,
  message: string,
  statusCode: number = 500,
  details?: string
): void => {
  reply.status(statusCode).send({
    success: false,
    error: {
      code,
      message,
      details,
    },
    traceId: reply.request.id,
  } as ApiResponse);
};

export const validationErrorResponse = (
  reply: FastifyReply,
  message: string,
  fieldErrors?: Array<{ field: string; message: string }>
): void => {
  reply.status(422).send({
    success: false,
    error: {
      code: 'VALIDATION_ERROR',
      message,
      fieldErrors,
    },
    traceId: reply.request.id,
  } as ApiResponse);
};

export const unauthorizedResponse = (
  reply: FastifyReply,
  message: string = 'Unauthorized'
): void => {
  reply.status(401).send({
    success: false,
    error: {
      code: 'UNAUTHORIZED',
      message,
    },
    traceId: reply.request.id,
  } as ApiResponse);
};

export const forbiddenResponse = (
  reply: FastifyReply,
  message: string = 'Forbidden'
): void => {
  reply.status(403).send({
    success: false,
    error: {
      code: 'FORBIDDEN',
      message,
    },
    traceId: reply.request.id,
  } as ApiResponse);
};
// Helper function to handle Error objects
export const errorResponseFromError = (
  reply: FastifyReply,
  error: Error,
  statusCode: number = 500
): void => {
  errorResponse(
    reply,
    'INTERNAL_ERROR',
    error.message || 'An error occurred',
    statusCode,
    process.env.NODE_ENV === 'development' ? error.stack : undefined
  );
};
