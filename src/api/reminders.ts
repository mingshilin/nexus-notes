import { request } from "@/api/client";
import type { CreateReminderPayload, Reminder, UpdateReminderPayload } from "@/types/note";

export function getReminders(includeCompleted = true) {
  return request<Reminder[]>(`/api/reminders?includeCompleted=${includeCompleted ? "true" : "false"}`);
}

export function getDueReminders() {
  return request<Reminder[]>("/api/reminders?due=true&includeCompleted=false");
}

export function createReminder(payload: CreateReminderPayload) {
  return request<Reminder>("/api/reminders", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateReminder(id: string, payload: UpdateReminderPayload) {
  return request<Reminder>(`/api/reminders/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function deleteReminder(id: string) {
  return request<{ id: string }>(`/api/reminders/${id}`, { method: "DELETE" });
}

export function toggleReminderComplete(id: string) {
  return request<Reminder>(`/api/reminders/${id}/complete`, { method: "POST" });
}
