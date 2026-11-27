namespace AegisPulse.Domain.Sre;

public enum QuorumRegionHealthState
{
    Online,
    Partitioned,
    HardCrash
}

public enum QuorumNodeRole
{
    Leader,
    Follower,
    Partitioned,
    Crashed,
    Fenced
}

public sealed record QuorumRegionDefinition(
    string RegionId,
    string DisplayName,
    string Location,
    int Priority,
    int BaseWalLagMs
);

public sealed record QuorumNodeSnapshot(
    string RegionId,
    string DisplayName,
    string Location,
    QuorumRegionHealthState State,
    QuorumNodeRole Role,
    int RttToLeaderMs,
    double WalReplicationLagMs,
    long FencingToken,
    bool AcceptsWrites
);

public sealed record QuorumEvaluationRequest(
    long CurrentTerm = 42,
    string? PreviousLeaderId = "vn-hcm",
    IReadOnlyDictionary<string, QuorumRegionHealthState>? RegionStates = null
);

public sealed record QuorumEvaluationResult(
    int TotalNodes,
    int QuorumRequired,
    int OnlineNodes,
    int PartitionedNodes,
    int CrashedNodes,
    bool HasQuorum,
    string ClusterWriteMode,
    bool SplitBrainFenceActive,
    bool DoubleSpendPrevented,
    string? ElectedLeaderRegionId,
    string? ElectedLeaderName,
    long RaftTerm,
    bool ElectionTriggered,
    int QuorumCommitRttMs,
    double MaxWalReplicationLagMs,
    double RpoSeconds,
    int? RtoMs,
    string RtoSummary,
    string DecisionReason,
    IReadOnlyList<QuorumNodeSnapshot> Nodes
);

/// <summary>
/// Deterministic 5-Region Raft Quorum & Split-Brain Failover Evaluator
/// (VN-HCM Primary, SG-1, JP-Tokyo, US-East, EU-West).
/// Enforces automatic READ_ONLY_FENCE when fewer than 3/5 nodes survive,
/// preventing dual-writer voucher double-spending during network partitions.
/// </summary>
public sealed class QuorumFailoverEvaluator
{
    public static readonly IReadOnlyList<QuorumRegionDefinition> Regions =
    [
        new("vn-hcm", "VN-HCM Primary", "Ho Chi Minh City, VN", 1, 0),
        new("sg-1", "SG-1", "Singapore", 2, 4),
        new("jp-tokyo", "JP-Tokyo", "Tokyo, JP", 3, 12),
        new("us-east", "US-East", "Virginia, US", 4, 28),
        new("eu-west", "EU-West", "Dublin, IE", 5, 24)
    ];

    private static readonly Dictionary<string, int> PairwiseRttMs = new(StringComparer.OrdinalIgnoreCase)
    {
        ["vn-hcm|sg-1"] = 24,
        ["vn-hcm|jp-tokyo"] = 68,
        ["vn-hcm|us-east"] = 212,
        ["vn-hcm|eu-west"] = 176,
        ["sg-1|jp-tokyo"] = 64,
        ["sg-1|us-east"] = 218,
        ["sg-1|eu-west"] = 162,
        ["jp-tokyo|us-east"] = 148,
        ["jp-tokyo|eu-west"] = 215,
        ["us-east|eu-west"] = 74
    };

    public static int GetPairwiseRttMs(string a, string b)
    {
        if (string.Equals(a, b, StringComparison.OrdinalIgnoreCase)) return 0;
        if (PairwiseRttMs.TryGetValue($"{a}|{b}", out var direct)) return direct;
        if (PairwiseRttMs.TryGetValue($"{b}|{a}", out var reverse)) return reverse;
        return 120;
    }

    public QuorumEvaluationResult Evaluate(QuorumEvaluationRequest request)
    {
        var stateMap = new Dictionary<string, QuorumRegionHealthState>(StringComparer.OrdinalIgnoreCase);
        foreach (var def in Regions)
        {
            stateMap[def.RegionId] = QuorumRegionHealthState.Online;
        }

        if (request.RegionStates is not null)
        {
            foreach (var kv in request.RegionStates)
            {
                if (!stateMap.ContainsKey(kv.Key))
                {
                    throw new ArgumentException($"Unknown region ID '{kv.Key}'. Valid regions: vn-hcm, sg-1, jp-tokyo, us-east, eu-west.");
                }

                stateMap[kv.Key] = kv.Value;
            }
        }

        var totalNodes = Regions.Count;
        var quorumRequired = (totalNodes / 2) + 1; // 3 of 5
        var onlineRegions = Regions
            .Where(r => stateMap[r.RegionId] == QuorumRegionHealthState.Online)
            .OrderBy(r => r.Priority)
            .ToList();

        var onlineCount = onlineRegions.Count;
        var partitionedCount = Regions.Count(r => stateMap[r.RegionId] == QuorumRegionHealthState.Partitioned);
        var crashedCount = Regions.Count(r => stateMap[r.RegionId] == QuorumRegionHealthState.HardCrash);

        var hasQuorum = onlineCount >= quorumRequired;
        var currentTerm = Math.Max(1L, request.CurrentTerm);
        var prevLeader = string.IsNullOrWhiteSpace(request.PreviousLeaderId) ? null : request.PreviousLeaderId.Trim().ToLowerInvariant();

        string? electedLeaderId = null;
        string? electedLeaderName = null;
        var nextTerm = currentTerm;
        var electionTriggered = false;
        int? rtoMs;
        string rtoSummary;
        string decisionReason;

        if (!hasQuorum)
        {
            if (prevLeader is not null)
            {
                nextTerm = currentTerm + 1;
                electionTriggered = true;
            }

            rtoMs = null;
            rtoSummary = "FENCED (Writes Halted Until >= 3/5 Online)";
            decisionReason =
                $"Quorum lost ({onlineCount}/{totalNodes} online < {quorumRequired} required). Automatic READ_ONLY_FENCE engaged to prevent split-brain voucher double-spending.";
        }
        else
        {
            var prevLeaderStillOnline = prevLeader is not null &&
                onlineRegions.Any(r => string.Equals(r.RegionId, prevLeader, StringComparison.OrdinalIgnoreCase));

            if (prevLeaderStillOnline)
            {
                var leaderDef = onlineRegions.First(r => string.Equals(r.RegionId, prevLeader, StringComparison.OrdinalIgnoreCase));
                electedLeaderId = leaderDef.RegionId;
                electedLeaderName = leaderDef.DisplayName;
                rtoMs = 0;
                rtoSummary = "0 ms (Primary Stable)";
                decisionReason = onlineCount == totalNodes
                    ? $"Nominal 5/5 quorum led by {leaderDef.DisplayName} (Term {nextTerm}). Synchronous majority WAL commit active."
                    : $"Quorum intact ({onlineCount}/{totalNodes} online) under {leaderDef.DisplayName} (Term {nextTerm}). Isolated replicas fenced out of write path.";
            }
            else
            {
                var nextLeader = onlineRegions[0];
                electedLeaderId = nextLeader.RegionId;
                electedLeaderName = nextLeader.DisplayName;
                nextTerm = currentTerm + 1;
                electionTriggered = true;

                var electionRtt = prevLeader is not null ? GetPairwiseRttMs(prevLeader, nextLeader.RegionId) : 45;
                rtoMs = 165 + (int)Math.Round(electionRtt * 0.85);
                rtoSummary = $"{rtoMs} ms (Automated Raft Election)";
                decisionReason =
                    $"Previous leader unavailable. Elected {nextLeader.DisplayName} as Leader for Term {nextTerm} in {rtoMs} ms with {onlineCount}/{totalNodes} votes and 0s RPO.";
            }
        }

        // Compute majority commit RTT: leader + fastest (quorumRequired - 1) followers
        var followerRtts = hasQuorum && electedLeaderId is not null
            ? onlineRegions
                .Where(r => !string.Equals(r.RegionId, electedLeaderId, StringComparison.OrdinalIgnoreCase))
                .Select(r => GetPairwiseRttMs(electedLeaderId, r.RegionId))
                .OrderBy(rtt => rtt)
                .ToList()
            : [];

        var quorumCommitRttMs = hasQuorum && followerRtts.Count >= quorumRequired - 1
            ? followerRtts[quorumRequired - 2]
            : 0;

        var nodes = Regions.Select(def =>
        {
            var health = stateMap[def.RegionId];
            if (health == QuorumRegionHealthState.Partitioned)
            {
                return new QuorumNodeSnapshot(
                    RegionId: def.RegionId,
                    DisplayName: def.DisplayName,
                    Location: def.Location,
                    State: health,
                    Role: QuorumNodeRole.Partitioned,
                    RttToLeaderMs: 9999,
                    WalReplicationLagMs: 9999.0,
                    FencingToken: Math.Max(0, nextTerm - 1),
                    AcceptsWrites: false
                );
            }

            if (health == QuorumRegionHealthState.HardCrash)
            {
                return new QuorumNodeSnapshot(
                    RegionId: def.RegionId,
                    DisplayName: def.DisplayName,
                    Location: def.Location,
                    State: health,
                    Role: QuorumNodeRole.Crashed,
                    RttToLeaderMs: 0,
                    WalReplicationLagMs: 9999.0,
                    FencingToken: 0,
                    AcceptsWrites: false
                );
            }

            if (!hasQuorum)
            {
                return new QuorumNodeSnapshot(
                    RegionId: def.RegionId,
                    DisplayName: def.DisplayName,
                    Location: def.Location,
                    State: health,
                    Role: QuorumNodeRole.Fenced,
                    RttToLeaderMs: 0,
                    WalReplicationLagMs: 0.0,
                    FencingToken: nextTerm,
                    AcceptsWrites: false
                );
            }

            var isLeader = string.Equals(def.RegionId, electedLeaderId, StringComparison.OrdinalIgnoreCase);
            var rtt = isLeader ? 0 : GetPairwiseRttMs(electedLeaderId!, def.RegionId);
            var walLagMs = isLeader
                ? 0.0
                : Math.Round((rtt * 0.16) + def.BaseWalLagMs + (partitionedCount * 3.5), 1);

            return new QuorumNodeSnapshot(
                RegionId: def.RegionId,
                DisplayName: def.DisplayName,
                Location: def.Location,
                State: health,
                Role: isLeader ? QuorumNodeRole.Leader : QuorumNodeRole.Follower,
                RttToLeaderMs: rtt,
                WalReplicationLagMs: walLagMs,
                FencingToken: nextTerm,
                AcceptsWrites: isLeader
            );
        }).ToList();

        var activeFollowerLags = nodes
            .Where(n => n.Role == QuorumNodeRole.Follower)
            .Select(n => n.WalReplicationLagMs)
            .ToList();

        var maxWalLagMs = activeFollowerLags.Count > 0 ? activeFollowerLags.Max() : 0.0;

        return new QuorumEvaluationResult(
            TotalNodes: totalNodes,
            QuorumRequired: quorumRequired,
            OnlineNodes: onlineCount,
            PartitionedNodes: partitionedCount,
            CrashedNodes: crashedCount,
            HasQuorum: hasQuorum,
            ClusterWriteMode: hasQuorum ? "READ_WRITE" : "READ_ONLY_FENCE",
            SplitBrainFenceActive: !hasQuorum,
            DoubleSpendPrevented: true,
            ElectedLeaderRegionId: electedLeaderId,
            ElectedLeaderName: electedLeaderName,
            RaftTerm: nextTerm,
            ElectionTriggered: electionTriggered,
            QuorumCommitRttMs: quorumCommitRttMs,
            MaxWalReplicationLagMs: maxWalLagMs,
            RpoSeconds: 0.0,
            RtoMs: rtoMs,
            RtoSummary: rtoSummary,
            DecisionReason: decisionReason,
            Nodes: nodes
        );
    }
}
