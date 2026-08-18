import { request } from "@/api/client";
import type { CreateTagPayload, Tag } from "@/types/note";

export function getTags() {
  return request<Tag[]>("/api/tags");
}

export function createTag(payload: CreateTagPayload) {
  return request<Tag>("/api/tags", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
