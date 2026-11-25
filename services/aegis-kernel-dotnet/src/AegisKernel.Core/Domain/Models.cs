using System.Security.Cryptography;
using System.Text;

namespace AegisKernel.Core.Domain;

public enum ConcurrencyMode
{
    NaiveUnprotected = 0,
    OptimisticCas = 1,
    AegisLockFreeChannel = 2
}

public enum OrderOutcomeStatus
{
    Allocated = 200,
    IdempotentReplay = 208,
    OutOfStock = 422,
    ConcurrencyExhausted = 4090,
    PayloadConflict409 = 409,
    RateLimited429 = 429,
    CircuitOpen503 = 503
}

public enum CircuitState
{
    Closed = 0,
    Open = 1,
    HalfOpen = 2
}

public sealed record ChaosProfile(
    int InjectedDbLatencyMs = 0,
    double FailureRatePercent = 0.0,
    bool ForceCircuitOpen = false,
    bool CacheStampedeActive = false
);

public sealed record OrderCommand(
    string SkuId,
    string UserId,
    int Quantity,
    string IdempotencyKey,
    ConcurrencyMode Mode = ConcurrencyMode.AegisLockFreeChannel
)
{
    public string ComputePayloadHash()
    {
        var raw = $"{SkuId.Trim().ToUpperInvariant()}|{UserId.Trim()}|{Quantity}";
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(raw));
        return Convert.ToHexString(bytes)[..16];
    }
}

public sealed record TraceSpan(
    string SpanId,
    string Name,
    string Component,
    long StartOffsetUs,
    long DurationUs,
    string Status,
    IReadOnlyDictionary<string, string> Attributes
);

public sealed record TransactionReceipt(
    string OrderId,
    string SkuId,
    string UserId,
    int Quantity,
    OrderOutcomeStatus Status,
    bool IsIdempotentReplay,
    int RemainingStockAfter,
    int CasRetries,
    long LatencyMicroseconds,
    string TraceId,
    ConcurrencyMode Mode,
    DateTimeOffset TimestampUtc,
    IReadOnlyList<TraceSpan> Spans
);

public sealed record TelemetrySnapshot(
    string SkuId,
    int InitialStock,
    int RemainingStock,
    long TotalRequests,
    long ConfirmedAllocations,
    long TotalUnitsAllocated,
    long OverAllocatedUnits,
    long IdempotentReplays,
    long PayloadConflicts409,
    long OutOfStockRejections,
    long RateLimitedRejections,
    long CircuitBreakerRejections,
    long TotalCasRetries,
    long WriteBehindQueueDepth,
    long WriteBehindFlushedCount,
    double P50LatencyUs,
    double P95LatencyUs,
    double P99LatencyUs,
    CircuitState CircuitState,
    ChaosProfile ActiveChaos,
    bool InvariantIntact
);

public sealed record BurstSimulationResult(
    ConcurrencyMode Mode,
    int ConcurrentRequests,
    int InitialStock,
    double ElapsedMilliseconds,
    double ThroughputRps,
    TelemetrySnapshot Snapshot,
    IReadOnlyList<TransactionReceipt> SampledTraces
);
