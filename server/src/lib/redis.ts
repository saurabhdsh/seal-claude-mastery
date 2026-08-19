import { Redis } from "ioredis";
import { env } from "../config/env.js";
import { logger } from "./logger.js";

const globalForRedis = globalThis as unknown as {
  redis?: Redis;
  memoryLocks?: Map<string, { token: string; expires: number }>;
};

export const redis =
  globalForRedis.redis ??
  new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: true,
    retryStrategy: (times: number) => (times > 3 ? null : Math.min(times * 200, 1000)),
  });

if (process.env.NODE_ENV !== "production") globalForRedis.redis = redis;

const memoryLocks = globalForRedis.memoryLocks ?? new Map<string, { token: string; expires: number }>();
globalForRedis.memoryLocks = memoryLocks;

async function redisAvailable() {
  try {
    if (redis.status === "wait") await redis.connect();
    await redis.ping();
    return true;
  } catch {
    return false;
  }
}

export async function withLock<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T | null> {
  const token = `${process.pid}-${Date.now()}-${Math.random()}`;
  if (await redisAvailable()) {
    const ok = await redis.set(key, token, "PX", ttlMs, "NX");
    if (ok !== "OK") return null;
    try {
      return await fn();
    } finally {
      const current = await redis.get(key);
      if (current === token) await redis.del(key);
    }
  }

  logger.warn("Redis unavailable — using process-local finalize lock");
  const now = Date.now();
  const existing = memoryLocks.get(key);
  if (existing && existing.expires > now) return null;
  memoryLocks.set(key, { token, expires: now + ttlMs });
  try {
    return await fn();
  } finally {
    const cur = memoryLocks.get(key);
    if (cur?.token === token) memoryLocks.delete(key);
  }
}
