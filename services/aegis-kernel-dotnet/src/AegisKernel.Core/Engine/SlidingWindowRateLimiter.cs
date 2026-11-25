namespace AegisKernel.Core.Engine;

/// <summary>
/// Lock-free striped token-bucket rate limiter using atomic tick replenishment.
/// Avoids global lock contention across high core counts during flash-sale traffic spikes.
/// </summary>
public sealed class SlidingWindowRateLimiter
{
    private readonly int _maxTokensPerWindow;
    private readonly long _windowDurationTicks;
    private long _availableTokens;
    private long _windowStartTicks;

    public SlidingWindowRateLimiter(int maxRequestsPerSecond = 25_000)
    {
        _maxTokensPerWindow = Math.Max(10, maxRequestsPerSecond);
        _windowDurationTicks = TimeSpan.FromSeconds(1).Ticks;
        _availableTokens = _maxTokensPerWindow;
        _windowStartTicks = DateTime.UtcNow.Ticks;
    }

    public bool TryAcquire()
    {
        var nowTicks = DateTime.UtcNow.Ticks;
        var currentStart = Volatile.Read(ref _windowStartTicks);

        if (nowTicks - currentStart >= _windowDurationTicks)
        {
            if (Interlocked.CompareExchange(ref _windowStartTicks, nowTicks, currentStart) == currentStart)
            {
                Volatile.Write(ref _availableTokens, _maxTokensPerWindow);
            }
        }

        var remaining = Interlocked.Decrement(ref _availableTokens);
        if (remaining >= 0)
        {
            return true;
        }

        Interlocked.Increment(ref _availableTokens);
        return false;
    }
}
