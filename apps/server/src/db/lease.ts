import { and, eq, lt, or } from "drizzle-orm";
import type { Db } from "./client.ts";
import { leases } from "./schema.ts";

// Takes the named lease if it is free, expired, or already ours. One atomic upsert, so two
// instances racing for it can't both win: Postgres re-checks the WHERE on the conflicting row.
export async function acquireLease(db: Db, name: string, holder: string, now: Date, ttlMs: number): Promise<boolean> {
  const expiresAt = new Date(now.getTime() + ttlMs);
  const won = await db
    .insert(leases)
    .values({ name, holder, expiresAt })
    .onConflictDoUpdate({
      target: leases.name,
      set: { holder, expiresAt },
      setWhere: or(lt(leases.expiresAt, now), eq(leases.holder, holder))!,
    })
    .returning({ name: leases.name });
  return won.length > 0;
}

export async function releaseLease(db: Db, name: string, holder: string) {
  await db.delete(leases).where(and(eq(leases.name, name), eq(leases.holder, holder)));
}
