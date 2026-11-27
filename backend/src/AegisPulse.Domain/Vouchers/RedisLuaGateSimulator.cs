using System.Security.Cryptography;
using System.Text;

namespace AegisPulse.Domain.Vouchers;

/// <summary>
/// Models the Con Cung production Redis Lua EVALSHA atomic gate and SHA-256 Idempotency-Key cache.
/// Single-threaded Lua semantics guarantee at most InitialStock reservations ever reach SQL Server.
/// </summary>
public sealed class RedisLuaGateSimulator
{
    public sealed record IdempotencyCacheEntry(string PayloadHash, VoucherRedemptionReceipt Receipt);

    public enum LuaGateStatus
    {
        Reserved,
        IdempotentHit,
        PayloadMismatch,
        Exhausted,
        NotFound
    }

    public sealed record LuaGateResult(
        LuaGateStatus Status,
        int RemainingQuotaAfter,
        VoucherRedemptionReceipt? CachedReceipt = null
    );

    private readonly Dictionary<string, int> _quotas = new(StringComparer.OrdinalIgnoreCase);
    private readonly Dictionary<string, IdempotencyCacheEntry> _idempotencyCache = new(StringComparer.Ordinal);

    public static string ComputePayloadFingerprint(string voucherCode, string customerId, string storeCode)
    {
        var canonical = $"{voucherCode.Trim().ToUpperInvariant()}|{customerId.Trim()}|{storeCode.Trim().ToUpperInvariant()}";
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(canonical));
        return Convert.ToHexString(hash);
    }

    public void SeedQuota(string voucherCode, int initialStock)
    {
        var normalizedCode = voucherCode.Trim().ToUpperInvariant();
        _quotas[normalizedCode] = initialStock;

        // Clear any idempotency keys associated with a re-seeded voucher code
        var keysToRemove = _idempotencyCache
            .Where(kv => string.Equals(kv.Value.Receipt.VoucherCode, normalizedCode, StringComparison.OrdinalIgnoreCase))
            .Select(kv => kv.Key)
            .ToList();

        foreach (var k in keysToRemove)
        {
            _idempotencyCache.Remove(k);
        }
    }

    public LuaGateResult EvaluateAtomicGate(string voucherCode, string idempotencyKey, string payloadFingerprint)
    {
        if (_idempotencyCache.TryGetValue(idempotencyKey, out var cached))
        {
            if (!string.Equals(cached.PayloadHash, payloadFingerprint, StringComparison.Ordinal))
            {
                return new LuaGateResult(LuaGateStatus.PayloadMismatch, _quotas.GetValueOrDefault(voucherCode, 0));
            }

            return new LuaGateResult(LuaGateStatus.IdempotentHit, cached.Receipt.RemainingStockAfter, cached.Receipt);
        }

        if (!_quotas.TryGetValue(voucherCode, out var remaining))
        {
            return new LuaGateResult(LuaGateStatus.NotFound, 0);
        }

        if (remaining <= 0)
        {
            return new LuaGateResult(LuaGateStatus.Exhausted, 0);
        }

        var nextRemaining = remaining - 1;
        _quotas[voucherCode] = nextRemaining;
        return new LuaGateResult(LuaGateStatus.Reserved, nextRemaining);
    }

    public void StoreCommittedReceipt(string idempotencyKey, string payloadFingerprint, VoucherRedemptionReceipt receipt)
    {
        _idempotencyCache[idempotencyKey] = new IdempotencyCacheEntry(payloadFingerprint, receipt);
    }

    public void CompensateQuota(string voucherCode)
    {
        if (_quotas.TryGetValue(voucherCode, out var remaining))
        {
            _quotas[voucherCode] = remaining + 1;
        }
    }
}
