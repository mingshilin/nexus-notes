import { describe, expect, it } from "vitest";
import { D1CalendarRepository } from "../src/calendar/d1-calendar-repository";
import { createTestD1 } from "./helpers/d1";

const now = "2026-08-28T00:00:00.000Z";
const encrypted = { ciphertext: "ciphertext", iv: "iv", keyVersion: 1 };

async function seed(db: D1Database) {
  await db.batch([
    db.prepare("INSERT INTO users (id,email,password_hash,display_name,status,created_at,updated_at) VALUES ('user-1','one@example.test','hash','One','active',?,?)").bind(now, now),
    db.prepare("INSERT INTO users (id,email,password_hash,display_name,status,created_at,updated_at) VALUES ('user-2','two@example.test','hash','Two','active',?,?)").bind(now, now),
  ]);
}

describe("D1CalendarRepository", () => {
  it("consumes OAuth state once and keeps connections/events isolated by user", async () => {
    const test = await createTestD1();
    try {
      await seed(test.db);
      const repository = new D1CalendarRepository(test.db, { createId: () => "connection-1" });
      await repository.createOAuthState({ id: "state-1", userId: "user-1", provider: "google", stateHash: "hash-1", expiresAt: "2026-08-28T01:00:00.000Z", createdAt: now });
      await expect(repository.consumeOAuthState("hash-1", "google", now)).resolves.toEqual({ id: "state-1", userId: "user-1" });
      await expect(repository.consumeOAuthState("hash-1", "google", now)).resolves.toBeNull();
      await repository.upsertConnection({ id: "connection-1", userId: "user-1", provider: "google", providerAccountId: "account-1", encryptedRefreshToken: encrypted, now });
      await repository.upsertEvents("user-1", "connection-1", [{
        id: "event-1", connection_id: "connection-1", provider: "google", provider_event_id: "provider-event-1",
        title: "Review", starts_at: "2026-08-28T01:00:00.000Z", ends_at: "2026-08-28T02:00:00.000Z", timezone: "UTC", all_day: false, status: "confirmed", updated_at: now,
      }]);
      await expect(repository.listEvents("user-2", { from: "2026-08-28", to: "2026-08-28" })).resolves.toEqual([]);
      await expect(repository.listEvents("user-1", { from: "2026-08-28", to: "2026-08-28" })).resolves.toHaveLength(1);
      await expect(repository.getConnection("user-2", "connection-1")).resolves.toBeNull();
      await expect(repository.revokeConnection("user-1", "connection-1", now)).resolves.toBe(true);
      await expect(repository.listConnections("user-1")).resolves.toMatchObject([{ id: "connection-1", status: "revoked" }]);
    } finally {
      await test.dispose();
    }
  });
});
