namespace AegisPulse.Domain.Sre;

public enum RaftNodeRole
{
    Leader,
    Follower,
    Partitioned,
    Fenced
}

public sealed record RaftRegionNode(
    string RegionId,
    string DisplayName,
    int BaseLatencyMs,
    bool Reachable,
    RaftNodeRole Role,
    long FencingToken
);

public sealed record RaftClusterStatus(
    string QuorumStatus,
    int TotalNodes,
    int QuorumRequired,
    int ReachableNodes,
    bool HasQuorum,
    bool SplitBrainWriteFenceActive,
    string? LeaderRegionId,
    long RaftTerm,
    IReadOnlyList<RaftRegionNode> Regions
);

/// <summary>
/// 5-Region Raft Consensus Quorum Health Evaluator with monotonic fencing tokens and split-brain write fencing.
/// </summary>
public sealed class RaftQuorumEvaluator
{
    private sealed class MutableRegion
    {
        public required string RegionId { get; init; }
        public required string DisplayName { get; init; }
        public required int BaseLatencyMs { get; init; }
        public bool Reachable { get; set; } = true;
    }

    private readonly Lock _lock = new();
    private readonly List<MutableRegion> _regions =
    [
        new() { RegionId = "ap-southeast-1", DisplayName = "Singapore (Con Cung Primary)", BaseLatencyMs = 8 },
        new() { RegionId = "ap-northeast-1", DisplayName = "Tokyo (APAC Standby)", BaseLatencyMs = 42 },
        new() { RegionId = "us-east-1", DisplayName = "Virginia (US East)", BaseLatencyMs = 178 },
        new() { RegionId = "eu-central-1", DisplayName = "Frankfurt (EU Central)", BaseLatencyMs = 152 },
        new() { RegionId = "ap-south-1", DisplayName = "Mumbai (South Asia)", BaseLatencyMs = 58 }
    ];

    private string? _leaderRegionId = "ap-southeast-1";
    private long _raftTerm = 42;

    public static int CalculateQuorum(int totalNodes) => (totalNodes / 2) + 1;

    public RaftClusterStatus GetStatus()
    {
        lock (_lock)
        {
            return BuildStatusLocked();
        }
    }

    public RaftClusterStatus PartitionRegion(string regionId)
    {
        lock (_lock)
        {
            var target = _regions.FirstOrDefault(r => string.Equals(r.RegionId, regionId, StringComparison.OrdinalIgnoreCase));
            if (target is null)
            {
                throw new ArgumentException($"Unknown region '{regionId}'.", nameof(regionId));
            }

            if (target.Reachable)
            {
                target.Reachable = false;
                ReconcileElectionLocked();
            }

            return BuildStatusLocked();
        }
    }

    public RaftClusterStatus RestoreRegion(string regionId)
    {
        lock (_lock)
        {
            var target = _regions.FirstOrDefault(r => string.Equals(r.RegionId, regionId, StringComparison.OrdinalIgnoreCase));
            if (target is null)
            {
                throw new ArgumentException($"Unknown region '{regionId}'.", nameof(regionId));
            }

            if (!target.Reachable)
            {
                target.Reachable = true;
                ReconcileElectionLocked();
            }

            return BuildStatusLocked();
        }
    }

    public RaftClusterStatus RestoreAll()
    {
        lock (_lock)
        {
            foreach (var r in _regions)
            {
                r.Reachable = true;
            }

            if (_leaderRegionId is null)
            {
                _raftTerm++;
                _leaderRegionId = _regions[0].RegionId;
            }

            return BuildStatusLocked();
        }
    }

    private void ReconcileElectionLocked()
    {
        var quorum = CalculateQuorum(_regions.Count);
        var reachable = _regions.Where(r => r.Reachable).ToList();

        if (reachable.Count < quorum)
        {
            _leaderRegionId = null;
            return;
        }

        var leaderStillAlive = _leaderRegionId is not null &&
                               reachable.Any(r => string.Equals(r.RegionId, _leaderRegionId, StringComparison.OrdinalIgnoreCase));

        if (!leaderStillAlive)
        {
            _raftTerm++;
            _leaderRegionId = reachable[0].RegionId;
        }
    }

    private RaftClusterStatus BuildStatusLocked()
    {
        var total = _regions.Count;
        var quorum = CalculateQuorum(total);
        var reachableCount = _regions.Count(r => r.Reachable);
        var hasQuorum = reachableCount >= quorum;
        var fenced = !hasQuorum;

        var status = !hasQuorum
            ? "QUORUM_LOST"
            : reachableCount == total
                ? "HEALTHY"
                : reachableCount == quorum
                    ? "MINIMAL_QUORUM"
                    : "DEGRADED";

        var nodes = _regions.Select(r =>
        {
            var role = !r.Reachable
                ? RaftNodeRole.Partitioned
                : fenced
                    ? RaftNodeRole.Fenced
                    : string.Equals(r.RegionId, _leaderRegionId, StringComparison.OrdinalIgnoreCase)
                        ? RaftNodeRole.Leader
                        : RaftNodeRole.Follower;

            return new RaftRegionNode(
                RegionId: r.RegionId,
                DisplayName: r.DisplayName,
                BaseLatencyMs: r.BaseLatencyMs,
                Reachable: r.Reachable,
                Role: role,
                FencingToken: _raftTerm
            );
        }).ToList();

        return new RaftClusterStatus(
            QuorumStatus: status,
            TotalNodes: total,
            QuorumRequired: quorum,
            ReachableNodes: reachableCount,
            HasQuorum: hasQuorum,
            SplitBrainWriteFenceActive: fenced,
            LeaderRegionId: _leaderRegionId,
            RaftTerm: _raftTerm,
            Regions: nodes
        );
    }
}
