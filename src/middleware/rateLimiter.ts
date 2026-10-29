import { Request, Response, NextFunction } from 'express';

interface TokenBucket {
  tokens: number;
  lastRefill: number; // Unix timestamp in milliseconds
}

export interface RateLimiterOptions {
  capacity?: number;           // Maximum burst token capacity (default: 5)
  refillIntervalMs?: number;   // Full refill window duration in ms (default: 60,000ms = 60s)
  cleanupIntervalMs?: number;  // Interval to prune stale client buckets (default: 300,000ms = 5m)
}

/**
 * In-Memory Token Bucket Rate Limiting Middleware.
 * 
 * Algorithm Mechanics:
 * - Each client IP is assigned a bucket containing up to `capacity` tokens.
 * - Tokens replenish continuously at a rate of `capacity / refillIntervalMs` tokens per millisecond.
 * - Each incoming request attempts to consume exactly 1 token.
 * - If tokens >= 1, the request proceeds, decrementing 1 token.
 * - If tokens < 1, the request is rejected with HTTP 429 Too Many Requests and a `Retry-After` header.
 * 
 * RFC Compliance:
 * - RFC 6585: Section 4 - HTTP 429 Too Many Requests
 * - RFC 7231: Section 7.1.3 - Retry-After header representation (seconds)
 * - Headers exposed: X-RateLimit-Limit, X-RateLimit-Remaining, Retry-After
 * 
 * =======================================================================================
 * DISTRIBUTED REDIS MIGRATION PATH:
 * =======================================================================================
 * While this in-memory implementation provides zero-overhead protection for single-node
 * deployments, horizontal scaling across multiple container instances (e.g., AWS ECS,
 * Kubernetes, or Vercel Serverless) introduces state partitioning:
 * - In-memory maps do not share state across process boundaries. A client can bypass limits
 *   by round-robining requests across different instances.
 * 
 * To migrate this to a distributed Redis architecture:
 * 1. Replace the `Map<string, TokenBucket>` with a Redis hash or Redis string key per client:
 *    Key format: `ratelimit:inquiry:{clientIp}`
 * 2. Execute the token consumption atomically using an EVALSHA Redis Lua script to prevent
 *    race conditions (TOCTOU: Time-Of-Check to Time-Of-Use):
 * 
 *    ```lua
 *    local key = KEYS[1]
 *    local capacity = tonumber(ARGV[1])
 *    local refill_rate = tonumber(ARGV[2]) -- tokens per millisecond
 *    local now = tonumber(ARGV[3])
 *    local requested = 1
 * 
 *    local current = redis.call('HMGET', key, 'tokens', 'last_refill')
 *    local tokens = tonumber(current[1]) or capacity
 *    local last_refill = tonumber(current[2]) or now
 * 
 *    local delta = math.max(0, now - last_refill)
 *    tokens = math.min(capacity, tokens + (delta * refill_rate))
 * 
 *    if tokens >= requested then
 *      tokens = tokens - requested
 *      redis.call('HMSET', key, 'tokens', tokens, 'last_refill', now)
 *      redis.call('PEXPIRE', key, 60000) -- TTL to auto-prune idle buckets
 *      return {1, math.floor(tokens), 0} -- {allowed, remaining, retry_after}
 *    else
 *      local retry_after = math.ceil((requested - tokens) / (refill_rate * 1000))
 *      return {0, 0, retry_after}
 *    end
 *    ```
 * 3. Use an existing Redis client connection pool (e.g., `ioredis`) with fail-open or
 *    fail-closed circuit breakers depending on threat posture.
 * =======================================================================================
 */
export function createTokenBucketRateLimiter(options: RateLimiterOptions = {}) {
  const capacity = options.capacity ?? 5;
  const refillIntervalMs = options.refillIntervalMs ?? 60_000;
  const cleanupIntervalMs = options.cleanupIntervalMs ?? 300_000;
  const refillRatePerMs = capacity / refillIntervalMs;

  const buckets = new Map<string, TokenBucket>();

  // Periodic garbage collection to prevent memory leaks from transient IP allocations
  const gcTimer = setInterval(() => {
    const now = Date.now();
    for (const [ip, bucket] of buckets.entries()) {
      if (now - bucket.lastRefill > refillIntervalMs * 2) {
        buckets.delete(ip);
      }
    }
  }, cleanupIntervalMs);

  // Allow the Node.js event loop to exit even if this interval timer is active
  if (gcTimer.unref) {
    gcTimer.unref();
  }

  return function rateLimiter(req: Request, res: Response, next: NextFunction): void {
    // Resolve client identifier (supporting reverse proxies and load balancers)
    const forwardedHeader = req.headers['x-forwarded-for'];
    const clientIp = (
      typeof forwardedHeader === 'string'
        ? forwardedHeader.split(',')[0]?.trim()
        : req.socket.remoteAddress
    ) || req.ip || '127.0.0.1';

    const now = Date.now();
    let bucket = buckets.get(clientIp);

    if (!bucket) {
      bucket = {
        tokens: capacity,
        lastRefill: now,
      };
      buckets.set(clientIp, bucket);
    } else {
      // Calculate token replenishment since last observation
      const elapsedMs = Math.max(0, now - bucket.lastRefill);
      const replenishedTokens = elapsedMs * refillRatePerMs;
      bucket.tokens = Math.min(capacity, bucket.tokens + replenishedTokens);
      bucket.lastRefill = now;
    }

    // Set standard rate limiting telemetry headers
    res.setHeader('X-RateLimit-Limit', capacity.toString());

    if (bucket.tokens >= 1) {
      // Consume token
      bucket.tokens -= 1;
      const remaining = Math.max(0, Math.floor(bucket.tokens));
      res.setHeader('X-RateLimit-Remaining', remaining.toString());
      next();
    } else {
      // Compute retry delay in seconds
      const deficit = 1 - bucket.tokens;
      const retryAfterSeconds = Math.max(1, Math.ceil(deficit / (refillRatePerMs * 1000)));

      res.setHeader('X-RateLimit-Remaining', '0');
      res.setHeader('Retry-After', retryAfterSeconds.toString());

      res.status(429).json({
        type: 'https://tools.ietf.org/html/rfc6585#section-4',
        title: 'Too Many Requests',
        status: 429,
        detail: `Rate limit of ${capacity} requests per ${refillIntervalMs / 1000} seconds exceeded. Try again in ${retryAfterSeconds} seconds.`,
        instance: req.originalUrl || req.url,
        retryAfter: retryAfterSeconds,
      });
    }
  };
}

export const rateLimiter = createTokenBucketRateLimiter();
