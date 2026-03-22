import { FastifyRequest, FastifyReply } from 'fastify';
import { verifyAccessToken } from '../utils/jwt';
import { unauthorizedResponse, forbiddenResponse } from '../utils/responses';

export interface AuthenticatedUser {
  id: number;
  username: string;
  permissions: string[];
  roles: string[];
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthenticatedUser;
  }
}

export const authenticate = async (
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> => {
  try {
    // Try to get token from cookie first
    let token = request.cookies.access_token;
    
    // Fallback to Authorization header
    if (!token) {
      const authHeader = request.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7);
      }
    }
    
    if (!token) {
      return unauthorizedResponse(reply, 'No authentication token provided');
    }
    
    const payload = await verifyAccessToken(token);
    request.user = payload;
  } catch {
    return unauthorizedResponse(reply, 'Invalid or expired token');
  }
};

export const requirePermissions = (...requiredPermissions: string[]) => {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!request.user) {
      return unauthorizedResponse(reply, 'Authentication required');
    }
    
    const hasPermission = requiredPermissions.some(perm =>
      request.user!.permissions.includes(perm)
    );
    
    if (!hasPermission) {
      return forbiddenResponse(
        reply,
        `Required permissions: ${requiredPermissions.join(' or ')}`
      );
    }
  };
};