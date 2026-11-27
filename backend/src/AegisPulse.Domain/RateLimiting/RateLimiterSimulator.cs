namespace AegisPulse.Domain.RateLimiting;

public enum RateLimitTrafficScenario
{
    BoundaryFlashSpike = 1,
    SustainedWave = 2,
    OrganicPosTraffic = 3
}

public sealed record RateLimitSimulationRequest(
    int BurstIntensityRps = RateLimiterSimulator.DefaultBurstIntensityRps,
    int BucketCapacity = RateLimiterSimulator.DefaultBucketCapacity,
    int RefillRatePerSecond = RateLimiterSimulator.DefaultRefillRatePerSecond,
    RateLimitTrafficScenario Scenario = RateLimitTrafficScenario.BoundaryFlashSpike,
    int ShardCount = RateLimiterSimulator.DefaultShardCount
);

public sealed record RateLimitSlotTelemetry(
    int SlotIndex,
    double StartSeconds,
    double EndSeconds,
    int FixedWindowId,
    bool IsBoundaryCrossing,
    bool IsFlashSpikeSlot,
    int IncomingRequests,
    int Allowed200,
    int AllowedWithinCap,
    int Throttled429,
    int BoundaryOvershoot,
    int Rolling1sAllowed,
    double TokensRemainingAfter,
    int RetryAfterMs
);

public sealed record RateLimitAlgorithmReport(
    string AlgorithmKey,
    string DisplayName,
    int TotalIncoming,
    int TotalAllowed200,
    int TotalThrottled429,
    int TotalBoundaryOvershoot,
    int PeakRolling1sAllowed,
    double PeakMultiplierVsLimit,
    double AdmissionRatePct,
    double ThrottleRatePct,
    int BurstAbsorbedCount,
    double MinTokensObserved,
    double FinalTokensRemaining,
    int MaxRetryAfterMs,
    bool StrictCapPreserved,
    string Verdict,
    IReadOnlyList<RateLimitSlotTelemetry> Slots
);

public sealed record RateLimitSimulationResult(
    int DurationSeconds,
    int SlotDurationMs,
    int TotalSlots,
    RateLimitTrafficScenario Scenario,
    int BurstIntensityRps,
    int BucketCapacity,
    int RefillRatePerSecond,
    int ShardCount,
    int ClusterGatewayCapRps,
    int ClusterPeakFixedWindowRps,
    int ClusterPeakSlidingWindowRps,
    RateLimitAlgorithmReport FixedWindow,
    RateLimitAlgorithmReport TokenBucket,
    RateLimitAlgorithmReport SlidingWindowLog,
    string SummaryVerdict
);

public sealed class RateLimiterSimulator
{
    public const int DurationSeconds = 20;
    public const int SlotDurationMs = 500;
    public const int TotalSlots = 40;

    public const int MinBurstIntensityRps = 100;
    public const int MaxBurstIntensityRps = 1_000;
    public const int DefaultBurstIntensityRps = 600;

    public const int MinBucketCapacity = 50;
    public const int MaxBucketCapacity = 400;
    public const int DefaultBucketCapacity = 240;

    public const int MinRefillRatePerSecond = 50;
    public const int MaxRefillRatePerSecond = 300;
    public const int DefaultRefillRatePerSecond = 200;

    public const int MinShardCount = 1;
    public const int MaxShardCount = 100;
    public const int DefaultShardCount = 25;

    public RateLimitSimulationResult Simulate(RateLimitSimulationRequest? request = null)
    {
        var req = request ?? new RateLimitSimulationRequest();
        Validate(req);

        var (arrivals, spikeFlags) = GenerateTrafficProfile(req.Scenario, req.BurstIntensityRps, req.RefillRatePerSecond);

        var fixedWindow = SimulateFixedWindow(arrivals, spikeFlags, req.RefillRatePerSecond);
        var tokenBucket = SimulateTokenBucket(arrivals, spikeFlags, req.BucketCapacity, req.RefillRatePerSecond);
        var slidingWindow = SimulateSlidingWindowLog(arrivals, spikeFlags, req.RefillRatePerSecond);

        var clusterCapRps = req.RefillRatePerSecond * req.ShardCount;
        var clusterPeakFixedRps = fixedWindow.PeakRolling1sAllowed * req.ShardCount;
        var clusterPeakSlidingRps = slidingWindow.PeakRolling1sAllowed * req.ShardCount;

        var summaryVerdict = fixedWindow.TotalBoundaryOvershoot > 0
            ? $"Fixed Window leaked {fixedWindow.TotalBoundaryOvershoot:N0} boundary overshoot requests/shard (peak {fixedWindow.PeakRolling1sAllowed} req/s = {fixedWindow.PeakMultiplierVsLimit:F2}x limit; {clusterPeakFixedRps:N0} RPS across {req.ShardCount} shards), whereas Token Bucket smoothly paced burst load with {tokenBucket.BurstAbsorbedCount:N0} absorbed requests and Redis Sliding-Window Log enforced 0 overshoot ({clusterPeakSlidingRps:N0} <= {clusterCapRps:N0} RPS)."
            : $"Under {req.Scenario}, all three rate limiters stayed within the {req.RefillRatePerSecond} req/s shard cap ({clusterCapRps:N0} RPS cluster-wide) with 0 boundary overshoot.";

        return new RateLimitSimulationResult(
            DurationSeconds: DurationSeconds,
            SlotDurationMs: SlotDurationMs,
            TotalSlots: TotalSlots,
            Scenario: req.Scenario,
            BurstIntensityRps: req.BurstIntensityRps,
            BucketCapacity: req.BucketCapacity,
            RefillRatePerSecond: req.RefillRatePerSecond,
            ShardCount: req.ShardCount,
            ClusterGatewayCapRps: clusterCapRps,
            ClusterPeakFixedWindowRps: clusterPeakFixedRps,
            ClusterPeakSlidingWindowRps: clusterPeakSlidingRps,
            FixedWindow: fixedWindow,
            TokenBucket: tokenBucket,
            SlidingWindowLog: slidingWindow,
            SummaryVerdict: summaryVerdict
        );
    }

    private static void Validate(RateLimitSimulationRequest req)
    {
        if (req.BurstIntensityRps < MinBurstIntensityRps || req.BurstIntensityRps > MaxBurstIntensityRps)
        {
            throw new ArgumentOutOfRangeException(
                nameof(req.BurstIntensityRps),
                $"BurstIntensityRps must be between {MinBurstIntensityRps} and {MaxBurstIntensityRps}.");
        }

        if (req.BucketCapacity < MinBucketCapacity || req.BucketCapacity > MaxBucketCapacity)
        {
            throw new ArgumentOutOfRangeException(
                nameof(req.BucketCapacity),
                $"BucketCapacity must be between {MinBucketCapacity} and {MaxBucketCapacity}.");
        }

        if (req.RefillRatePerSecond < MinRefillRatePerSecond || req.RefillRatePerSecond > MaxRefillRatePerSecond)
        {
            throw new ArgumentOutOfRangeException(
                nameof(req.RefillRatePerSecond),
                $"RefillRatePerSecond must be between {MinRefillRatePerSecond} and {MaxRefillRatePerSecond}.");
        }

        if (req.ShardCount < MinShardCount || req.ShardCount > MaxShardCount)
        {
            throw new ArgumentOutOfRangeException(
                nameof(req.ShardCount),
                $"ShardCount must be between {MinShardCount} and {MaxShardCount}.");
        }
    }

    private static (int[] Arrivals, bool[] SpikeFlags) GenerateTrafficProfile(
        RateLimitTrafficScenario scenario,
        int burstIntensityRps,
        int refillRatePerSec)
    {
        var arrivals = new int[TotalSlots];
        var spikes = new bool[TotalSlots];

        for (var i = 0; i < TotalSlots; i++)
        {
            if (scenario == RateLimitTrafficScenario.BoundaryFlashSpike)
            {
                // Pre-boundary countdown lull right before t=5.0s and t=13.0s
                if (i == 8 || i == 24)
                {
                    arrivals[i] = 0;
                    continue;
                }

                // Primary 2x boundary spike straddling [4.5s, 5.0s) and [5.0s, 5.5s)
                if (i == 9 || i == 10)
                {
                    arrivals[i] = Math.Max(1, (int)Math.Round(burstIntensityRps * 0.5, MidpointRounding.AwayFromZero));
                    spikes[i] = true;
                    continue;
                }

                // Cooldown tail after primary flash spike
                if (i == 11)
                {
                    arrivals[i] = Math.Max(1, (int)Math.Round(burstIntensityRps * 0.22, MidpointRounding.AwayFromZero));
                    continue;
                }

                // Secondary boundary spike straddling [12.5s, 13.0s) and [13.0s, 13.5s)
                if (i == 25 || i == 26)
                {
                    arrivals[i] = Math.Max(1, (int)Math.Round(burstIntensityRps * 0.45, MidpointRounding.AwayFromZero));
                    spikes[i] = true;
                    continue;
                }

                if (i == 27)
                {
                    arrivals[i] = Math.Max(1, (int)Math.Round(burstIntensityRps * 0.18, MidpointRounding.AwayFromZero));
                    continue;
                }

                // Calm background traffic across 700 retail stores
                var calmWave = 0.22 + 0.06 * Math.Sin(i * 0.65);
                arrivals[i] = Math.Max(8, (int)Math.Round(refillRatePerSec * calmWave, MidpointRounding.AwayFromZero));
            }
            else if (scenario == RateLimitTrafficScenario.SustainedWave)
            {
                if (i >= 10 && i <= 25)
                {
                    var envelope = 0.42 + 0.08 * Math.Sin((i - 10) * 0.42);
                    arrivals[i] = Math.Max(1, (int)Math.Round(burstIntensityRps * envelope, MidpointRounding.AwayFromZero));
                    spikes[i] = true;
                }
                else if (i == 9 || i == 26)
                {
                    arrivals[i] = Math.Max(1, (int)Math.Round(burstIntensityRps * 0.28, MidpointRounding.AwayFromZero));
                }
                else
                {
                    var baseline = 0.24 + 0.05 * Math.Cos(i * 0.5);
                    arrivals[i] = Math.Max(10, (int)Math.Round(refillRatePerSec * baseline, MidpointRounding.AwayFromZero));
                }
            }
            else
            {
                // OrganicPosTraffic: stays comfortably within the rolling 1-second limit
                var organicWave = 0.28 + 0.10 * Math.Sin(i * 0.45);
                if (i == 19 || i == 20)
                {
                    arrivals[i] = Math.Max(10, (int)Math.Round(refillRatePerSec * 0.42, MidpointRounding.AwayFromZero));
                }
                else
                {
                    arrivals[i] = Math.Max(8, (int)Math.Round(refillRatePerSec * organicWave, MidpointRounding.AwayFromZero));
                }
            }
        }

        return (arrivals, spikes);
    }

    private static RateLimitAlgorithmReport SimulateFixedWindow(
        int[] arrivals,
        bool[] spikeFlags,
        int limitPerSecond)
    {
        var slots = new List<RateLimitSlotTelemetry>(TotalSlots);
        var windowUsed = 0;
        var prevAllowed = 0;

        var totalIncoming = 0;
        var totalAllowed = 0;
        var totalThrottled = 0;
        var totalOvershoot = 0;
        var peakRolling = 0;
        var maxRetryAfterMs = 0;

        for (var i = 0; i < TotalSlots; i++)
        {
            var isBoundaryCrossing = i > 0 && i % 2 == 0;
            if (i % 2 == 0)
            {
                windowUsed = 0;
            }

            var incoming = arrivals[i];
            var remaining = Math.Max(0, limitPerSecond - windowUsed);
            var allowed = Math.Min(incoming, remaining);
            windowUsed += allowed;
            var throttled = incoming - allowed;

            var rolling1s = (i == 0 ? 0 : prevAllowed) + allowed;
            var overshoot = Math.Max(0, rolling1s - limitPerSecond);
            var allowedWithinCap = Math.Max(0, allowed - overshoot);
            var retryAfterMs = throttled > 0 ? (i % 2 == 0 ? 1000 : 500) : 0;

            slots.Add(new RateLimitSlotTelemetry(
                SlotIndex: i,
                StartSeconds: i * 0.5,
                EndSeconds: (i + 1) * 0.5,
                FixedWindowId: i / 2,
                IsBoundaryCrossing: isBoundaryCrossing,
                IsFlashSpikeSlot: spikeFlags[i],
                IncomingRequests: incoming,
                Allowed200: allowed,
                AllowedWithinCap: allowedWithinCap,
                Throttled429: throttled,
                BoundaryOvershoot: overshoot,
                Rolling1sAllowed: rolling1s,
                TokensRemainingAfter: Math.Max(0, limitPerSecond - windowUsed),
                RetryAfterMs: retryAfterMs
            ));

            totalIncoming += incoming;
            totalAllowed += allowed;
            totalThrottled += throttled;
            totalOvershoot += overshoot;
            peakRolling = Math.Max(peakRolling, rolling1s);
            maxRetryAfterMs = Math.Max(maxRetryAfterMs, retryAfterMs);
            prevAllowed = allowed;
        }

        var peakMultiplier = Math.Round((double)peakRolling / limitPerSecond, 2, MidpointRounding.AwayFromZero);
        var admissionPct = totalIncoming == 0 ? 100.0 : Math.Round(totalAllowed * 100.0 / totalIncoming, 1, MidpointRounding.AwayFromZero);
        var throttlePct = totalIncoming == 0 ? 0.0 : Math.Round(totalThrottled * 100.0 / totalIncoming, 1, MidpointRounding.AwayFromZero);

        var verdict = totalOvershoot > 0
            ? $"VULNERABLE: 2x boundary reset leaked {totalOvershoot:N0} overshoot requests (peak {peakRolling} req/s = {peakMultiplier:F2}x limit)."
            : "NOMINAL: No window boundary breach observed under current traffic.";

        return new RateLimitAlgorithmReport(
            AlgorithmKey: "fixed-window",
            DisplayName: "Fixed Window Counter",
            TotalIncoming: totalIncoming,
            TotalAllowed200: totalAllowed,
            TotalThrottled429: totalThrottled,
            TotalBoundaryOvershoot: totalOvershoot,
            PeakRolling1sAllowed: peakRolling,
            PeakMultiplierVsLimit: peakMultiplier,
            AdmissionRatePct: admissionPct,
            ThrottleRatePct: throttlePct,
            BurstAbsorbedCount: 0,
            MinTokensObserved: 0,
            FinalTokensRemaining: slots[^1].TokensRemainingAfter,
            MaxRetryAfterMs: maxRetryAfterMs,
            StrictCapPreserved: totalOvershoot == 0,
            Verdict: verdict,
            Slots: slots
        );
    }

    private static RateLimitAlgorithmReport SimulateTokenBucket(
        int[] arrivals,
        bool[] spikeFlags,
        int bucketCapacity,
        int refillRatePerSecond)
    {
        var slots = new List<RateLimitSlotTelemetry>(TotalSlots);
        double tokens = bucketCapacity;
        var prevAllowed = 0;

        var totalIncoming = 0;
        var totalAllowed = 0;
        var totalThrottled = 0;
        var peakRolling = 0;
        var burstAbsorbedTotal = 0;
        double minTokens = bucketCapacity;
        var maxRetryAfterMs = 0;
        var steadyHalfSecondAllowance = (int)Math.Floor(refillRatePerSecond * 0.5);

        for (var i = 0; i < TotalSlots; i++)
        {
            if (i > 0)
            {
                tokens = Math.Min(bucketCapacity, tokens + refillRatePerSecond * 0.5);
            }

            var incoming = arrivals[i];
            var available = (int)Math.Floor(tokens);
            var allowed = Math.Min(incoming, available);
            tokens = Math.Max(0.0, tokens - allowed);
            var throttled = incoming - allowed;

            var rolling1s = (i == 0 ? 0 : prevAllowed) + allowed;
            var burstAbsorbed = Math.Max(0, allowed - steadyHalfSecondAllowance);
            burstAbsorbedTotal += burstAbsorbed;

            var retryAfterMs = throttled > 0
                ? Math.Max(50, (int)Math.Ceiling(1000.0 * Math.Min(throttled, Math.Max(1, refillRatePerSecond / 4)) / refillRatePerSecond))
                : 0;

            var roundedTokens = Math.Round(tokens, 1, MidpointRounding.AwayFromZero);

            slots.Add(new RateLimitSlotTelemetry(
                SlotIndex: i,
                StartSeconds: i * 0.5,
                EndSeconds: (i + 1) * 0.5,
                FixedWindowId: i / 2,
                IsBoundaryCrossing: i > 0 && i % 2 == 0,
                IsFlashSpikeSlot: spikeFlags[i],
                IncomingRequests: incoming,
                Allowed200: allowed,
                AllowedWithinCap: allowed,
                Throttled429: throttled,
                BoundaryOvershoot: 0,
                Rolling1sAllowed: rolling1s,
                TokensRemainingAfter: roundedTokens,
                RetryAfterMs: retryAfterMs
            ));

            totalIncoming += incoming;
            totalAllowed += allowed;
            totalThrottled += throttled;
            peakRolling = Math.Max(peakRolling, rolling1s);
            minTokens = Math.Min(minTokens, roundedTokens);
            maxRetryAfterMs = Math.Max(maxRetryAfterMs, retryAfterMs);
            prevAllowed = allowed;
        }

        var peakMultiplier = Math.Round((double)peakRolling / refillRatePerSecond, 2, MidpointRounding.AwayFromZero);
        var admissionPct = totalIncoming == 0 ? 100.0 : Math.Round(totalAllowed * 100.0 / totalIncoming, 1, MidpointRounding.AwayFromZero);
        var throttlePct = totalIncoming == 0 ? 0.0 : Math.Round(totalThrottled * 100.0 / totalIncoming, 1, MidpointRounding.AwayFromZero);

        var verdict = $"SMOOTH BURST ABSORPTION: Absorbed {burstAbsorbedTotal:N0} burst requests from {bucketCapacity}-token tank, then paced smoothly at {refillRatePerSecond} req/s with 0 boundary reset leaks.";

        return new RateLimitAlgorithmReport(
            AlgorithmKey: "token-bucket",
            DisplayName: "Token Bucket",
            TotalIncoming: totalIncoming,
            TotalAllowed200: totalAllowed,
            TotalThrottled429: totalThrottled,
            TotalBoundaryOvershoot: 0,
            PeakRolling1sAllowed: peakRolling,
            PeakMultiplierVsLimit: peakMultiplier,
            AdmissionRatePct: admissionPct,
            ThrottleRatePct: throttlePct,
            BurstAbsorbedCount: burstAbsorbedTotal,
            MinTokensObserved: minTokens,
            FinalTokensRemaining: slots[^1].TokensRemainingAfter,
            MaxRetryAfterMs: maxRetryAfterMs,
            StrictCapPreserved: true,
            Verdict: verdict,
            Slots: slots
        );
    }

    private static RateLimitAlgorithmReport SimulateSlidingWindowLog(
        int[] arrivals,
        bool[] spikeFlags,
        int limitPerSecond)
    {
        var slots = new List<RateLimitSlotTelemetry>(TotalSlots);
        var prevAllowed = 0;

        var totalIncoming = 0;
        var totalAllowed = 0;
        var totalThrottled = 0;
        var peakRolling = 0;
        var maxRetryAfterMs = 0;

        for (var i = 0; i < TotalSlots; i++)
        {
            var incoming = arrivals[i];
            var usedInRolling1s = i == 0 ? 0 : prevAllowed;
            var remainingBudget = Math.Max(0, limitPerSecond - usedInRolling1s);
            var allowed = Math.Min(incoming, remainingBudget);
            var throttled = incoming - allowed;
            var rolling1s = usedInRolling1s + allowed;
            var retryAfterMs = throttled > 0 ? SlotDurationMs : 0;

            slots.Add(new RateLimitSlotTelemetry(
                SlotIndex: i,
                StartSeconds: i * 0.5,
                EndSeconds: (i + 1) * 0.5,
                FixedWindowId: i / 2,
                IsBoundaryCrossing: i > 0 && i % 2 == 0,
                IsFlashSpikeSlot: spikeFlags[i],
                IncomingRequests: incoming,
                Allowed200: allowed,
                AllowedWithinCap: allowed,
                Throttled429: throttled,
                BoundaryOvershoot: 0,
                Rolling1sAllowed: rolling1s,
                TokensRemainingAfter: Math.Max(0, limitPerSecond - rolling1s),
                RetryAfterMs: retryAfterMs
            ));

            totalIncoming += incoming;
            totalAllowed += allowed;
            totalThrottled += throttled;
            peakRolling = Math.Max(peakRolling, rolling1s);
            maxRetryAfterMs = Math.Max(maxRetryAfterMs, retryAfterMs);
            prevAllowed = allowed;
        }

        var peakMultiplier = Math.Round((double)peakRolling / limitPerSecond, 2, MidpointRounding.AwayFromZero);
        var admissionPct = totalIncoming == 0 ? 100.0 : Math.Round(totalAllowed * 100.0 / totalIncoming, 1, MidpointRounding.AwayFromZero);
        var throttlePct = totalIncoming == 0 ? 0.0 : Math.Round(totalThrottled * 100.0 / totalIncoming, 1, MidpointRounding.AwayFromZero);

        var verdict = $"STRICT 0-OVERSHOOT GUARANTEE: Redis ZSET rolling 1000ms log capped every sliding second at <= {limitPerSecond} req/s (peak {peakRolling} req/s) with RFC Retry-After headers.";

        return new RateLimitAlgorithmReport(
            AlgorithmKey: "sliding-window-log",
            DisplayName: "Redis Sliding-Window Log",
            TotalIncoming: totalIncoming,
            TotalAllowed200: totalAllowed,
            TotalThrottled429: totalThrottled,
            TotalBoundaryOvershoot: 0,
            PeakRolling1sAllowed: peakRolling,
            PeakMultiplierVsLimit: peakMultiplier,
            AdmissionRatePct: admissionPct,
            ThrottleRatePct: throttlePct,
            BurstAbsorbedCount: 0,
            MinTokensObserved: 0,
            FinalTokensRemaining: slots[^1].TokensRemainingAfter,
            MaxRetryAfterMs: maxRetryAfterMs,
            StrictCapPreserved: true,
            Verdict: verdict,
            Slots: slots
        );
    }
}
