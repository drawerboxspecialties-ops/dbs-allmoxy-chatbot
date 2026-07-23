import { syncAllmoxyToLocalDb, type SyncMode } from "../src/db/sync";

async function main() {
  const arg = process.argv[2];
  const mode: SyncMode = arg === "full" ? "full" : "incremental";

  if (mode === "full") {
    process.env.ALLMOXY_ALLOW_FULL_SYNC = "1";
    console.log(
      "WARNING: full sync is a one-time backfill. Scheduled jobs should use incremental only.",
    );
  }

  console.log(`Starting Allmoxy → local SQLite sync (${mode})...`);
  console.log(
    "Incremental mode uses watermark + 5-minute buffer (Allmoxy guidance). It does NOT re-pull all history.",
  );
  const result = await syncAllmoxyToLocalDb(mode);
  console.log("Sync complete.");
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error("Sync failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
