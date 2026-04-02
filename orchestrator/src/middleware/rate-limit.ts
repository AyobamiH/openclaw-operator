import rateLimit from 'express-rate-limit';
import { Request, Response, NextFunction } from 'express';
import type { AuthenticatedRequest } from './auth.js';

/**
 * Rate Limiting Configuration
 * Prevents DoS attacks and protects resource limits
 */

const ONE_MINUTE_MS = 60 * 1000;
const IS_TEST_ENV = process.env.NODE_ENV === 'test';
type RateLimitedRequest = Request & {
  rateLimit?: {
    resetTime?: Date;
  };
};

function scaleRateLimit(limit: number): number {
  if (!IS_TEST_ENV) return limit;
  return Math.max(limit, limit * 20);
}

function appendRetryAfterHeader(req: Request, res: Response, defaultWindowMs: number) {
  const rateLimitedReq = req as RateLimitedRequest;
  const resetTime = rateLimitedReq.rateLimit?.resetTime;
  const resetMs =
    resetTime instanceof Date
      ? resetTime.getTime()
      : Date.now() + defaultWindowMs;
  const retryAfterSeconds = Math.max(
    1,
    Math.ceil((resetMs - Date.now()) / 1000),
  );
  res.setHeader('Retry-After', String(retryAfterSeconds));
}

function buildRateLimitHandler(message: string, windowMs: number) {
  return (req: Request, res: Response, _next: NextFunction) => {
    const rateLimitedReq = req as RateLimitedRequest;
    appendRetryAfterHeader(req, res, windowMs);
    res.status(429).json({
      error: message,
      retryAfterSeconds: rateLimitedReq.rateLimit?.resetTime
        ? Math.max(
            1,
            Math.ceil((rateLimitedReq.rateLimit.resetTime.getTime() - Date.now()) / 1000),
          )
        : Math.ceil(windowMs / 1000),
    });
  };
}

/**
 * Webhook Rate Limiter (AlertManager)
 * Allows up to 100 requests per minute
 */
export const webhookLimiter = rateLimit({
  windowMs: ONE_MINUTE_MS,
  max: scaleRateLimit(100),
  message: 'Too many webhook requests, please retry after a minute',
  standardHeaders: true, // Return rate limit info in RateLimit-* headers
  legacyHeaders: false, // Disable X-RateLimit-* headers
  handler: buildRateLimitHandler(
    'Too many webhook requests, please retry after a minute',
    ONE_MINUTE_MS,
  ),
});

/**
 * Public API limiter for lightweight unauthenticated reads
 * (e.g. knowledge summary/openapi discovery).
 */
export const apiLimiter = rateLimit({
  windowMs: ONE_MINUTE_MS,
  max: scaleRateLimit(30),
  message: 'Too many requests, please retry after a minute',
  standardHeaders: true,
  legacyHeaders: false,
  handler: buildRateLimitHandler(
    'Too many requests, please retry after a minute',
    ONE_MINUTE_MS,
  ),
});

/**
 * Auth Attempt Limiter (Pre-auth gate on protected routes)
 * Allows up to 300 requests per minute per IP before bearer auth.
 * This remains a coarse abuse control while role-aware limits are applied
 * after auth context is resolved.
 */
export const authLimiter = rateLimit({
  windowMs: ONE_MINUTE_MS,
  max: scaleRateLimit(300),
  message: 'Too many authentication attempts, please retry after a minute',
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false, // Count all requests, including successful
  handler: buildRateLimitHandler(
    'Too many authentication attempts, please retry after a minute',
    ONE_MINUTE_MS,
  ),
});

function resolveAuthenticatedKey(req: Request, bucket: string): string {
  const authReq = req as AuthenticatedRequest;
  const actor = authReq.auth?.actor?.trim();
  if (actor) return `${bucket}:actor:${actor}`;

  const label = authReq.auth?.apiKeyLabel?.trim();
  const version = authReq.auth?.apiKeyVersion;
  if (label) {
    const versionSuffix = Number.isFinite(version) ? `:v${version}` : '';
    return `${bucket}:label:${label}${versionSuffix}`;
  }

  return `${bucket}:ip:${req.ip ?? 'unknown-ip'}`;
}

/**
 * Viewer read bucket (global across authenticated read routes)
 * 120 requests per 60 seconds per API key actor/label.
 */
export const viewerReadLimiter = rateLimit({
  windowMs: ONE_MINUTE_MS,
  limit: scaleRateLimit(120),
  keyGenerator: (req: Request) => resolveAuthenticatedKey(req, 'viewer-read'),
  message: 'Viewer read rate limit exceeded, please retry after a minute',
  standardHeaders: true,
  legacyHeaders: false,
  handler: buildRateLimitHandler(
    'Viewer read rate limit exceeded, please retry after a minute',
    ONE_MINUTE_MS,
  ),
});

/**
 * Operator write bucket (global across authenticated mutation routes)
 * 30 requests per 60 seconds per API key actor/label.
 */
export const operatorWriteLimiter = rateLimit({
  windowMs: ONE_MINUTE_MS,
  limit: scaleRateLimit(30),
  keyGenerator: (req: Request) => resolveAuthenticatedKey(req, 'operator-write'),
  message: 'Operator write rate limit exceeded, please retry after a minute',
  standardHeaders: true,
  legacyHeaders: false,
  handler: buildRateLimitHandler(
    'Operator write rate limit exceeded, please retry after a minute',
    ONE_MINUTE_MS,
  ),
});

/**
 * Admin export bucket (global across authenticated export routes)
 * 10 requests per 60 seconds per API key actor/label.
 */
export const adminExportLimiter = rateLimit({
  windowMs: ONE_MINUTE_MS,
  limit: scaleRateLimit(10),
  keyGenerator: (req: Request) => resolveAuthenticatedKey(req, 'admin-export'),
  message: 'Admin export rate limit exceeded, please retry after a minute',
  standardHeaders: true,
  legacyHeaders: false,
  handler: buildRateLimitHandler(
    'Admin export rate limit exceeded, please retry after a minute',
    ONE_MINUTE_MS,
  ),
});

/**
 * Health Check Rate Limiter (Lenient for monitoring)
 * Allows up to 1000 requests per minute (for health monitoring)
 */
export const healthLimiter = rateLimit({
  windowMs: ONE_MINUTE_MS,
  max: scaleRateLimit(1000),
  // Don't send response for health checks, just let through
  skip: () => false,
});
