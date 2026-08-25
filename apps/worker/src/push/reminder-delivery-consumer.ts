import { QueueJobSchema } from "@nexus/contracts";
import type { PushSubscriptionInput } from "@nexus/contracts";

interface Delivery {
  id: string;
  workspace_id: string;
  reminder_id: string;
  user_id: string;
  channel: "in_app" | "email" | "push";
  title: string;
  show_push_title: number | boolean;
  email?: string;
}

interface DeliveryRepository {
  getDelivery(deliveryId: string): Promise<Delivery | null>;
  markDeliverySent(deliveryId: string, now: string): Promise<void>;
  markDeliveryFailed(deliveryId: string, now: string, errorCode: string): Promise<void>;
  createInAppNotification(delivery: Delivery, now: string): Promise<void>;
}

interface SubscriptionRepository {
  listActive(userId: string): Promise<Array<{ id: string; subscription: PushSubscriptionInput }>>;
  markSuccess(subscriptionId: string, now: string): Promise<void>;
  markFailure(subscriptionId: string, now: string, permanent: boolean): Promise<void>;
}

export interface PushSendResult {
  ok: boolean;
  permanent: boolean;
  retryable: boolean;
}

interface PushSender {
  send(subscription: PushSubscriptionInput, payload: { title: string; body: string; url: string }): Promise<PushSendResult>;
}

interface EmailSender {
  send(input: { to: string; subject: string; text: string }): Promise<void>;
}

function bodyOf(message: unknown) {
  if (!message || typeof message !== "object" || Array.isArray(message)) return message;
  return "body" in message ? (message as { body: unknown }).body : message;
}

export class ReminderDeliveryConsumer {
  private readonly clock: () => Date;

  constructor(
    private readonly deliveries: DeliveryRepository,
    private readonly subscriptions: SubscriptionRepository,
    private readonly push: PushSender,
    private readonly email?: EmailSender,
    options: { clock?: () => Date } = {},
  ) {
    this.clock = options.clock ?? (() => new Date());
  }

  async consume(message: unknown): Promise<{ outcome: "ack" } | { outcome: "retry"; delaySeconds: number }> {
    const parsed = QueueJobSchema.safeParse(bodyOf(message));
    if (!parsed.success || parsed.data.kind !== "notification") return { outcome: "ack" };
    if (parsed.data.payload.test === true && typeof parsed.data.payload.user_id === "string") {
      return this.sendTest(parsed.data.payload.user_id, parsed.data.attempt);
    }
    const deliveryId = typeof parsed.data.payload.delivery_id === "string"
      ? parsed.data.payload.delivery_id
      : null;
    if (!deliveryId) return { outcome: "ack" };
    const delivery = await this.deliveries.getDelivery(deliveryId);
    if (!delivery) return { outcome: "ack" };
    const now = this.clock().toISOString();

    try {
      if (delivery.channel === "in_app") {
        await this.deliveries.createInAppNotification(delivery, now);
      } else if (delivery.channel === "email") {
        if (!this.email || !delivery.email) throw new Error("REMINDER_EMAIL_UNAVAILABLE");
        await this.email.send({
          to: delivery.email,
          subject: delivery.title || "Nexus Notes 提醒",
          text: `${delivery.title || "你有一条提醒"}\n\n打开 Nexus Notes 查看详情。`,
        });
      } else {
        const active = await this.subscriptions.listActive(delivery.user_id);
        let retryableFailure = false;
        for (const item of active) {
          const result = await this.push.send(item.subscription, {
            title: delivery.show_push_title ? delivery.title || "Nexus Notes 提醒" : "你有一条提醒",
            body: "打开 Nexus Notes 查看详情",
            url: `/reminders?reminder=${encodeURIComponent(delivery.reminder_id)}`,
          });
          if (result.ok) await this.subscriptions.markSuccess(item.id, now);
          else {
            await this.subscriptions.markFailure(item.id, now, result.permanent);
            retryableFailure ||= result.retryable;
          }
        }
        if (retryableFailure) throw new Error("REMINDER_PUSH_RETRYABLE");
      }
      await this.deliveries.markDeliverySent(delivery.id, now);
      return { outcome: "ack" };
    } catch (error) {
      const code = error instanceof Error && error.message === "REMINDER_EMAIL_UNAVAILABLE"
        ? "REMINDER_EMAIL_UNAVAILABLE"
        : "REMINDER_DELIVERY_RETRYABLE";
      await this.deliveries.markDeliveryFailed(delivery.id, now, code);
      return { outcome: "retry", delaySeconds: Math.min(900, 30 * 2 ** Math.max(0, parsed.data.attempt - 1)) };
    }
  }

  private async sendTest(userId: string, attempt: number): Promise<{ outcome: "ack" } | { outcome: "retry"; delaySeconds: number }> {
    const now = this.clock().toISOString();
    const active = await this.subscriptions.listActive(userId);
    let retryableFailure = false;
    for (const item of active) {
      const result = await this.push.send(item.subscription, {
        title: "Nexus Notes 测试通知",
        body: "Web Push 已成功连接",
        url: "/account?section=preferences",
      });
      if (result.ok) await this.subscriptions.markSuccess(item.id, now);
      else {
        await this.subscriptions.markFailure(item.id, now, result.permanent);
        retryableFailure ||= result.retryable;
      }
    }
    return retryableFailure
      ? { outcome: "retry", delaySeconds: Math.min(900, 30 * 2 ** Math.max(0, attempt - 1)) }
      : { outcome: "ack" };
  }
}
