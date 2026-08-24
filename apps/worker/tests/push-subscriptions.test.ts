import { describe, expect, it } from "vitest";
import { D1PushSubscriptionRepository } from "../src/push/d1-push-subscription-repository";
import { UserSecretBox } from "../src/security/user-secret-box";
import { createTestD1 } from "./helpers/d1";

const now = "2026-08-25T04:00:00.000Z";
const subscription = {
  endpoint: "https://push.example.test/send/subscription-1",
  expiration_time: null,
  keys: { p256dh: "p".repeat(43), auth: "a".repeat(22) },
  device_name: "Edge on Windows",
};

describe("push subscriptions", () => {
  it("encrypts subscriptions, updates the same endpoint, and isolates users", async () => {
    const test = await createTestD1();
    try {
      await test.db.batch([
        test.db.prepare("INSERT INTO users (id,email,password_hash,display_name,status,created_at,updated_at) VALUES ('user-1','one@example.test','hash','One','active',?,?)").bind(now, now),
        test.db.prepare("INSERT INTO users (id,email,password_hash,display_name,status,created_at,updated_at) VALUES ('user-2','two@example.test','hash','Two','active',?,?)").bind(now, now),
      ]);
      const repository = new D1PushSubscriptionRepository(
        test.db,
        new UserSecretBox("push-encryption-secret-with-at-least-32-characters"),
        { clock: () => new Date(now), createId: () => "push-1" },
      );
      const created = await repository.upsert("user-1", subscription, "req-1");
      const updated = await repository.upsert("user-1", { ...subscription, device_name: "Edge laptop" }, "req-2");
      expect(created.id).toBe("push-1");
      expect(updated).toMatchObject({ id: "push-1", device_name: "Edge laptop", status: "active" });
      expect(await repository.list("user-1")).toEqual([expect.objectContaining({ id: "push-1" })]);
      expect(await repository.list("user-2")).toEqual([]);

      const stored = await test.db.prepare(
        "SELECT subscription_ciphertext FROM push_subscriptions WHERE id = 'push-1'",
      ).first<string>("subscription_ciphertext");
      expect(stored).not.toContain(subscription.endpoint);
      expect(await repository.listActive("user-1")).toEqual([
        expect.objectContaining({ id: "push-1", subscription: expect.objectContaining({ endpoint: subscription.endpoint }) }),
      ]);
      expect(await repository.disable("user-2", "push-1", "req-3")).toBe(false);
      expect(await repository.disable("user-1", "push-1", "req-4")).toBe(true);
      expect(await repository.listActive("user-1")).toEqual([]);
    } finally {
      await test.dispose();
    }
  });
});
