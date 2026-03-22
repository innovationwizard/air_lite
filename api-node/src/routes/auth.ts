import { FastifyRequest, FastifyReply } from 'fastify';
import type { AppWithPrisma } from '../types/app';
import { z } from 'zod';
import { verifyPassword } from '../utils/password';
import { createAccessToken, createRefreshToken, verifyRefreshToken, verifyAccessToken } from '../utils/jwt';
import { nanoid } from 'nanoid';
import {
  successResponse,
  unauthorizedResponse,
  validationErrorResponse,
  errorResponse,
} from '../utils/responses';

const loginSchema = z.object({
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
});

export const authRoutes = async (app: AppWithPrisma): Promise<void> => {
  // POST /v1/auth/login — tight rate limit: 10 attempts per 15 min per IP
  app.post('/login', {
    config: {
      rateLimit: {
        max: 10,
        timeWindow: '15 minutes',
        errorResponseBuilder: () => ({
          statusCode: 429,
          error: 'Too Many Requests',
          message: 'Too many login attempts. Please try again in 15 minutes.',
        }),
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const parsed = loginSchema.safeParse(request.body);
      
      if (!parsed.success) {
        const fieldErrors = parsed.error.errors.map(err => ({
          field: err.path[0] as string,
          message: err.message,
        }));
        return validationErrorResponse(reply, 'Validation failed', fieldErrors);
      }
      
      const { username, password } = parsed.data;
      
      // Query user with roles and permissions
      const user = await app.prisma.user.findFirst({
        where: {
          username,
          isDeleted: false,
        },
        include: {
          userRoles: {
            include: {
              role: {
                include: {
                  rolePermissions: {
                    include: {
                      permission: true,
                    },
                  },
                },
              },
            },
          },
          apiKeys: {
            where: { 
              revoked: false,
            },
            orderBy: { createdAt: 'desc' },
            take: 1
          }
        },
      });
      
      if (!user) {
        return unauthorizedResponse(reply, 'Invalid username or password');
      }
      
      if (!user.isActive) {
        return unauthorizedResponse(reply, 'Account is inactive. Please contact administrator.');
      }
      
      // Verify password
      const isValidPassword = await verifyPassword(password, user.passwordHash);
      if (!isValidPassword) {
        return unauthorizedResponse(reply, 'Invalid username or password');
      }
      
      // Extract roles and permissions
      const roles = user.userRoles.map((ur) => ur.role.roleName);
      const permissionsSet = new Set<string>();
      
      user.userRoles.forEach((ur) => {
        ur.role.rolePermissions.forEach((rp) => {
          permissionsSet.add(rp.permission.permissionName);
        });
      });
      
      const permissions = Array.from(permissionsSet);
      
      // Generate tokens
      const accessToken = await createAccessToken({
        id: user.id,
        username: user.username,
        permissions,
        roles,
      });

      const refreshToken = await createRefreshToken({
        userId: user.id,
      });
      
      const apiKeyEntry = user.apiKeys[0];
      const apiKey = apiKeyEntry?.apiKey ?? `ak_${nanoid(32)}`;

      if (!apiKeyEntry) {
        await app.prisma.apiKey.create({
          data: {
            userId: user.id,
            apiKey,
            revoked: false,
          },
        });
      }
      
      // Set httpOnly cookies
      reply
        .setCookie('access_token', accessToken, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'strict',
          path: '/',
          maxAge: 900, // 15 minutes
        })
        .setCookie('refresh_token', refreshToken, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'strict',
          path: '/',
          maxAge: 604800, // 7 days
        })
        .setCookie('api_key', apiKey, {
          httpOnly: false, // JS needs to read this
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'strict',
          path: '/',
          maxAge: 604800, // 7 days
        });
      
      // Return user profile
      return successResponse(reply, {
        accessToken,        
        refreshToken,       
        apiKey,            
        tokenType: 'Bearer',
        expiresIn: 900,
        user: {
          userId: user.id,
          username: user.username,
          email: user.email,
          isActive: user.isActive,
          roles,
          permissions,
          createdAt: user.createdAt?.toISOString() ?? new Date(0).toISOString(),
        },
      });
    } catch (error) {
      return errorResponse(reply, "INTERNAL_ERROR", (error as Error).message || "An error occurred", 500);
    }
  });
  
  // POST /v1/auth/logout
  app.post('/logout', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Clear cookies
      reply
        .clearCookie('access_token', { path: '/' })
        .clearCookie('refresh_token', { path: '/' })
        .clearCookie('api_key', { path: '/' });
      
      return successResponse(reply, { message: 'Logged out successfully' });
    } catch (error) {
      return errorResponse(reply, "INTERNAL_ERROR", (error as Error).message || "An error occurred", 500);
    }
  });
  
  // GET /v1/auth/verify
  app.get('/verify', async (request: FastifyRequest, reply: FastifyReply) => {
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
      
      // Verify token (this will throw if invalid)
      await verifyAccessToken(token);
      
      return successResponse(reply, { valid: true });
    } catch {
      return unauthorizedResponse(reply, 'Invalid or expired token');
    }
  });
  
  // POST /v1/auth/refresh
  app.post('/refresh', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const refreshToken = request.cookies.refresh_token || 
                           (request.headers.authorization?.replace('Bearer ', ''));
      
      if (!refreshToken) {
        return unauthorizedResponse(reply, 'No refresh token provided');
      }
      
      const payload = await verifyRefreshToken(refreshToken);
      
      // Fetch user with roles and permissions
      const user = await app.prisma.user.findFirst({
        where: {
          id: payload.userId,
          isDeleted: false,
          isActive: true,
        },
        include: {
          userRoles: {
            include: {
              role: {
                include: {
                  rolePermissions: {
                    include: {
                      permission: true,
                    },
                  },
                },
              },
            },
          },
          apiKeys: {
            where: { revoked: false },
            orderBy: { createdAt: 'desc' },
            take: 1
          }
        }
      });
      
      if (!user) {
        return unauthorizedResponse(reply, 'Invalid refresh token');
      }
      
      // Extract roles and permissions
      const roles = user.userRoles.map((ur) => ur.role.roleName);
      const permissionsSet = new Set<string>();
      
      user.userRoles.forEach((ur) => {
        ur.role.rolePermissions.forEach((rp) => {
          permissionsSet.add(rp.permission.permissionName);
        });
      });
      
      const permissions = Array.from(permissionsSet);
      
      // Rotate both tokens — new access token + new refresh token
      const newAccessToken = await createAccessToken({
        id: user.id,
        username: user.username,
        permissions,
        roles,
      });

      const newRefreshToken = await createRefreshToken({
        userId: user.id,
      });

      reply
        .setCookie('access_token', newAccessToken, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'strict',
          path: '/',
          maxAge: 900,
        })
        .setCookie('refresh_token', newRefreshToken, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'strict',
          path: '/',
          maxAge: 604800,
        });

      return successResponse(reply, {
        accessToken: newAccessToken,
        tokenType: 'Bearer',
        expiresIn: 900,
      });
    } catch {
      return unauthorizedResponse(reply, 'Invalid or expired refresh token');
    }
  });
};