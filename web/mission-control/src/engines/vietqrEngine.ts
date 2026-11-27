import { ensureUtf8Bom } from './runbookEngine';

export const MBBANK_CONFIG = {
  bankName: 'MBBank (Military Commercial Joint Stock Bank)',
  bankShortName: 'MBBank',
  bankBin: '970422',
  accountNumber: '0325456574',
  accountHolder: 'TRUONG VAN TINH',
  template: 'compact2',
  baseUrl: 'https://img.vietqr.io/image',
} as const;

export type EnterpriseTierId = 'enterprise-sre' | 'cluster-deploy' | 'executive-retainer';

export interface EnterpriseLicenseTier {
  id: EnterpriseTierId;
  badge: string;
  badgeVi: string;
  name: string;
  nameVi: string;
  amountVnd: number;
  usdEquivalent: string;
  deliveryWindow: string;
  deliveryWindowVi: string;
  summary: string;
  summaryVi: string;
  deliverables: string[];
  deliverablesVi: string[];
  memoPrefix: string;
}

export const ENTERPRISE_LICENSE_TIERS: EnterpriseLicenseTier[] = [
  {
    id: 'enterprise-sre',
    badge: 'FLAGSHIP #2 · TVT STUDIO',
    badgeVi: 'FLAGSHIP #2 · TVT STUDIO',
    name: 'AegisPulse v3.0 Enterprise License',
    nameVi: 'Giấy phép Doanh nghiệp AegisPulse v3.0',
    amountVnd: 22900000,
    usdEquivalent: '~$920 USD',
    deliveryWindow: 'Instant Source + 30-Day Architecture Support',
    deliveryWindowVi: 'Bàn giao mã nguồn ngay + 30 ngày hỗ trợ Kiến trúc',
    summary:
      'Full commercial source license for the .NET 10 High-Concurrency Kernel, FastAPI Hybrid RAG Co-Pilot, and React 19 SRE Control Plane.',
    summaryVi:
      'Toàn bộ mã nguồn thương mại: Lõi .NET 10 tải cao, FastAPI Hybrid RAG Co-Pilot và bảng điều khiển React 19 Mission Control.',
    deliverables: [
      'Full commercial IP license (unlimited internal clusters)',
      '.NET 10 Lock-Free Channel<T> + Redis Lua EVALSHA kernel',
      '5-Region Raft Quorum, Chaos Fault Deck & SVG Flamegraph UI',
      'FastAPI BM25 + Dense RRF SRE Agent with OOD guardrail',
      '30-day direct architecture review with Truong Van Tinh',
    ],
    deliverablesVi: [
      'Giấy phép thương mại đầy đủ (không giới hạn cụm nội bộ)',
      'Lõi .NET 10 Channel<T> Lock-Free + Redis Lua EVALSHA',
      'Bảng điều khiển Raft 5 vùng, Chaos Injector & Flamegraph SVG',
      'Agent SRE FastAPI Hybrid BM25 + Vector RRF chống ảo giác',
      '30 ngày tư vấn kiến trúc trực tiếp cùng Trương Văn Tình',
    ],
    memoPrefix: 'AEGISPULSE V3 LICENSE',
  },
  {
    id: 'cluster-deploy',
    badge: 'PRODUCTION TURNKEY',
    badgeVi: 'TRIỂN KHAI TRỌN GÓI',
    name: 'Dedicated Cluster Deployment & 250K RPS Audit',
    nameVi: 'Triển khai cụm Production & Tối ưu 250K RPS',
    amountVnd: 38500000,
    usdEquivalent: '~$1,540 USD',
    deliveryWindow: '10 Business Days · Helm + Terraform + Load Audit',
    deliveryWindowVi: '10 ngày làm việc · Helm + Terraform + Kiểm tải',
    summary:
      'Complete Enterprise License plus hands-on Kubernetes/Helm deployment, SQL/Dapper tuning, and multi-region chaos game-day verification.',
    summaryVi:
      'Gồm toàn bộ gói Enterprise cùng triển khai Kubernetes/Helm thực tế, tối ưu SQL/Dapper và diễn tập Chaos đa vùng.',
    deliverables: [
      'Everything in AegisPulse v3.0 Enterprise License',
      'Production K8s HPA + Envoy Anycast + PgBouncer Helm charts',
      'Custom .NET/Go Flamegraph & GC pause tuning (< 45ms P99)',
      'Live flash-sale stress audit & zero double-spend sign-off',
      'Team handover workshop & B2B VAT contract documentation',
    ],
    deliverablesVi: [
      'Đầy đủ quyền lợi gói Giấy phép AegisPulse v3.0 Enterprise',
      'Helm chart Production: K8s HPA + Envoy Anycast + PgBouncer',
      'Tối ưu Flamegraph & GC Pause .NET/Go đạt chuẩn P99 < 45ms',
      'Kiểm tải flash-sale thực tế & nghiệm thu 0 double-spend',
      'Workshop bàn giao đội ngũ & hợp đồng B2B đầy đủ chứng từ',
    ],
    memoPrefix: 'AEGISPULSE V3 DEPLOY',
  },
  {
    id: 'executive-retainer',
    badge: 'PRINCIPAL ARCHITECT',
    badgeVi: 'KIẾN TRÚC SƯ TRƯỞNG',
    name: 'Custom SRE Co-Pilot & Multi-Region Architecture',
    nameVi: 'Tùy biến SRE Co-Pilot & Kiến trúc Đa vùng',
    amountVnd: 59000000,
    usdEquivalent: '~$2,360 USD',
    deliveryWindow: '21 Days · Custom Enterprise Runbooks & Private RAG',
    deliveryWindowVi: '21 ngày · Runbook riêng & Private RAG nội bộ',
    summary:
      'Bespoke enterprise commissioning with private runbook ingestion, Keycloak SSO/OIDC integration, and quarterly chaos game-days.',
    summaryVi:
      'Thiết kế chuyên biệt cho doanh nghiệp: nạp tài liệu sự cố nội bộ vào Hybrid RAG, tích hợp Keycloak SSO và diễn tập định kỳ.',
    deliverables: [
      'Everything in Dedicated Cluster Deployment tier',
      'Private Hybrid RAG indexing your internal post-mortems & SOPs',
      'Keycloak OAuth 2.0 / OIDC RBAC + OpenTelemetry Prometheus stack',
      'Automated Incident Commander runbooks wired to PagerDuty/Slack',
      'Priority SLA engineering advisory & quarterly load audits',
    ],
    deliverablesVi: [
      'Đầy đủ quyền lợi gói Triển khai cụm Production trọn gói',
      'Hybrid RAG nội bộ lập chỉ mục toàn bộ SOP & Post-Mortem riêng',
      'Tích hợp Keycloak OAuth 2.0/OIDC RBAC + OpenTelemetry Prometheus',
      'Tự động hóa Incident Runbook kết nối trực tiếp Slack/PagerDuty',
      'Cố vấn kỹ thuật SLA ưu tiên & kiểm tải định kỳ hàng quý',
    ],
    memoPrefix: 'AEGISPULSE V3 EXEC',
  },
];

export function formatVnd(amount: number): string {
  const safe = Math.max(0, Math.round(amount));
  const formatted = safe.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${formatted} VND`;
}

export function sanitizeTransferMemo(raw: string, maxLength = 50): string {
  const normalized = raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toUpperCase()
    .replace(/[^A-Z0-9 -]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized.slice(0, maxLength).trim();
}

export function buildEnterpriseTransferMemo(
  tier: EnterpriseLicenseTier,
  organizationName: string,
  quoteRef: string
): string {
  const cleanOrg = sanitizeTransferMemo(organizationName, 16);
  const raw = cleanOrg
    ? `${tier.memoPrefix} ${cleanOrg} ${quoteRef}`
    : `${tier.memoPrefix} ${quoteRef}`;
  return sanitizeTransferMemo(raw, 50);
}

export function buildMbBankVietQrUrl(params: {
  amountVnd: number;
  addInfo: string;
}): string {
  const amount = Math.max(0, Math.round(params.amountVnd));
  const cleanInfo = sanitizeTransferMemo(params.addInfo, 50);
  const query = new URLSearchParams({
    amount: String(amount),
    addInfo: cleanInfo,
    accountName: MBBANK_CONFIG.accountHolder,
  });
  return `${MBBANK_CONFIG.baseUrl}/${MBBANK_CONFIG.bankBin}-${MBBANK_CONFIG.accountNumber}-${MBBANK_CONFIG.template}.png?${query.toString()}`;
}

export function createQuoteReference(tierId: EnterpriseTierId, orgName: string): string {
  const seed = `${tierId}|${orgName.trim().toUpperCase()}`;
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const suffix = ((hash >>> 0) % 9000 + 1000).toString();
  return `AP3-${suffix}`;
}

export function generateEnterpriseQuoteMarkdown(params: {
  tier: EnterpriseLicenseTier;
  organizationName: string;
  contactEmail: string;
  quoteRef: string;
  transferMemo: string;
  vietQrUrl: string;
}): string {
  const lines = [
    `# AegisPulse v3.0 Enterprise License & Commissioning Quote`,
    ``,
    `| Quote Field | Details |`,
    `| :--- | :--- |`,
    `| **Quote Reference** | \`${params.quoteRef}\` |`,
    `| **Selected Tier** | **${params.tier.name}** |`,
    `| **Commissioning Fee** | **${formatVnd(params.tier.amountVnd)}** (${params.tier.usdEquivalent}) |`,
    `| **Client Organization** | ${params.organizationName || 'Enterprise Evaluation Client'} |`,
    `| **Client Contact** | ${params.contactEmail || 'Pending confirmation'} |`,
    `| **Delivery Window** | ${params.tier.deliveryWindow} |`,
    ``,
    `## MBBank VietQR Settlement Details`,
    ``,
    `- **Bank:** ${MBBANK_CONFIG.bankName} (BIN: \`${MBBANK_CONFIG.bankBin}\`)`,
    `- **Account Number:** \`${MBBANK_CONFIG.accountNumber}\``,
    `- **Account Holder:** \`${MBBANK_CONFIG.accountHolder}\``,
    `- **Amount:** \`${formatVnd(params.tier.amountVnd)}\``,
    `- **Transfer Memo:** \`${params.transferMemo}\``,
    `- **Live VietQR URL:** ${params.vietQrUrl}`,
    ``,
    `## Scope & Deliverables`,
    ``,
    ...params.tier.deliverables.map((item) => `- [x] ${item}`),
    ``,
    `---`,
    `*Issued by Truong Van Tinh (TVT Studio) · Email: tinhkun102@gmail.com · Hotline: 0931 467 024*`,
  ];
  return ensureUtf8Bom(lines.join('\n'));
}
