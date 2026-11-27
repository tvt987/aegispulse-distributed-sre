namespace AegisPulse.Domain.Vouchers;

public enum VoucherRedemptionOutcome
{
    Redeemed,
    IdempotentReplay,
    VoucherExhausted,
    RowVersionConflict,
    IdempotencyPayloadMismatch,
    VoucherNotFound,
    CircuitBreakerOpen
}

public sealed record RedeemVoucherCommand(
    string VoucherCode,
    string CustomerId,
    string StoreCode,
    string IdempotencyKey
);

public sealed record SeedVoucherCommand(
    string Code,
    long FaceValueVnd = 500_000,
    int InitialStock = 1,
    string CampaignName = "Con Cung Flash-Sale 700-Store Promo"
);

public sealed record VoucherRedemptionReceipt(
    string RedemptionId,
    string VoucherCode,
    string CustomerId,
    string StoreCode,
    string IdempotencyKey,
    long FaceValueVnd,
    int RemainingStockAfter,
    ulong RowVersion,
    string RowVersionHex,
    bool IsIdempotentReplay,
    VoucherRedemptionOutcome Outcome,
    long LatencyMicroseconds,
    DateTimeOffset RedeemedAtUtc
);

public sealed record RedeemOperationResult(
    VoucherRedemptionOutcome Outcome,
    VoucherRedemptionReceipt? Receipt = null,
    string? ErrorTitle = null,
    string? ErrorDetail = null
);

public sealed record VoucherAuditEvent(
    string EventId,
    string EventType,
    string CustomerId,
    string StoreCode,
    string IdempotencyKey,
    ulong RowVersion,
    int RemainingStockAfter,
    DateTimeOffset TimestampUtc
);

public sealed record VoucherAuditSnapshot(
    string Code,
    string CampaignName,
    long FaceValueVnd,
    int InitialStock,
    int RemainingStock,
    int ApprovedRedemptions,
    int RejectedConflicts409,
    int IdempotentReplays,
    int RowVersionConflicts,
    int DoubleSpendCount,
    bool InvariantIntact,
    ulong CurrentRowVersion,
    string CurrentRowVersionHex,
    IReadOnlyList<VoucherAuditEvent> RecentEvents
);
