namespace AegisPulse.Domain.Vouchers;

/// <summary>
/// Models SQL Server ROWVERSION optimistic concurrency persistence with Dapper-style atomic UPDATE semantics:
/// UPDATE dbo.Vouchers SET RemainingStock = RemainingStock - 1
/// WHERE Code = @Code AND RemainingStock >= 1 AND RowVer = @ExpectedRowVer;
/// </summary>
public sealed class RowVersionVoucherStore
{
    public sealed class VoucherRecord
    {
        public required string Code { get; init; }
        public required string CampaignName { get; init; }
        public required long FaceValueVnd { get; init; }
        public required int InitialStock { get; init; }
        public int RemainingStock { get; set; }
        public ulong RowVersion { get; set; } = 1UL;
        public int ApprovedRedemptions { get; set; }
        public int RejectedConflicts409 { get; set; }
        public int IdempotentReplays { get; set; }
        public int RowVersionConflicts { get; set; }
        public Queue<VoucherAuditEvent> Events { get; } = new();
    }

    private const int MaxRecentEvents = 64;
    private readonly Dictionary<string, VoucherRecord> _records = new(StringComparer.OrdinalIgnoreCase);

    public static string FormatRowVersionHex(ulong rowVersion) => $"0x{rowVersion:X16}";

    public VoucherRecord UpsertVoucher(SeedVoucherCommand cmd)
    {
        var normalized = cmd.Code.Trim().ToUpperInvariant();
        var record = new VoucherRecord
        {
            Code = normalized,
            CampaignName = string.IsNullOrWhiteSpace(cmd.CampaignName) ? "Con Cung Flash-Sale" : cmd.CampaignName.Trim(),
            FaceValueVnd = cmd.FaceValueVnd,
            InitialStock = cmd.InitialStock,
            RemainingStock = cmd.InitialStock,
            RowVersion = 1UL
        };

        _records[normalized] = record;
        return record;
    }

    public VoucherRecord? GetRecord(string code)
    {
        return _records.TryGetValue(code.Trim().ToUpperInvariant(), out var rec) ? rec : null;
    }

    public bool TryCommitOptimisticDecrement(
        string code,
        ulong expectedRowVersion,
        out ulong newRowVersion,
        out int remainingAfter,
        out bool exhausted)
    {
        var record = GetRecord(code);
        if (record is null)
        {
            newRowVersion = 0;
            remainingAfter = 0;
            exhausted = true;
            return false;
        }

        if (record.RowVersion != expectedRowVersion)
        {
            record.RowVersionConflicts++;
            newRowVersion = record.RowVersion;
            remainingAfter = record.RemainingStock;
            exhausted = record.RemainingStock <= 0;
            return false;
        }

        if (record.RemainingStock <= 0)
        {
            newRowVersion = record.RowVersion;
            remainingAfter = 0;
            exhausted = true;
            return false;
        }

        record.RemainingStock -= 1;
        record.ApprovedRedemptions += 1;
        record.RowVersion += 1UL;
        newRowVersion = record.RowVersion;
        remainingAfter = record.RemainingStock;
        exhausted = false;
        return true;
    }

    public void RecordAuditEvent(VoucherRecord record, VoucherAuditEvent auditEvent)
    {
        record.Events.Enqueue(auditEvent);
        while (record.Events.Count > MaxRecentEvents)
        {
            record.Events.Dequeue();
        }
    }

    public VoucherAuditSnapshot? BuildAuditSnapshot(string code)
    {
        var rec = GetRecord(code);
        if (rec is null)
        {
            return null;
        }

        var doubleSpendCount = Math.Max(0, rec.ApprovedRedemptions - rec.InitialStock);
        var invariantIntact =
            rec.RemainingStock >= 0 &&
            doubleSpendCount == 0 &&
            rec.ApprovedRedemptions + rec.RemainingStock == rec.InitialStock;

        return new VoucherAuditSnapshot(
            Code: rec.Code,
            CampaignName: rec.CampaignName,
            FaceValueVnd: rec.FaceValueVnd,
            InitialStock: rec.InitialStock,
            RemainingStock: rec.RemainingStock,
            ApprovedRedemptions: rec.ApprovedRedemptions,
            RejectedConflicts409: rec.RejectedConflicts409,
            IdempotentReplays: rec.IdempotentReplays,
            RowVersionConflicts: rec.RowVersionConflicts,
            DoubleSpendCount: doubleSpendCount,
            InvariantIntact: invariantIntact,
            CurrentRowVersion: rec.RowVersion,
            CurrentRowVersionHex: FormatRowVersionHex(rec.RowVersion),
            RecentEvents: rec.Events.Reverse().ToList()
        );
    }

    public IReadOnlyList<VoucherAuditSnapshot> BuildAllAuditSnapshots()
    {
        return _records.Keys
            .OrderBy(k => k, StringComparer.OrdinalIgnoreCase)
            .Select(BuildAuditSnapshot)
            .Where(s => s is not null)
            .Select(s => s!)
            .ToList();
    }
}
