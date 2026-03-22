import Redis from 'ioredis';
import { config } from '../../../config';

type CacheStats = {
  connected: boolean;
  memory?: string;
  keys?: number;
};

export class CacheService {
  private static redis: InstanceType<typeof Redis> | undefined;
  private static isInitialized = false;

  static initialize(): void {
    if (this.isInitialized) return;
    
    if (config?.redis?.enabled) {
      try {
        this.redis = new Redis({
          host: config.redis.host,
          port: config.redis.port,
          password: config.redis.password,
          maxRetriesPerRequest: 3,
          lazyConnect: true,
          connectTimeout: 5000,
          commandTimeout: 5000,
          ...(config.redis.tls ? { tls: {} } : {}),
          retryStrategy: (times: number) => Math.min(times * 100, 2000) // ms backoff, cap at 2s
        });

        this.redis.on('connect', () => {
          console.log('[CACHE SERVICE] Connected to Redis');
        });

        this.redis.on('error', (error) => {
          console.error('[CACHE SERVICE] Redis error:', this.formatError(error));
        });

        this.isInitialized = true;
        console.log('[CACHE SERVICE] Initialized successfully');
      } catch (error) {
      console.error('[CACHE SERVICE] Failed to initialize Redis:', this.formatError(error));
        this.redis = undefined;
      }
    } else {
      console.log('[CACHE SERVICE] Redis disabled in config');
    }
  }

  static async get<T>(key: string): Promise<T | null> {
    if (!this.redis) {
      console.log(`[CACHE SERVICE] Redis not available, skipping get for key: ${key}`);
      return null;
    }

    try {
      console.log(`[CACHE SERVICE] Getting key: ${key}`);
      const cached = await this.redis.get(key);
      
      if (cached) {
        console.log(`[CACHE SERVICE] Cache hit for key: ${key}`);
        return JSON.parse(cached) as T;
      } else {
        console.log(`[CACHE SERVICE] Cache miss for key: ${key}`);
        return null;
      }
    } catch (error) {
      console.error(`[CACHE SERVICE] Error getting key ${key}:`, this.formatError(error));
      return null;
    }
  }

  static async set<T>(key: string, data: T, ttl: number = 300): Promise<boolean> {
    if (!this.redis) {
      console.log(`[CACHE SERVICE] Redis not available, skipping set for key: ${key}`);
      return false;
    }

    try {
      console.log(`[CACHE SERVICE] Setting key: ${key} with TTL: ${ttl}s`);
      await this.redis.setex(key, ttl, JSON.stringify(data));
      console.log(`[CACHE SERVICE] Successfully cached key: ${key}`);
      return true;
    } catch (error) {
      console.error(`[CACHE SERVICE] Error setting key ${key}:`, this.formatError(error));
      return false;
    }
  }

  static async del(key: string): Promise<boolean> {
    if (!this.redis) {
      console.log(`[CACHE SERVICE] Redis not available, skipping delete for key: ${key}`);
      return false;
    }

    try {
      console.log(`[CACHE SERVICE] Deleting key: ${key}`);
      const result = await this.redis.del(key);
      console.log(`[CACHE SERVICE] Deleted key: ${key}, result: ${result}`);
      return result > 0;
    } catch (error) {
      console.error(`[CACHE SERVICE] Error deleting key ${key}:`, this.formatError(error));
      return false;
    }
  }

  static async exists(key: string): Promise<boolean> {
    if (!this.redis) {
      return false;
    }

    try {
      const result = await this.redis.exists(key);
      return result === 1;
    } catch (error) {
      console.error(`[CACHE SERVICE] Error checking existence of key ${key}:`, this.formatError(error));
      return false;
    }
  }

  static async flush(): Promise<boolean> {
    if (!this.redis) {
      console.log(`[CACHE SERVICE] Redis not available, skipping flush`);
      return false;
    }

    try {
      console.log(`[CACHE SERVICE] Flushing all cache`);
      await this.redis.flushall();
      console.log(`[CACHE SERVICE] Cache flushed successfully`);
      return true;
    } catch (error) {
      console.error(`[CACHE SERVICE] Error flushing cache:`, this.formatError(error));
      return false;
    }
  }

  static async getStats(): Promise<CacheStats> {
    if (!this.redis) {
      return { connected: false };
    }

    try {
      const info = await this.redis.info('memory');
      const keys = await this.redis.dbsize();
      
      return {
        connected: true,
        memory: info,
        keys
      };
    } catch (error) {
      console.error(`[CACHE SERVICE] Error getting stats:`, this.formatError(error));
      return { connected: false };
    }
  }

  static generateKey(prefix: string, ...parts: (string | number)[]): string {
    return `${prefix}:${parts.join(':')}`;
  }

  static isAvailable(): boolean {
    return this.redis !== undefined;
  }

  static async close(): Promise<void> {
    if (this.redis) {
      await this.redis.quit();
      this.redis = undefined;
      this.isInitialized = false;
      console.log('[CACHE SERVICE] Closed Redis connection');
    }
  }

  private static formatError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
