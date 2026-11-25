using System.Runtime.InteropServices;
using System.Text.Json;
using System.Text.Json.Serialization;
using AegisKernel.Core.Domain;
using AegisKernel.Core.Engine;

Console.WriteLine("=== AegisPulse .NET High-Concurrency Kernel Benchmark Suite ===");

await using var engine = new AegisTransactionEngine(initialStock: 500, rateLimitRps: 250_000);

// Warmup JIT
await engine.RunBurstSimulationAsync(ConcurrencyMode.AegisLockFreeChannel, concurrentRequests: 500, initialStock: 100);

var naiveRun = await engine.RunBurstSimulationAsync(
    ConcurrencyMode.NaiveUnprotected,
    concurrentRequests: 2_500,
    initialStock: 500,
    duplicateReplayRatio: 0.15,
    chaos: new ChaosProfile(InjectedDbLatencyMs: 2));

var casRun = await engine.RunBurstSimulationAsync(
    ConcurrencyMode.OptimisticCas,
    concurrentRequests: 10_000,
    initialStock: 500,
    duplicateReplayRatio: 0.20);

var aegisRun = await engine.RunBurstSimulationAsync(
    ConcurrencyMode.AegisLockFreeChannel,
    concurrentRequests: 10_000,
    initialStock: 500,
    duplicateReplayRatio: 0.20);

var report = new
{
    generatedAtUtc = DateTimeOffset.UtcNow,
    dotnetRuntime = RuntimeInformation.FrameworkDescription,
    osArchitecture = RuntimeInformation.OSArchitecture.ToString(),
    processorCount = Environment.ProcessorCount,
    runs = new object[]
    {
        FormatRun("Naive Unprotected (TOCTOU Race Bug)", naiveRun),
        FormatRun("Optimistic RowVersion CAS + Idempotency", casRun),
        FormatRun("Aegis Lock-Free Sharded Channel + Atomic Quota", aegisRun)
    }
};

static object FormatRun(string label, BurstSimulationResult r) => new
{
    label,
    mode = r.Mode.ToString(),
    concurrentRequests = r.ConcurrentRequests,
    initialStock = r.InitialStock,
    elapsedMs = r.ElapsedMilliseconds,
    throughputRps = r.ThroughputRps,
    confirmedAllocations = r.Snapshot.ConfirmedAllocations,
    overAllocatedUnits = r.Snapshot.OverAllocatedUnits,
    idempotentReplaysBlocked = r.Snapshot.IdempotentReplays,
    casRetries = r.Snapshot.TotalCasRetries,
    p50LatencyMs = Math.Round(r.Snapshot.P50LatencyUs / 1000.0, 3),
    p95LatencyMs = Math.Round(r.Snapshot.P95LatencyUs / 1000.0, 3),
    p99LatencyMs = Math.Round(r.Snapshot.P99LatencyUs / 1000.0, 3),
    invariantIntact = r.Snapshot.InvariantIntact
};

var jsonOpts = new JsonSerializerOptions
{
    WriteIndented = true,
    Converters = { new JsonStringEnumConverter() }
};
var json = JsonSerializer.Serialize(report, jsonOpts);
Console.WriteLine(json);

var outPath = args.Length > 0
    ? Path.GetFullPath(args[0])
    : Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "..", "..", "..", "benchmarks", "dotnet-benchmark-report.json"));

Directory.CreateDirectory(Path.GetDirectoryName(outPath)!);
await File.WriteAllTextAsync(outPath, json);
Console.WriteLine($"[SAVED BENCHMARK REPORT] -> {outPath}");
