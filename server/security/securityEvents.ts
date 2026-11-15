export type SecurityEventCategory =
  | 'auth_failure'
  | 'auth_lockout'
  | 'csrf_blocked'
  | 'rate_limited'
  | 'ssrf_blocked'
  | 'upload_blocked'
  | 'validation_blocked'
  | 'migration_blocked';

export interface SecurityEventRecord {
  id: string;
  timestamp: string;
  category: SecurityEventCategory;
  severity: 'info' | 'warning' | 'high';
  path?: string;
  method?: string;
  ip?: string;
  summary: string;
}

const MAX_SECURITY_EVENTS = 150;
const recentEvents: SecurityEventRecord[] = [];
const categoryCounts: Record<SecurityEventCategory, number> = {
  auth_failure: 0,
  auth_lockout: 0,
  csrf_blocked: 0,
  rate_limited: 0,
  ssrf_blocked: 0,
  upload_blocked: 0,
  validation_blocked: 0,
  migration_blocked: 0,
};

export function recordSecurityEvent(event: Omit<SecurityEventRecord, 'id' | 'timestamp'>): SecurityEventRecord {
  const entry: SecurityEventRecord = {
    id: `sec-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    timestamp: new Date().toISOString(),
    ...event,
  };
  categoryCounts[event.category] = (categoryCounts[event.category] || 0) + 1;
  recentEvents.unshift(entry);
  if (recentEvents.length > MAX_SECURITY_EVENTS) {
    recentEvents.length = MAX_SECURITY_EVENTS;
  }
  return entry;
}

export function getRecentSecurityEvents(limit = 25): SecurityEventRecord[] {
  return recentEvents.slice(0, Math.max(1, Math.min(MAX_SECURITY_EVENTS, limit)));
}

export function getSecurityEventCounters(): Record<SecurityEventCategory, number> {
  return { ...categoryCounts };
}

export function clearSecurityEventsForTesting(): void {
  recentEvents.length = 0;
  for (const key of Object.keys(categoryCounts) as SecurityEventCategory[]) {
    categoryCounts[key] = 0;
  }
}
