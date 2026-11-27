import http from 'k6/http';
import { check } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

/**
 * AegisPulse v4.0 — Production k6 High-Concurrency Load Test (5,000 RPS)
 * Models Con Cung 700-Store Flash-Sale Promo Voucher Contention:
 * - Executor: constant-arrival-rate @ 5,000 RPS
 * - Assertions: p99 < 45ms, 0 unexpected errors, 0.00% double-spending verified via /audit
 *
 * Usage:
 *   k6 run benchmarks/k6-voucher-5000rps.js
 *   k6 run -e BASE_URL=http://localhost:5080 -e TARGET_RPS=5000 -e VOUCHER_STOCK=100 benchmarks/k6-voucher-5000rps.js
 */

const BASE_URL = __ENV.BASE_URL || 'http://localhost:5080';
const TARGET_RPS = Number(__ENV.TARGET_RPS || 5000);
const DURATION = __ENV.DURATION || '30s';
const VOUCHER_STOCK = Number(__ENV.VOUCHER_STOCK || 100);
const VOUCHER_CODE = __ENV.VOUCHER_CODE || `K6-FLASH-500K-${Date.now()}`;

const voucherApproved200 = new Counter('voucher_approved_200');
const voucherConflict409 = new Counter('voucher_conflict_409');
const voucherUnexpectedErrors = new Counter('voucher_unexpected_errors');
const doubleSpendDetected = new Counter('double_spend_detected');
const atomicOutcomeRate = new Rate('atomic_outcome_valid_rate');
const redeemLatencyMs = new Trend('redeem_latency_ms', true);

export const options = {
  scenarios: {
    flash_sale_5000_rps: {
      executor: 'constant-arrival-rate',
      rate: TARGET_RPS,
      timeUnit: '1s',
      duration: DURATION,
      preAllocatedVUs: 250,
      maxVUs: 1200,
    },
  },
  thresholds: {
    http_req_duration: ['p(99)<45', 'p(95)<25'],
    redeem_latency_ms: ['p(99)<45'],
    atomic_outcome_valid_rate: ['rate==1.0'],
    voucher_unexpected_errors: ['count==0'],
    double_spend_detected: ['count==0'],
  },
};

export function setup() {
  const seedPayload = JSON.stringify({
    code: VOUCHER_CODE,
    faceValueVnd: 500000,
    initialStock: VOUCHER_STOCK,
    campaignName: 'Con Cung 700-Store 5000 RPS k6 Verification',
  });

  const res = http.post(`${BASE_URL}/api/v1/vouchers/seed`, seedPayload, {
    headers: { 'Content-Type': 'application/json' },
    tags: { endpoint: 'seed' },
  });

  const seededOk = check(res, {
    'voucher seeded (201 Created)': (r) => r.status === 201,
  });

  if (!seededOk) {
    throw new Error(`Failed to seed voucher ${VOUCHER_CODE}: HTTP ${res.status} ${res.body}`);
  }

  return {
    voucherCode: VOUCHER_CODE,
    initialStock: VOUCHER_STOCK,
  };
}

export default function (data) {
  const storeNum = String(((__VU + __ITER) % 700) + 1).padStart(3, '0');
  const idempotencyKey = `k6-${data.voucherCode}-vu${__VU}-it${__ITER}`;

  const payload = JSON.stringify({
    customerId: `cust-${__VU}-${__ITER}`,
    storeCode: `STORE-${storeNum}`,
  });

  const res = http.post(
    `${BASE_URL}/api/v1/vouchers/${data.voucherCode}/redeem`,
    payload,
    {
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      tags: { endpoint: 'redeem' },
    }
  );

  redeemLatencyMs.add(res.timings.duration);

  if (res.status === 200) {
    voucherApproved200.add(1);
    atomicOutcomeRate.add(true);
  } else if (res.status === 409) {
    voucherConflict409.add(1);
    atomicOutcomeRate.add(true);
  } else {
    voucherUnexpectedErrors.add(1);
    atomicOutcomeRate.add(false);
  }

  check(res, {
    'atomic HTTP status (200 OK or 409 Conflict)': (r) =>
      r.status === 200 || r.status === 409,
  });
}

export function teardown(data) {
  const auditRes = http.get(`${BASE_URL}/api/v1/vouchers/${data.voucherCode}/audit`, {
    tags: { endpoint: 'audit' },
  });

  const audit = auditRes.json();
  const zeroDoubleSpend =
    audit &&
    audit.doubleSpendCount === 0 &&
    audit.invariantIntact === true &&
    audit.approvedRedemptions <= data.initialStock &&
    audit.remainingStock >= 0;

  if (!zeroDoubleSpend) {
    doubleSpendDetected.add(1);
  }

  check(auditRes, {
    'audit endpoint reachable (200 OK)': (r) => r.status === 200,
    'ZERO double-spend invariant verified': () => Boolean(zeroDoubleSpend),
  });

  console.log(
    `[AegisPulse k6 Audit] Voucher=${data.voucherCode} | InitialStock=${data.initialStock} | Approved=${audit?.approvedRedemptions} | Conflicts409=${audit?.rejectedConflicts409} | DoubleSpends=${audit?.doubleSpendCount} | InvariantIntact=${audit?.invariantIntact}`
  );
}
