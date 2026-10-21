import type { OpenShop } from "./shop.ts";

// Background work for one app instance. Every instance runs the loop; the lease inside
// syncPayments makes sure only one of them sweeps at a time.

export interface Jobs {
  // Waits for a sweep in progress to finish, then stops.
  stop(): Promise<void>;
}

export function startPaymentSync(shop: OpenShop, intervalMs: number): Jobs {
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let running: Promise<void> = Promise.resolve();

  const tick = () => {
    running = shop
      .syncPayments()
      .then(
        () => undefined,
        (err: unknown) => console.error("payment sync failed:", err),
      )
      .finally(() => {
        if (!stopped) timer = setTimeout(tick, intervalMs);
      });
  };
  timer = setTimeout(tick, intervalMs);

  return {
    async stop() {
      stopped = true;
      clearTimeout(timer);
      await running;
    },
  };
}
