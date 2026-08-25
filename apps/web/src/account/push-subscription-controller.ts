import type { PushSubscriptionInput, PushSubscriptionSummary } from "@nexus/contracts";

interface PushClient {
  getPushPublicKey(signal?: AbortSignal): Promise<string>;
  subscribePush(input: PushSubscriptionInput, signal?: AbortSignal): Promise<PushSubscriptionSummary>;
}

interface PushRegistration {
  pushManager: {
    getSubscription(): Promise<PushSubscription | null>;
    subscribe(options: PushSubscriptionOptionsInit): Promise<PushSubscription>;
  };
}

function applicationServerKey(value: string) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export async function enableBrowserPush(client: PushClient, options: {
  requestPermission?: () => Promise<NotificationPermission>;
  ready?: Promise<PushRegistration>;
  deviceName?: string;
} = {}) {
  const requestPermission = options.requestPermission ?? (() => Notification.requestPermission());
  if (await requestPermission() !== "granted") throw new Error("PUSH_PERMISSION_DENIED");
  const ready = options.ready ?? navigator.serviceWorker.ready as unknown as Promise<PushRegistration>;
  const registration = await ready;
  const publicKey = await client.getPushPublicKey();
  const subscription = await registration.pushManager.getSubscription()
    ?? await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: applicationServerKey(publicKey),
    });
  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) throw new Error("PUSH_SUBSCRIPTION_INVALID");
  return client.subscribePush({
    endpoint: json.endpoint,
    expiration_time: subscription.expirationTime,
    keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
    device_name: options.deviceName ?? navigator.userAgent.slice(0, 120),
  });
}
