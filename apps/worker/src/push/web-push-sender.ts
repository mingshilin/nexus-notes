import {
  buildPushPayload,
  type PushMessage,
  type PushSubscription,
  type VapidKeys,
} from "@block65/webcrypto-web-push";
import type { PushSubscriptionInput } from "@nexus/contracts";
import type { PushSendResult } from "./reminder-delivery-consumer";

type PayloadBuilder = (
  message: PushMessage,
  subscription: PushSubscription,
  vapid: VapidKeys,
) => Promise<{ method?: string; headers?: HeadersInit; body?: BodyInit | Uint8Array }>;

export class WebPushSender {
  private readonly fetcher: typeof fetch;
  private readonly payloadBuilder: PayloadBuilder;

  constructor(
    private readonly vapid: VapidKeys,
    options: { fetcher?: typeof fetch; buildPayload?: PayloadBuilder } = {},
  ) {
    this.fetcher = options.fetcher ?? fetch;
    // The library's Uint8Array body is accepted by Workers fetch, but its generic differs from lib.webworker.
    this.payloadBuilder = options.buildPayload ?? buildPushPayload as unknown as PayloadBuilder;
  }

  async send(
    subscription: PushSubscriptionInput,
    payload: { title: string; body: string; url: string },
  ): Promise<PushSendResult> {
    const normalized: PushSubscription = {
      endpoint: subscription.endpoint,
      expirationTime: subscription.expiration_time,
      keys: subscription.keys,
    };
    const request = await this.payloadBuilder({
      data: JSON.stringify(payload),
      options: { ttl: 60 * 60, urgency: "normal" },
    }, normalized, this.vapid);
    const response = await this.fetcher(subscription.endpoint, {
      ...request,
      body: request.body as BodyInit,
      redirect: "error",
    });
    if (response.ok) return { ok: true, permanent: false, retryable: false };
    if (response.status === 404 || response.status === 410) {
      return { ok: false, permanent: true, retryable: false };
    }
    if (response.status === 408 || response.status === 429 || response.status >= 500) {
      return { ok: false, permanent: false, retryable: true };
    }
    return { ok: false, permanent: false, retryable: false };
  }
}
