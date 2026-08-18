import type { AuthUser } from "@/types/auth";
import { request } from "@/api/client";

export function getProfile() {
  return request<AuthUser>("/api/profile");
}

export function updateProfile(payload: { display_name?: string; bio?: string; avatar_url?: string | null }) {
  return request<AuthUser>("/api/profile", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export async function uploadAvatar(file: File) {
  const formData = new FormData();
  formData.append("file", file);
  const response = await fetch("/api/profile/avatar", {
    method: "POST",
    body: formData,
  });
  const json = await response.json();
  if (!response.ok || !json.success) {
    throw new Error(json?.error?.message || "上传头像失败");
  }
  return json.data as AuthUser;
}
