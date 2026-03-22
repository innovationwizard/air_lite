import { RateLimitEntry } from '../types';

interface RateLimitStatus {
  count: number;
  limit: number;
  resetAt: number;
}

export class RateLimiterService {
  private static rateLimiter = new Map<string, RateLimitEntry>();
  private static cleanupInterval: NodeJS.Timeout | null = null;

  static {
    // Clean up old entries every minute to prevent memory leak
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [key, value] of this.rateLimiter.entries()) {
        if (value.resetAt < now) {
          this.rateLimiter.delete(key);
        }
      }
    }, 60000);
  }

  static checkRateLimit(userId: number, limit: number = 100, windowMs: number = 60000): boolean {
    const key = `rate:${userId}`;
    const now = Date.now();
    
    console.log(`[RATE LIMITER] Checking rate limit for user ${userId}`);
    
    const current = this.rateLimiter.get(key);
    
    if (!current || current.resetAt < now) {
      this.rateLimiter.set(key, { count: 1, resetAt: now + windowMs });
      console.log(`[RATE LIMITER] New rate limit window for user ${userId}`);
      return true;
    }
    
    if (current.count >= limit) {
      console.warn(`[RATE LIMITER] Rate limit exceeded for user ${userId}: ${current.count}/${limit}`);
      throw new Error('Rate limit exceeded');
    }
    
    current.count++;
    console.log(`[RATE LIMITER] User ${userId} request count: ${current.count}/${limit}`);
    return true;
  }

  static getRateLimitStatus(userId: number): RateLimitStatus | null {
    const key = `rate:${userId}`;
    const current = this.rateLimiter.get(key);
    
    if (!current) return null;
    
    return {
      count: current.count,
      limit: 100, // Default limit
      resetAt: current.resetAt
    };
  }

  static resetRateLimit(userId: number): void {
    const key = `rate:${userId}`;
    this.rateLimiter.delete(key);
    console.log(`[RATE LIMITER] Reset rate limit for user ${userId}`);
  }

  static getActiveUsers(): string[] {
    return Array.from(this.rateLimiter.keys());
  }

  static getTotalActiveRequests(): number {
    return Array.from(this.rateLimiter.values()).reduce((sum, entry) => sum + entry.count, 0);
  }

  static cleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.rateLimiter.clear();
    console.log('[RATE LIMITER] Cleaned up rate limiter service');
  }
}
