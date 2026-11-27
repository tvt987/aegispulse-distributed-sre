namespace AegisPulse.Domain.Sre;

public enum CircuitBreakerState
{
    Closed,
    Open,
    HalfOpen
}

public sealed record CircuitBreakerSnapshot(
    CircuitBreakerState State,
    int ConsecutiveFailures,
    int FailureThreshold,
    double OpenCooldownSeconds,
    DateTimeOffset? OpenedAtUtc
);

/// <summary>
/// Thread-safe Adaptive Circuit Breaker state machine (Closed -> Open -> HalfOpen -> Closed).
/// Uses .NET TimeProvider for deterministic testing without flakiness.
/// </summary>
public sealed class CircuitBreakerStateMachine
{
    private readonly Lock _lock = new();
    private readonly int _failureThreshold;
    private readonly TimeSpan _openCooldown;
    private readonly TimeProvider _timeProvider;

    private CircuitBreakerState _state = CircuitBreakerState.Closed;
    private int _consecutiveFailures;
    private DateTimeOffset? _openedAtUtc;

    public CircuitBreakerStateMachine(
        int failureThreshold = 5,
        TimeSpan? openCooldown = null,
        TimeProvider? timeProvider = null)
    {
        if (failureThreshold <= 0)
        {
            throw new ArgumentOutOfRangeException(nameof(failureThreshold), "Failure threshold must be positive.");
        }

        _failureThreshold = failureThreshold;
        _openCooldown = openCooldown ?? TimeSpan.FromSeconds(15);
        _timeProvider = timeProvider ?? TimeProvider.System;
    }

    public CircuitBreakerState CurrentState
    {
        get
        {
            lock (_lock)
            {
                EvaluateHalfOpenTransitionLocked();
                return _state;
            }
        }
    }

    public bool AllowRequest()
    {
        lock (_lock)
        {
            EvaluateHalfOpenTransitionLocked();
            return _state is CircuitBreakerState.Closed or CircuitBreakerState.HalfOpen;
        }
    }

    public void RecordSuccess()
    {
        lock (_lock)
        {
            _consecutiveFailures = 0;
            _openedAtUtc = null;
            _state = CircuitBreakerState.Closed;
        }
    }

    public void RecordFailure()
    {
        lock (_lock)
        {
            if (_state == CircuitBreakerState.HalfOpen)
            {
                TripOpenLocked();
                return;
            }

            _consecutiveFailures++;
            if (_consecutiveFailures >= _failureThreshold)
            {
                TripOpenLocked();
            }
        }
    }

    public void ForceOpen()
    {
        lock (_lock)
        {
            TripOpenLocked();
        }
    }

    public void Reset()
    {
        lock (_lock)
        {
            _state = CircuitBreakerState.Closed;
            _consecutiveFailures = 0;
            _openedAtUtc = null;
        }
    }

    public CircuitBreakerSnapshot GetSnapshot()
    {
        lock (_lock)
        {
            EvaluateHalfOpenTransitionLocked();
            return new CircuitBreakerSnapshot(
                State: _state,
                ConsecutiveFailures: _consecutiveFailures,
                FailureThreshold: _failureThreshold,
                OpenCooldownSeconds: _openCooldown.TotalSeconds,
                OpenedAtUtc: _openedAtUtc
            );
        }
    }

    private void EvaluateHalfOpenTransitionLocked()
    {
        if (_state == CircuitBreakerState.Open && _openedAtUtc.HasValue)
        {
            if (_timeProvider.GetUtcNow() - _openedAtUtc.Value >= _openCooldown)
            {
                _state = CircuitBreakerState.HalfOpen;
            }
        }
    }

    private void TripOpenLocked()
    {
        _state = CircuitBreakerState.Open;
        _openedAtUtc = _timeProvider.GetUtcNow();
    }
}
