const baseUrl = (process.env.NEXUS_NOTES_BETA_URL ?? "http://127.0.0.1:4173/").replace(/\/$/, "");
const rounds = Number(process.env.NEXUS_NOTES_LOAD_ROUNDS ?? 4);
const concurrency = Number(process.env.NEXUS_NOTES_LOAD_CONCURRENCY ?? 8);

if (!Number.isInteger(rounds) || rounds < 1 || rounds > 20) throw new Error("NEXUS_NOTES_LOAD_ROUNDS must be 1..20");
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 32) throw new Error("NEXUS_NOTES_LOAD_CONCURRENCY must be 1..32");

const durations = [];
for (let round = 0; round < rounds; round += 1) {
  const batch = await Promise.all(Array.from({ length: concurrency }, async () => {
    const started = performance.now();
    const response = await fetch(`${baseUrl}/`);
    if (!response.ok) throw new Error(`Beta shell returned ${response.status}`);
    await response.arrayBuffer();
    return performance.now() - started;
  }));
  durations.push(...batch);
}

durations.sort((left, right) => left - right);
const p95 = durations[Math.min(durations.length - 1, Math.ceil(durations.length * 0.95) - 1)] ?? 0;
if (p95 > 2_000) throw new Error(`Beta shell p95 ${Math.round(p95)}ms exceeds 2000ms`);
console.log(`beta shell load passed: requests=${durations.length} p95=${Math.round(p95)}ms`);
