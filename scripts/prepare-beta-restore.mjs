import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MEMBERSHIP_EPOCH_INSERT = 'INSERT INTO "workspace_membership_epochs"';
const MEMBERSHIP_EPOCH_RESTORE_INSERT = 'INSERT OR REPLACE INTO "workspace_membership_epochs"';

export function prepareBetaRestoreSql(source) {
  return source.replaceAll(MEMBERSHIP_EPOCH_INSERT, MEMBERSHIP_EPOCH_RESTORE_INSERT);
}

function prepareFile(inputPath, outputPath) {
  const source = readFileSync(inputPath, "utf8");
  const prepared = prepareBetaRestoreSql(source);
  writeFileSync(outputPath, prepared, "utf8");
  return (prepared.match(/INSERT OR REPLACE INTO "workspace_membership_epochs"/g) ?? []).length;
}

if (fileURLToPath(import.meta.url) === resolve(process.argv[1] ?? "")) {
  const [inputPath, outputPath] = process.argv.slice(2);
  if (!inputPath || !outputPath) {
    console.error("Usage: node scripts/prepare-beta-restore.mjs <backup.sql> <restore.sql>");
    process.exit(1);
  }

  const rewrittenEpochRows = prepareFile(inputPath, outputPath);
  console.log(JSON.stringify({ output: outputPath, rewrittenEpochRows }));
}
