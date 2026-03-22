import { SignJWT, jwtVerify, JWTPayload } from 'jose';
import { config } from '../config';

export interface AccessTokenPayload extends JWTPayload {
  id: number;
  username: string;
  permissions: string[];
  roles: string[];
}

export interface RefreshTokenPayload extends JWTPayload {
  userId: number;
}

export const createAccessToken = async (payload: Omit<AccessTokenPayload, keyof JWTPayload>): Promise<string> => {
  const secret = new TextEncoder().encode(config.jwtSecret);
  
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(config.accessTokenExpiry)
    .sign(secret);
};

export const createRefreshToken = async (payload: Omit<RefreshTokenPayload, keyof JWTPayload>): Promise<string> => {
  const secret = new TextEncoder().encode(config.jwtRefreshSecret);
  
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(config.refreshTokenExpiry)
    .sign(secret);
};

export const verifyAccessToken = async (token: string): Promise<AccessTokenPayload> => {
  const secret = new TextEncoder().encode(config.jwtSecret);
  const { payload } = await jwtVerify(token, secret);
  return payload as unknown as AccessTokenPayload;
};

export const verifyRefreshToken = async (token: string): Promise<RefreshTokenPayload> => {
  const secret = new TextEncoder().encode(config.jwtRefreshSecret);
  const { payload } = await jwtVerify(token, secret);
  return payload as unknown as RefreshTokenPayload;
};