import { describe, expect, it } from "vitest";
import { UserSecretBox } from "../src/security/user-secret-box";

describe("UserSecretBox", () => {
  it("round trips a secret only with the same user-scoped AAD", async () => {
    const box = new UserSecretBox("a".repeat(64));
    const encrypted = await box.encrypt("user-1", "ai-config", "sk-personal-secret");

    expect(encrypted.ciphertext).not.toContain("sk-personal-secret");
    await expect(box.decrypt("user-1", "ai-config", encrypted)).resolves.toBe("sk-personal-secret");
    await expect(box.decrypt("user-2", "ai-config", encrypted)).rejects.toThrow();
    await expect(box.decrypt("user-1", "push-subscription", encrypted)).rejects.toThrow();
  });

  it("rejects tampered ciphertext", async () => {
    const box = new UserSecretBox("b".repeat(64));
    const encrypted = await box.encrypt("user-1", "ai-config", "sk-personal-secret");
    // The final base64url character can contain non-significant padding bits.
    // Mutate the first encoded byte so the decoded ciphertext definitely changes.
    const replacement = encrypted.ciphertext[0] === "A" ? "B" : "A";
    await expect(box.decrypt("user-1", "ai-config", {
      ...encrypted,
      ciphertext: `${replacement}${encrypted.ciphertext.slice(1)}`,
    })).rejects.toThrow();
  });
});
