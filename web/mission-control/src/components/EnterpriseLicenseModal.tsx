import { useEffect, useMemo, useState } from 'react';
import {
  Building2,
  Check,
  CheckCircle2,
  Copy,
  Download,
  Mail,
  QrCode,
  ShieldCheck,
  X,
} from 'lucide-react';
import { downloadUtf8BomFile } from '../engines/runbookEngine';
import {
  buildEnterpriseTransferMemo,
  buildMbBankVietQrUrl,
  createQuoteReference,
  ENTERPRISE_LICENSE_TIERS,
  formatVnd,
  generateEnterpriseQuoteMarkdown,
  MBBANK_CONFIG,
  type EnterpriseTierId,
} from '../engines/vietqrEngine';
import { UI_COPY, type LangMode } from '../i18n/translations';

interface Props {
  open: boolean;
  lang: LangMode;
  onClose: () => void;
}

export function EnterpriseLicenseModal({ open, lang, onClose }: Props) {
  const copy = UI_COPY[lang].licenseModal;
  const [selectedTierId, setSelectedTierId] = useState<EnterpriseTierId>('enterprise-sre');
  const [organizationName, setOrganizationName] = useState<string>('');
  const [contactEmail, setContactEmail] = useState<string>('');
  const [copiedField, setCopiedField] = useState<'account' | 'memo' | null>(null);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  const activeTier = useMemo(
    () => ENTERPRISE_LICENSE_TIERS.find((t) => t.id === selectedTierId) ?? ENTERPRISE_LICENSE_TIERS[0],
    [selectedTierId]
  );

  const quoteRef = useMemo(
    () => createQuoteReference(activeTier.id, organizationName),
    [activeTier.id, organizationName]
  );

  const transferMemo = useMemo(
    () => buildEnterpriseTransferMemo(activeTier, organizationName, quoteRef),
    [activeTier, organizationName, quoteRef]
  );

  const vietQrUrl = useMemo(
    () =>
      buildMbBankVietQrUrl({
        amountVnd: activeTier.amountVnd,
        addInfo: transferMemo,
      }),
    [activeTier.amountVnd, transferMemo]
  );

  if (!open) return null;

  async function handleCopy(field: 'account' | 'memo', value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 1800);
    } catch {
      // Fallback ignored in restricted clipboard contexts
    }
  }

  function handleDownloadQuote() {
    const md = generateEnterpriseQuoteMarkdown({
      tier: activeTier,
      organizationName,
      contactEmail,
      quoteRef,
      transferMemo,
      vietQrUrl,
    });
    downloadUtf8BomFile(`aegispulse-v3-quote-${quoteRef}.md`, md, 'text/markdown');
  }

  const mailSubject = encodeURIComponent(
    `AegisPulse v3.0 Enterprise Commissioning [${quoteRef}] - ${activeTier.name}`
  );
  const mailBody = encodeURIComponent(
    `Hello Truong Van Tinh,\n\nWe are commissioning ${activeTier.name} (${formatVnd(activeTier.amountVnd)}).\nQuote Ref: ${quoteRef}\nOrganization: ${organizationName || 'N/A'}\nTransfer Memo: ${transferMemo}\nMBBank Account: ${MBBANK_CONFIG.accountNumber} (${MBBANK_CONFIG.accountHolder})\n\nPlease confirm source delivery and architecture onboarding.`
  );

  return (
    <div
      data-testid="enterprise-license-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-3 backdrop-blur-sm sm:p-5"
      role="dialog"
      aria-modal="true"
      aria-label="AegisPulse v3.0 Enterprise License and MBBank VietQR Checkout"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="surface-panel max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-2xl border shadow-2xl">
        {/* Modal Header */}
        <div className="border-hairline sticky top-0 z-10 flex items-start justify-between gap-3 border-b bg-inherit px-5 py-4 backdrop-blur-md">
          <div className="min-w-0">
            <div className="font-mono text-[10.5px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
              {copy.eyebrow}
            </div>
            <h2 className="mt-0.5 text-base font-extrabold text-heading sm:text-lg">
              {copy.title}
            </h2>
            <p className="mt-0.5 text-xs text-dim">{copy.subtitle}</p>
          </div>
          <button
            type="button"
            data-testid="btn-close-license-modal"
            onClick={onClose}
            aria-label={copy.close}
            className="surface-chip shrink-0 rounded-lg border p-1.5 text-dim transition hover:border-cyan-500 hover:text-heading"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="grid grid-cols-1 gap-5 p-5 lg:grid-cols-12">
          {/* Left: Tier Selection + Deliverables + Client Info */}
          <div className="min-w-0 space-y-4 lg:col-span-7">
            <div className="space-y-2.5">
              {ENTERPRISE_LICENSE_TIERS.map((tier) => {
                const isSelected = tier.id === activeTier.id;
                return (
                  <button
                    key={tier.id}
                    type="button"
                    data-testid={`license-tier-${tier.id}`}
                    onClick={() => setSelectedTierId(tier.id)}
                    className={`w-full rounded-xl border p-3.5 text-left transition ${
                      isSelected
                        ? 'border-cyan-500 bg-cyan-500/12 ring-1 ring-cyan-500/35'
                        : 'surface-inset hover:border-cyan-500/50'
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="rounded bg-emerald-500/15 px-2 py-0.5 font-mono text-[10px] font-bold uppercase text-emerald-700 dark:text-emerald-300">
                        {lang === 'vi' ? tier.badgeVi : tier.badge}
                      </span>
                      <span className="font-mono text-sm font-extrabold text-cyan-700 dark:text-cyan-300">
                        {formatVnd(tier.amountVnd)}
                      </span>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-baseline justify-between gap-2">
                      <h3 className="text-xs font-extrabold text-heading sm:text-sm">
                        {lang === 'vi' ? tier.nameVi : tier.name}
                      </h3>
                      <span className="font-mono text-[10.5px] text-faint">
                        {tier.usdEquivalent}
                      </span>
                    </div>
                    <p className="mt-1 text-[11.5px] leading-relaxed text-dim">
                      {lang === 'vi' ? tier.summaryVi : tier.summary}
                    </p>
                  </button>
                );
              })}
            </div>

            {/* Client Inputs */}
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <div className="surface-inset flex items-center gap-2 rounded-xl border px-3 py-2">
                <Building2 className="h-4 w-4 shrink-0 text-cyan-500" />
                <input
                  type="text"
                  data-testid="license-org-input"
                  value={organizationName}
                  onChange={(e) => setOrganizationName(e.target.value)}
                  placeholder={copy.orgPlaceholder}
                  className="w-full min-w-0 bg-transparent text-xs text-heading placeholder:text-faint focus:outline-none"
                />
              </div>
              <div className="surface-inset flex items-center gap-2 rounded-xl border px-3 py-2">
                <Mail className="h-4 w-4 shrink-0 text-emerald-500" />
                <input
                  type="email"
                  data-testid="license-email-input"
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                  placeholder={copy.emailPlaceholder}
                  className="w-full min-w-0 bg-transparent text-xs text-heading placeholder:text-faint focus:outline-none"
                />
              </div>
            </div>

            {/* Deliverables Checklist */}
            <div className="surface-inset rounded-xl border p-3.5">
              <div className="flex items-center justify-between gap-2 font-mono text-[10.5px] font-bold uppercase tracking-wider text-heading">
                <span className="flex items-center gap-1.5">
                  <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
                  {lang === 'vi' ? activeTier.deliveryWindowVi : activeTier.deliveryWindow}
                </span>
                <span className="text-cyan-600 dark:text-cyan-400">REF: {quoteRef}</span>
              </div>
              <ul className="mt-2.5 space-y-1.5">
                {(lang === 'vi' ? activeTier.deliverablesVi : activeTier.deliverables).map(
                  (item) => (
                    <li key={item} className="flex items-start gap-2 text-xs text-body">
                      <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
                      <span>{item}</span>
                    </li>
                  )
                )}
              </ul>
            </div>
          </div>

          {/* Right: Live MBBank VietQR Checkout Panel */}
          <div className="surface-inset flex min-w-0 flex-col justify-between rounded-2xl border border-cyan-500/35 p-4 lg:col-span-5">
            <div>
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-xs font-extrabold text-heading">
                  <QrCode className="h-4 w-4 text-cyan-500" />
                  {copy.qrTitle}
                </span>
                <span className="rounded-full bg-cyan-500/15 px-2 py-0.5 font-mono text-[10px] font-bold text-cyan-700 dark:text-cyan-300">
                  BIN {MBBANK_CONFIG.bankBin}
                </span>
              </div>
              <p className="mt-0.5 text-[11px] text-dim">{copy.qrSubtitle}</p>

              {/* Live VietQR Image Container */}
              <div className="mt-2.5 flex justify-center rounded-xl border border-slate-300/60 bg-white p-2 shadow-inner dark:border-slate-700">
                <img
                  data-testid="mbbank-vietqr-img"
                  src={vietQrUrl}
                  alt={`MBBank VietQR ${MBBANK_CONFIG.bankBin} - ${MBBANK_CONFIG.accountNumber} - ${MBBANK_CONFIG.accountHolder}`}
                  width={215}
                  height={240}
                  loading="eager"
                  className="h-auto max-h-[218px] w-auto max-w-full rounded-lg object-contain"
                />
              </div>

              {/* Verified Bank Settlement Fields */}
              <div className="mt-2.5 space-y-1.5 font-mono text-[11px]">
                <div className="surface-panel flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5">
                  <span className="text-dim">Bank</span>
                  <span className="font-bold text-heading">
                    {MBBANK_CONFIG.bankShortName} ({MBBANK_CONFIG.bankBin})
                  </span>
                </div>
                <div className="surface-panel flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5">
                  <span className="text-dim">Account</span>
                  <div className="flex items-center gap-1.5">
                    <span
                      data-testid="mbbank-account-number"
                      className="font-extrabold text-cyan-700 dark:text-cyan-300"
                    >
                      {MBBANK_CONFIG.accountNumber}
                    </span>
                    <button
                      type="button"
                      onClick={() => void handleCopy('account', MBBANK_CONFIG.accountNumber)}
                      className="surface-chip rounded border px-1.5 py-0.5 text-[10px] text-body hover:border-cyan-500"
                      aria-label={copy.copyAccount}
                    >
                      {copiedField === 'account' ? (
                        <Check className="h-3 w-3 text-emerald-500" />
                      ) : (
                        <Copy className="h-3 w-3" />
                      )}
                    </button>
                  </div>
                </div>
                <div className="surface-panel flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5">
                  <span className="text-dim">Holder</span>
                  <span className="font-extrabold text-heading">{MBBANK_CONFIG.accountHolder}</span>
                </div>
                <div className="surface-panel flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5">
                  <span className="text-dim">Amount</span>
                  <span
                    data-testid="mbbank-amount"
                    className="font-extrabold text-emerald-600 dark:text-emerald-300"
                  >
                    {formatVnd(activeTier.amountVnd)}
                  </span>
                </div>
                <div className="surface-panel rounded-lg border px-2.5 py-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-dim">Transfer Memo</span>
                    <button
                      type="button"
                      onClick={() => void handleCopy('memo', transferMemo)}
                      className="surface-chip inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] text-body hover:border-cyan-500"
                    >
                      {copiedField === 'memo' ? (
                        <>
                          <Check className="h-3 w-3 text-emerald-500" />
                          {copy.copied}
                        </>
                      ) : (
                        <>
                          <Copy className="h-3 w-3" />
                          {copy.copyMemo}
                        </>
                      )}
                    </button>
                  </div>
                  <div
                    data-testid="mbbank-memo"
                    className="mt-0.5 break-all text-[10.5px] font-bold text-heading"
                  >
                    {transferMemo}
                  </div>
                </div>
              </div>
            </div>

            {/* Bottom CTAs */}
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                data-testid="btn-download-quote"
                onClick={handleDownloadQuote}
                className="surface-chip flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2.5 text-xs font-bold text-body transition hover:border-cyan-500 hover:text-heading"
              >
                <Download className="h-3.5 w-3.5" />
                {copy.downloadQuote}
              </button>
              <a
                href={`mailto:tinhkun102@gmail.com?subject=${mailSubject}&body=${mailBody}`}
                className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-cyan-500 to-emerald-500 px-3 py-2.5 text-xs font-extrabold text-slate-950 shadow-md shadow-cyan-500/20 transition hover:brightness-110"
              >
                <Mail className="h-3.5 w-3.5" />
                {copy.emailConfirm}
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
