import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

interface Config {
  port: number;
  nodeEnv: string;
  databaseUrl: string;
  jwtSecret: string;
  jwtRefreshSecret: string;
  cookieSecret: string;
  allowedOrigins: string[];
  accessTokenExpiry: string;
  refreshTokenExpiry: string;
  redis: {
    enabled: boolean;
    host?: string;
    port?: number;
    password?: string;
    tls?: boolean;
  };
}

interface SecretPayload {
  password: string;
}

const getSecret = async (secretName: string): Promise<string> => {
  const client = new SecretsManagerClient({ region: process.env.AWS_REGION || 'us-east-2' });
  const command = new GetSecretValueCommand({ SecretId: secretName });
  const response = await client.send(command);
  
  if (response.SecretString) {
    const secret = JSON.parse(response.SecretString) as SecretPayload;
    return secret.password;
  }
  throw new Error(`Secret ${secretName} not found`);
};

const loadConfig = async (): Promise<Config> => {
  const nodeEnv = process.env.NODE_ENV || 'development';
  
  let databaseUrl = process.env.DATABASE_URL || '';
  
  // In production, fetch DB password from Secrets Manager
  if (nodeEnv === 'production' && process.env.DB_SECRET_NAME) {
    const password = await getSecret(process.env.DB_SECRET_NAME);
    const host = process.env.DB_HOST || '';
    const port = process.env.DB_PORT || '5432';
    const database = process.env.DB_NAME || 'airefill';
    const user = process.env.DB_USER || 'postgres';
    
    databaseUrl = `postgresql://${user}:${password}@${host}:${port}/${database}`;
  }
  
  return {
    port: parseInt(process.env.PORT || '8080', 10),
    nodeEnv,
    databaseUrl,
    jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-in-production',
    jwtRefreshSecret: process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret',
    cookieSecret: process.env.COOKIE_SECRET || 'dev-cookie-secret',
    allowedOrigins: [
      'https://airefill.app',
      'https://www.airefill.app',
      'https://mmfsptk3hw.us-east-2.awsapprunner.com',
      ...(nodeEnv === 'development' ? ['http://localhost:3000'] : [])
    ],
    accessTokenExpiry: '15m',
    refreshTokenExpiry: '7d',
    redis: {
      enabled: !!process.env.REDIS_HOST,
      host: process.env.REDIS_HOST,
      port: process.env.REDIS_PORT ? parseInt(process.env.REDIS_PORT, 10) : 6379,
      password: process.env.REDIS_AUTH_TOKEN || process.env.REDIS_PASSWORD,
      tls: process.env.REDIS_TLS === 'true',
    },
  };
};

export let config: Config;

export const initializeConfig = async () => {
  config = await loadConfig();
};