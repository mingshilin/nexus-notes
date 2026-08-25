export class ProfileAvatarStore {
  constructor(private readonly files?: R2Bucket) {}

  async put(key: string, bytes: Uint8Array, contentType: string) {
    if (!this.files) throw new Error("PROFILE_AVATAR_STORAGE_UNAVAILABLE");
    await this.files.put(key, bytes, { httpMetadata: { contentType, cacheControl: "private, no-store" } });
  }

  get(key: string) {
    return this.files?.get(key) ?? Promise.resolve(null);
  }

  async delete(key: string) {
    await this.files?.delete(key);
  }
}
