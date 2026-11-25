using AegisKernel.Core.Domain;

namespace AegisKernel.Core.Engine;

/// <summary>
/// Production-grade thread-safe Adaptive Circuit Breaker (Closed -> Open -> HalfOpen).
/// Protects downstream SQL/Redis clusters from cascading failure during latency/lock storms.
/// </summary>
public sealed class AdaptiveCircuitBreaker
{
    private readonly int _failureThreshold;
    private readonly long _openCooldownTicks;
    private int _consecutiveFailures;
    private int _stateInt; // 0=Closed, 1=Open, 2=HalfOpen
    private long _openedAtTicks;

    public AdaptiveCircuitBreaker(int failureThreshold = 12, TimeSpan? openCooldown = null)
    {
        _failureThreshold = Math.Max(2, failureThreshold);
        _openCooldownTicks = (openCooldown ?? TimeSpan.FromSeconds(3)).Ticks;
    }

    public CircuitState CurrentState => (CircuitState)Volatile.Read(ref _stateInt);

    public bool AllowRequest(bool forceOpen = false)
    {
        if (forceOpen)
        {
            return false;
        }

        var state = (CircuitState)Volatile.Read(ref _stateInt);
        if (state == CircuitState.Closed)
        {
            return true;
        }

        if (state == CircuitState.Open)
        {
            var elapsed = DateTime.UtcNow.Ticks - Volatile.Read(ref _openedAtTicks);
            if (elapsed >= _openCooldownTicks)
            {
                if (Interlocked.CompareExchange(ref _stateInt, (int)CircuitState.HalfOpen, (int)CircuitState.Open) == (int)CircuitState.Open)
                {
                    return true; // Single probe request allowed through
                }
            }
            return false;
        }

        // HalfOpen allows lightweight probe traffic
        return true;
    }

    public void RecordSuccess()
    {
        Interlocked.Exchange(ref _consecutiveFailures, 0);
        Volatile.Write(ref _stateInt, (int)CircuitState.Closed);
    }

    public void RecordFailure()
    {
        var failures = Interlocked.Increment(ref _consecutiveFailures);
        var current = (CircuitState)Volatile.Read(ref _stateInt);

        if (current == CircuitState.HalfOpen || failures >= _failureThreshold)
        {
            Volatile.Write(ref _openedAtTicks, DateTime.UtcNow.Ticks);
            Volatile.Write(ref _stateInt, (int)CircuitState.Open);
        }
    }

    public void Reset()
    {
        Interlocked.Exchange(ref _consecutiveFailures, 0);
        Volatile.Write(ref _stateInt, (int)CircuitState.Closed);
    }
}
