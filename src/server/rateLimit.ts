/** Простое ограничение частоты AI-запросов на IP (скользящее окно 60 с, память процесса). */
export interface RateLimiter {
  check(key: string, now?: number): { allowed: boolean; retryAfterSeconds: number };
}

export function createRateLimiter(limitPerMinute: number, windowMs = 60_000): RateLimiter {
  const hits = new Map<string, number[]>();
  return {
    check(key, now = Date.now()) {
      const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
      if (recent.length >= limitPerMinute) {
        hits.set(key, recent);
        const retryAfterSeconds = Math.max(1, Math.ceil((recent[0]! + windowMs - now) / 1000));
        return { allowed: false, retryAfterSeconds };
      }
      recent.push(now);
      hits.set(key, recent);
      // Очистка старых ключей, чтобы карта не росла бесконечно.
      if (hits.size > 5000) for (const [k, v] of hits) if (v.every((t) => now - t >= windowMs)) hits.delete(k);
      return { allowed: true, retryAfterSeconds: 0 };
    },
  };
}
