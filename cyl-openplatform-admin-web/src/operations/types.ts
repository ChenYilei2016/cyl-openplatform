export interface OperationsTotals {
  requests: number;
  successes: number;
  clientErrors: number;
  serverErrors: number;
  authRejected: number;
  rateLimited: number;
  slowCalls: number;
  unattributed: number;
  governanceRejected: number;
  observedRequests: number;
  ruleHits: number;
  ipDenied: number;
  tokenBucketRejected: number;
  dailyQuotaRejected: number;
  durationSum: number;
  maxDuration: number;
  successRate: string | null;
  averageLatencyMillis: string | null;
}
export interface OperationsStatistics {
  from: string;
  to: string;
  mode: "PRODUCTION" | "DRAFT_DEBUG";
  bucket: string;
  retentionDays: number;
  summary: OperationsTotals;
  dimension: 'TENANT' | 'PERSON' | 'API';
  sort: 'REQUESTS' | 'FAILURES' | 'REJECTIONS' | 'RULE_HITS';
  top: number;
  identityCoverageStart: string | null;
  rankings: StatisticsRank[];
  points: { bucketStart: string; totals: OperationsTotals }[];
}
export interface StatisticsRank {
  tenantId: string;
  employeeId: string;
  identityKind: 'EMPLOYEE' | 'APPLICATION' | 'UNKNOWN';
  apiId: string;
  name: string | null;
  employeeNo: string | null;
  tenantName: string | null;
  totals: OperationsTotals;
}
export interface AlertPolicy {
  version: number;
  windowMinutes: number;
  minRequests: number;
  failureEnabled: boolean;
  failureRateThreshold: number;
  latencyEnabled: boolean;
  averageLatencyThresholdMillis: number;
}
export type AlertMetric = "FAILURE_RATE" | "AVERAGE_LATENCY";
export type AlertStatus = "DISABLED" | "NO_DATA" | "NORMAL" | "FIRING";
export interface AlertState {
  metric: AlertMetric;
  status: AlertStatus;
  value: string | null;
  sampleCount: number;
  windowStart: string;
  windowEnd: string;
  policyVersion: number;
  evaluatedAt: string;
}
export interface AlertOverview {
  policy: AlertPolicy;
  states: AlertState[];
  stale: boolean;
}
export interface AlertEvent {
  id: string;
  metric: AlertMetric;
  previousStatus: AlertStatus | null;
  status: AlertStatus;
  value: string | null;
  sampleCount: number;
  windowStart: string;
  windowEnd: string;
  policyVersion: number;
  occurredAt: string;
}
