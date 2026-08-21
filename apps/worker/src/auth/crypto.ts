const encoder = new TextEncoder();

function encodeBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeBase64Url(value: string) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function randomBytes(length: number) {
  return crypto.getRandomValues(new Uint8Array(length));
}

function ownedBuffer(bytes: Uint8Array) {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

async function derivePassword(password: string, salt: Uint8Array, iterations: number) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: ownedBuffer(salt), iterations },
    key,
    256,
  );
  return new Uint8Array(bits);
}

function equalBytes(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

export class WebCryptoPasswordHasher {
  private readonly iterations: number;

  constructor(options: { iterations?: number } = {}) {
    this.iterations = options.iterations ?? 210_000;
  }

  async hash(password: string) {
    const salt = randomBytes(16);
    const derived = await derivePassword(password, salt, this.iterations);
    return `pbkdf2_sha256$${this.iterations}$${encodeBase64Url(salt)}$${encodeBase64Url(derived)}`;
  }

  async verify(password: string, encoded: string) {
    const [algorithm, iterationsValue, saltValue, hashValue] = encoded.split("$");
    const iterations = Number(iterationsValue);
    if (algorithm !== "pbkdf2_sha256" || !Number.isInteger(iterations) || iterations < 1 || !saltValue || !hashValue) {
      return false;
    }
    try {
      const actual = await derivePassword(password, decodeBase64Url(saltValue), iterations);
      return equalBytes(actual, decodeBase64Url(hashValue));
    } catch {
      return false;
    }
  }
}

export class SecureTokenService {
  private readonly secret: ArrayBuffer;
  private hmacKey?: Promise<CryptoKey>;

  constructor(secret: string) {
    if (secret.length < 32) throw new Error("AUTH_TOKEN_PEPPER must contain at least 32 characters");
    this.secret = ownedBuffer(encoder.encode(secret));
  }

  createSessionToken() {
    return encodeBase64Url(randomBytes(32));
  }

  createResetToken() {
    return encodeBase64Url(randomBytes(32));
  }

  createEmailCode() {
    const value = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
    return value.toString().padStart(6, "0");
  }

  async hash(value: string) {
    this.hmacKey ??= crypto.subtle.importKey(
      "raw",
      this.secret,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const signature = await crypto.subtle.sign("HMAC", await this.hmacKey, encoder.encode(value));
    return encodeBase64Url(new Uint8Array(signature));
  }
}
