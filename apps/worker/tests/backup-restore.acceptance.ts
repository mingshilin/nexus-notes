import { readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { createHash } from "node:crypto";
import { it } from "vitest";
import { createTestD1 } from "./helpers/d1";

it("restores an explicitly supplied external backup into local D1", async () => {
  const supplied = process.env.NEXUS_RESTORE_STATEMENTS_FILE;
  if (!supplied || !isAbsolute(supplied)) throw new Error("External statements file required");
  const path = realpathSync(supplied);
  const repo = realpathSync(resolve(import.meta.dirname, "../../.."));
  const rel = relative(repo, path);
  if (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)) throw new Error("Backup must be outside repository");
  const input: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(input) || !input.length || !input.every((s) => typeof s === "string")) {
    throw new Error("Invalid restore statements");
  }
  const statements = input as string[];
  let phase = "initialize";
  const test = await createTestD1();
  try {
    phase = "import";
    await test.db.batch(statements.map((sql) => test.db.prepare(sql)));
    phase = "foreign_key_check query";
    const foreignKeys = await test.db.prepare("PRAGMA foreign_key_check").all();
    phase = "integrity result";
    if (foreignKeys.results.length) {
      throw new Error("Integrity failed");
    }
    const users = await test.db.prepare("SELECT COUNT(*) AS count FROM users").first();
    const notes = await test.db.prepare("SELECT COUNT(*) AS count FROM notes").first();
    console.log(JSON.stringify({
      status: "PASS", engine: "Miniflare local D1", statements: statements.length,
      preparedSha256: createHash("sha256").update(readFileSync(path)).digest("hex"),
      integrityCheck: "unsupported by D1 authorizer; verified separately in SQLite",
      foreignKeyViolations: 0, users: users?.count, notes: notes?.count,
    }));
  } catch {
    // D1 errors may contain SQL and private values; never forward their payload.
    throw new Error(`Local D1 restore failed during ${phase}; private SQL omitted`);
  } finally {
    await test.dispose();
  }
});
