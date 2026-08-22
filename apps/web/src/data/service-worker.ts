export interface ServiceWorkerUpdate {
  activate(): void;
}

interface WorkerLike {
  state?: string;
  postMessage(message: unknown): void;
  addEventListener?(type: "statechange", listener: () => void): void;
}

interface RegistrationLike {
  waiting: WorkerLike | null;
  installing: WorkerLike | null;
  addEventListener(type: "updatefound", listener: () => void): void;
}

interface ServiceWorkerContainerLike {
  controller: unknown;
  register(scriptURL: string, options?: RegistrationOptions): Promise<RegistrationLike>;
}

export interface RegisterServiceWorkerOptions {
  serviceWorker?: ServiceWorkerContainerLike;
  onUpdate(update: ServiceWorkerUpdate): void;
}

export async function registerBetaServiceWorker({
  serviceWorker = typeof navigator === "undefined"
    ? undefined
    : navigator.serviceWorker as unknown as ServiceWorkerContainerLike | undefined,
  onUpdate,
}: RegisterServiceWorkerOptions) {
  if (!serviceWorker) return null;
  const registration = await serviceWorker.register("/sw.js", { scope: "/" });
  let announcedWorker: WorkerLike | null = null;

  const announce = (worker: WorkerLike | null) => {
    if (!worker || worker === announcedWorker) return;
    announcedWorker = worker;
    onUpdate({
      activate() {
        worker.postMessage({ type: "SKIP_WAITING" });
      },
    });
  };

  announce(registration.waiting);
  registration.addEventListener("updatefound", () => {
    const installing = registration.installing;
    installing?.addEventListener?.("statechange", () => {
      if (installing.state === "installed" && serviceWorker.controller) announce(installing);
    });
  });

  return registration;
}
