import type { UpdateProfileInput } from "@nexus/contracts";

const localePattern = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/u;
const timezonePattern = /^(?:UTC|[A-Za-z_]+(?:\/[A-Za-z0-9_+.-]+)+)$/u;

export function normalizeProfilePatch(input: UpdateProfileInput): UpdateProfileInput {
  const result = {
    ...(input.display_name !== undefined ? { display_name: input.display_name.trim() } : {}),
    ...(input.biography !== undefined ? { biography: input.biography.trim() } : {}),
    ...(input.locale !== undefined ? { locale: input.locale.trim() } : {}),
    ...(input.timezone !== undefined ? { timezone: input.timezone.trim() } : {}),
  };

  if (result.locale && !localePattern.test(result.locale)) throw new Error("PROFILE_LOCALE_INVALID");
  if (result.timezone && !timezonePattern.test(result.timezone)) throw new Error("PROFILE_TIMEZONE_INVALID");

  return result;
}

export type AvatarMimeType = "image/png" | "image/jpeg" | "image/webp";

export function detectAvatarMimeType(bytes: Uint8Array): AvatarMimeType | null {
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, index) => bytes[index] === value)) {
    return "image/png";
  }

  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 12 && new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" && new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP") {
    return "image/webp";
  }

  return null;
}
