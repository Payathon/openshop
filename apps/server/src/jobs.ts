// Background work for one app instance. Every instance runs the loop; the lease inside each
// syncPayments makes sure only one of them runs that sweep at a time.

// Orders (OpenShop) and 专业版 payments (Billing), each on its own provider.
export interface Sweep {
  syncPayments(): Promise<unknown>;
}

export interface Jobs {
  // Waits for a sweep in progress to finish, then stops.
  stop(): Promise<void>;
}

export function startPaymentSync(sweeps: Sweep[], intervalMs: number): Jobs {
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let running: Promise<void> = Promise.resolve();

  const tick = () => {
    running = (async () => {
      // One sweep failing doesn't hold up the others.
      for (const s of sweeps) await s.syncPayments().catch((err: unknown) => console.error("payment sync failed:", err));
    })().finally(() => {
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
