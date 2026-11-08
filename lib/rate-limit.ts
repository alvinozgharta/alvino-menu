// In-memory sliding window rate limiter for login throttling

interface AttemptRecord {
  count: number;
  firstAttemptAt: number;
  blockedUntil?: number;
}

const attempts = new Map<string, AttemptRecord>();

const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const BLOCK_DURATION_MS = 15 * 60 * 1000; // 15 minutes

export function checkRateLimit(identifier: string): {
  allowed: boolean;
  remainingAttempts: number;
  blockedUntil?: number;
} {
  const now = Date.now();
  const record = attempts.get(identifier);

  // Clean up if expired
  if (record) {
    if (record.blockedUntil && now < record.blockedUntil) {
      return {
        allowed: false,
        remainingAttempts: 0,
        blockedUntil: record.blockedUntil,
      };
    }

    if (now - record.firstAttemptAt > WINDOW_MS) {
      attempts.delete(identifier);
    }
  }

  const current = attempts.get(identifier);
  const remaining = current ? Math.max(0, MAX_ATTEMPTS - current.count) : MAX_ATTEMPTS;

  return {
    allowed: remaining > 0,
    remainingAttempts: remaining,
  };
}

export function recordFailedAttempt(identifier: string): {
  allowed: boolean;
  remainingAttempts: number;
  blockedUntil?: number;
} {
  const now = Date.now();
  const record = attempts.get(identifier);

  if (!record || now - record.firstAttemptAt > WINDOW_MS) {
    attempts.set(identifier, {
      count: 1,
      firstAttemptAt: now,
    });
    return {
      allowed: true,
      remainingAttempts: MAX_ATTEMPTS - 1,
    };
  }

  record.count += 1;
  if (record.count >= MAX_ATTEMPTS) {
    record.blockedUntil = now + BLOCK_DURATION_MS;
    return {
      allowed: false,
      remainingAttempts: 0,
      blockedUntil: record.blockedUntil,
    };
  }

  return {
    allowed: true,
    remainingAttempts: MAX_ATTEMPTS - record.count,
  };
}

export function resetRateLimit(identifier: string): void {
  attempts.delete(identifier);
}
