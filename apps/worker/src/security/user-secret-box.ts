const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function fromBase64Url(value: string) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export interface EncryptedUserSecret {
  ciphertext: string;
  iv: string;
  keyVersion: number;
}

export class UserSecretBox {
  private readonly key: Promise<CryptoKey>;

  constructor(secret: string, private readonly keyVersion = 1) {
    if (secret.length < 32) throw new Error("USER_SECRETS_ENCRYPTION_KEY must contain at least 32 characters");
    this.key = crypto.subtle.digest("SHA-256", encoder.encode(`nexus-user-secrets:${secret}`))
      .then((bytes) => crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]));
  }

  async encrypt(userId: string, purpose: string, plaintext: string): Promise<EncryptedUserSecret> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const additionalData = encoder.encode(`${purpose}:${userId}:v${this.keyVersion}`);
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData, tagLength: 128 },
      await this.key,
      encoder.encode(plaintext),
    );
    return { ciphertext: toBase64Url(new Uint8Array(ciphertext)), iv: toBase64Url(iv), keyVersion: this.keyVersion };
  }

  async decrypt(userId: string, purpose: string, encrypted: EncryptedUserSecret) {
    if (encrypted.keyVersion !== this.keyVersion) throw new Error("Unsupported encrypted secret key version");
    const additionalData = encoder.encode(`${purpose}:${userId}:v${encrypted.keyVersion}`);
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64Url(encrypted.iv), additionalData, tagLength: 128 },
      await this.key,
      fromBase64Url(encrypted.ciphertext),
    );
    return decoder.decode(plaintext);
  }
}
