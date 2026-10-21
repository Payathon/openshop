import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { and, asc, desc, eq, inArray, notInArray } from "drizzle-orm";
import { defaultPage, MODULE_KEYS, parsePage, TEMPLATES, templatePage, templateSamples, type Module, type PageConfig } from "@openshop/core";
import { applyOp, describeOp, fromInput, opTarget, resolveOp, type Content, type Op, type OpInput, type ProductContent } from "./content.ts";
import type { Db } from "./db/client.ts";
import { changesetOps, changesets, products, publishes, shopPages, shops, variants, type StoredSchedule } from "./db/schema.ts";
import { newId, ShopError, type OpenShop } from "./shop.ts";

// The merchant side of a shop's content (docs/tech-plan.md, 预览与发布): onboarding from an
// industry template, edits that wait in the shop's open changeset, signed preview links,
// publishing, and rollback. Customers only ever see published content.

type ShopRow = typeof shops.$inferSelect;
type OpRow = typeof changesetOps.$inferSelect;

const PREVIEW_TTL_MS = 24 * 3_600_000;

const json = (x: unknown) => JSON.stringify(x);
// Content equality ignoring stock, which is operational and never published.
const sameProduct = (a: ProductContent, b: ProductContent) =>
  json({ ...a, variants: a.variants.map((v) => ({ ...v, stock: null })) }) === json({ ...b, variants: b.variants.map((v) => ({ ...v, stock: null })) });

export interface OnboardInput {
  industry: string;
  modules?: Module[] | undefined;
  name: string;
  phone: string;
  address?: string | undefined;
  description?: string | undefined;
  slug?: string | undefined;
}

export interface Change {
  id: string;
  summary: string;
  kind: Op["kind"];
  createdAt: string;
}

export class Studio {
  private readonly secret: string;

  constructor(
    private readonly shop: OpenShop,
    opts: { previewSecret?: string | undefined } = {},
  ) {
    // Without a configured secret, preview links stop working when the server restarts.
    this.secret = opts.previewSecret ?? randomBytes(32).toString("hex");
  }

  private get db() {
    return this.shop.db;
  }

  // ---- onboarding (product-decisions #6) ---------------------------------------------

  async onboard(input: OnboardInput) {
    const template = TEMPLATES[input.industry];
    if (!template) throw new ShopError(400, "invalid_request", `未知的行业 ${input.industry}，可选：${Object.keys(TEMPLATES).join("、")}`);
    const modules = input.modules ?? template.modules;
    const unknown = modules.filter((m) => !MODULE_KEYS.includes(m));
    if (unknown.length) throw new ShopError(400, "invalid_request", `未知的模块：${unknown.join("、")}`);

    const base = {
      name: input.name,
      industry: template.key,
      description: input.description ?? "",
      phone: input.phone,
      address: input.address,
      schedule: modules.includes("booking") ? { ...template.hours, closures: [] } : undefined,
      cancelPolicy: { freeCancelHoursBefore: template.cancelHours },
    };
    // A generated address can collide; a chosen one is the merchant's to change.
    let created: Awaited<ReturnType<OpenShop["createShop"]>> | undefined;
    for (let attempt = 0; !created; attempt++) {
      const slug = input.slug ?? `${template.key}-${randomBytes(3).toString("hex")}`;
      created = await this.shop.createShop({ ...base, slug }).catch((err: unknown) => {
        if (input.slug || attempt >= 3 || !(err instanceof ShopError && err.code === "slug_taken")) throw err;
        return undefined;
      });
    }

    // The shop is a draft, so the template goes straight into its (not yet public) live content.
    await this.db.transaction(async (tx) => {
      const { row, content } = await loadContent(tx as unknown as Db, created.shop.id, true);
      const samples = templateSamples(template, modules).map((p) => fromInput(newId("prod"), p, [], newId, true));
      await this.writeContent(tx as unknown as Db, row, content, { ...content, page: templatePage(template, modules), products: samples });
    });
    return { ...(await this.overview(created.shop.id)), merchantToken: created.merchantToken };
  }

  // ---- reading -------------------------------------------------------------------------

  // What the merchant works on: the preview content, the pending change list and the live state.
  async overview(shopId: string) {
    const { row, preview, ops } = await this.state(this.db, shopId);
    const [last] = await this.db.select({ version: publishes.version }).from(publishes).where(eq(publishes.shopId, shopId)).orderBy(desc(publishes.version)).limit(1);
    return {
      shop: { id: row.id, slug: row.slug, status: row.status, industry: row.industry, url: this.shop.shopUrl(row.slug), ...preview.shop },
      version: last?.version ?? 0,
      page: preview.page,
      products: preview.products,
      changes: ops.map(change),
      previewUrl: this.previewUrl(row),
    };
  }

  async changes(shopId: string) {
    return (await this.state(this.db, shopId)).ops.map(change);
  }

  async publishHistory(shopId: string) {
    const rows = await this.db
      .select({ version: publishes.version, changes: publishes.changes, createdAt: publishes.createdAt })
      .from(publishes)
      .where(eq(publishes.shopId, shopId))
      .orderBy(desc(publishes.version));
    return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
  }

  // Live content plus the open changeset replayed over it.
  private async state(db: Db, shopId: string, lock = false) {
    const { row, content } = await loadContent(db, shopId, lock);
    const [open] = await db.select().from(changesets).where(and(eq(changesets.shopId, shopId), eq(changesets.status, "open")));
    const ops = open ? await db.select().from(changesetOps).where(eq(changesetOps.changesetId, open.id)).orderBy(asc(changesetOps.seq)) : [];
    const { content: preview, dropped } = replay(content, ops);
    return { row, live: content, preview, ops: ops.filter((o) => !dropped.includes(o)), dropped, changeset: open ?? null };
  }

  // ---- editing -------------------------------------------------------------------------

  // Adds one edit to the shop's open changeset. It shows in previews right away and goes
  // live on the next publish. Returns the change and, for product edits, the product as it
  // will be published (with its ids, so later edits and orders can refer to it).
  async propose(shopId: string, input: OpInput) {
    return this.db.transaction(async (tx) => {
      const db = tx as unknown as Db;
      const s = await this.state(db, shopId, true);
      const op = resolveOp(s.preview, input, newId);
      const summary = describeOp(s.preview, op);
      const next = applyOp(s.preview, op);
      const changesetId = s.changeset?.id ?? (await this.openChangeset(db, shopId));
      const seq = (s.ops.at(-1)?.seq ?? 0) + 1;
      const [row] = await db
        .insert(changesetOps)
        .values({ id: newId("chg"), changesetId, shopId, seq, op: op as unknown as Record<string, unknown>, summary, createdAt: this.shop.now() })
        .returning();
      const productId = op.kind === "product.create" || op.kind === "product.update" ? op.product.id : null;
      return { change: change(row!), ...(productId ? { product: next.products.find((p) => p.id === productId)! } : {}) };
    });
  }

  private async openChangeset(db: Db, shopId: string) {
    const id = newId("cs");
    await db.insert(changesets).values({ id, shopId, status: "open", createdAt: this.shop.now() });
    return id;
  }

  // Undoes one change, along with later changes to the same thing (they were made on top of
  // it) and any change that no longer applies without it. Returns everything undone.
  async undo(shopId: string, changeId: string) {
    return this.db.transaction(async (tx) => {
      const db = tx as unknown as Db;
      const s = await this.state(db, shopId, true);
      const at = s.ops.findIndex((o) => o.id === changeId);
      if (at === -1) throw new ShopError(404, "change_not_found", "找不到这条待发布的修改");
      const target = opTarget(s.ops[at]!.op as unknown as Op);
      const removed = [s.ops[at]!, ...s.ops.slice(at + 1).filter((o) => opTarget(o.op as unknown as Op) === target)];
      const rest = s.ops.filter((o) => !removed.includes(o));
      removed.push(...replay(s.live, rest).dropped);
      await db.delete(changesetOps).where(inArray(changesetOps.id, removed.map((o) => o.id)));
      return { undone: removed.sort((a, b) => a.seq - b.seq).map(change) };
    });
  }

  async discard(shopId: string) {
    await this.db.transaction(async (tx) => {
      const db = tx as unknown as Db;
      const s = await this.state(db, shopId, true);
      if (!s.changeset) return;
      await db.delete(changesetOps).where(eq(changesetOps.changesetId, s.changeset.id));
      await db.update(changesets).set({ status: "discarded", closedAt: this.shop.now() }).where(eq(changesets.id, s.changeset.id));
    });
  }

  // ---- publishing ----------------------------------------------------------------------

  // Applies every pending change in one transaction and records a version. The first
  // publish takes a draft shop live. Sample products must be replaced or removed first.
  async publish(shopId: string) {
    return this.db.transaction(async (tx) => {
      const db = tx as unknown as Db;
      const s = await this.state(db, shopId, true);
      if (s.ops.length === 0 && s.row.status === "live") throw new ShopError(409, "nothing_to_publish", "没有待发布的修改");
      const samples = s.preview.products.filter((p) => p.sample && p.published);
      if (samples.length) {
        throw new ShopError(
          409,
          "sample_content",
          `还有 ${samples.length} 个示例商品（${samples.map((p) => p.name).join("、")}），改成真实商品或删除后再发布`,
        );
      }
      await this.writeContent(db, s.row, s.live, s.preview);
      const changes = s.ops.length ? s.ops.map((o) => o.summary) : ["店铺上线"];
      const version = await this.record(db, shopId, changes, s.preview);
      if (s.changeset) {
        if (s.dropped.length) await db.delete(changesetOps).where(inArray(changesetOps.id, s.dropped.map((o) => o.id)));
        await db.update(changesets).set({ status: "published", closedAt: this.shop.now() }).where(eq(changesets.id, s.changeset.id));
      }
      if (s.row.status !== "live") await db.update(shops).set({ status: "live" }).where(eq(shops.id, shopId));
      return { version, changes, url: this.shop.shopUrl(s.row.slug) };
    });
  }

  // Makes an earlier version live again, as a new version. Pending changes must be
  // published or discarded first, since they were made on top of the current content.
  async rollback(shopId: string, version: number) {
    return this.db.transaction(async (tx) => {
      const db = tx as unknown as Db;
      const s = await this.state(db, shopId, true);
      if (s.ops.length) throw new ShopError(409, "pending_changes", "还有待发布的修改，先发布或放弃后再回滚");
      const [target] = await db.select().from(publishes).where(and(eq(publishes.shopId, shopId), eq(publishes.version, version)));
      if (!target) throw new ShopError(404, "version_not_found", `找不到版本 ${version}`);
      const snapshot = target.snapshot as unknown as Content;
      // Pages saved under older section versions are migrated on the way back.
      const content: Content = { ...snapshot, page: parsePage(snapshot.page) };
      await this.writeContent(db, s.row, s.live, content);
      const changes = [`回滚到版本 ${version}`];
      return { version: await this.record(db, shopId, changes, content), changes };
    });
  }

  private async record(db: Db, shopId: string, changes: string[], content: Content) {
    const [last] = await db.select({ version: publishes.version }).from(publishes).where(eq(publishes.shopId, shopId)).orderBy(desc(publishes.version)).limit(1);
    const version = (last?.version ?? 0) + 1;
    await db.insert(publishes).values({
      id: newId("pub"),
      shopId,
      version,
      changes,
      snapshot: content as unknown as Record<string, unknown>,
      createdAt: this.shop.now(),
    });
    return version;
  }

  // Persists `after` where it differs from `before`. Stock is never written for existing
  // variants: it is operational and may have moved since the content was read.
  private async writeContent(db: Db, row: ShopRow, before: Content, after: Content) {
    const now = this.shop.now();
    if (json(before.shop) !== json(after.shop)) {
      const { hours, ...rest } = after.shop;
      const schedule: StoredSchedule | null = hours ? { ...hours, closures: row.schedule?.closures ?? [] } : null;
      await db.update(shops).set({ ...rest, schedule }).where(eq(shops.id, row.id));
    }
    if (json(before.page) !== json(after.page)) {
      const page = { sections: after.page.sections, theme: after.page.theme, updatedAt: now };
      await db.insert(shopPages).values({ shopId: row.id, ...page }).onConflictDoUpdate({ target: shopPages.shopId, set: page });
    }

    const old = new Map(before.products.map((p) => [p.id, p]));
    for (const [i, p] of after.products.entries()) {
      const prev = old.get(p.id);
      if (prev && sameProduct(prev, p)) continue;
      const { variants: vs, id, ...fields } = p;
      await db
        .insert(products)
        .values({ id, shopId: row.id, ...fields, deleted: false, createdAt: new Date(now.getTime() + i) })
        .onConflictDoUpdate({ target: products.id, set: { ...fields, deleted: false } });
      for (const [position, v] of vs.entries()) {
        const set = { attributes: v.attributes, priceFen: v.priceFen, position, deleted: false };
        await db
          .insert(variants)
          .values({ id: v.id, productId: id, shopId: row.id, stock: v.stock, ...set })
          .onConflictDoUpdate({ target: variants.id, set: prev && prev.fulfillment !== p.fulfillment ? { ...set, stock: v.stock } : set });
      }
      await db
        .update(variants)
        .set({ deleted: true })
        .where(and(eq(variants.productId, id), notInArray(variants.id, vs.map((v) => v.id))));
    }
    const kept = new Set(after.products.map((p) => p.id));
    const gone = before.products.filter((p) => !kept.has(p.id)).map((p) => p.id);
    if (gone.length) await db.update(products).set({ deleted: true }).where(inArray(products.id, gone));
  }

  // ---- preview links -------------------------------------------------------------------
  // Signed and time-limited so the merchant can open the preview on a phone or send it to a
  // partner without logging in. Path-based: /s/<slug>/preview/<expires>.<signature>

  async previewLink(shopId: string) {
    const [row] = await this.db.select({ id: shops.id, slug: shops.slug }).from(shops).where(eq(shops.id, shopId));
    if (!row) throw new ShopError(404, "shop_not_found", "找不到这家店");
    return { url: this.previewUrl(row), expiresAt: new Date(this.shop.now().getTime() + PREVIEW_TTL_MS).toISOString() };
  }

  previewUrl(row: { id: string; slug: string }) {
    const expires = (this.shop.now().getTime() + PREVIEW_TTL_MS).toString(36);
    return `${this.shop.shopUrl(row.slug)}/preview/${expires}.${this.sign(row.id, expires)}`;
  }

  private sign(shopId: string, expires: string) {
    return createHmac("sha256", this.secret).update(`preview:${shopId}:${expires}`).digest("base64url").slice(0, 32);
  }

  // The preview content of the shop the link belongs to, or a 404 for a bad or expired link.
  async preview(slug: string, token: string) {
    const invalid = new ShopError(404, "preview_not_found", "预览链接无效或已过期，请在工作台重新生成");
    const [row] = await this.db.select({ id: shops.id, slug: shops.slug }).from(shops).where(eq(shops.slug, slug));
    const [expires = "", sig = ""] = token.split(".");
    if (!row || !/^[0-9a-z]+$/.test(expires)) throw invalid;
    const want = Buffer.from(this.sign(row.id, expires));
    const got = Buffer.from(sig);
    if (got.length !== want.length || !timingSafeEqual(got, want)) throw invalid;
    if (parseInt(expires, 36) <= this.shop.now().getTime()) throw invalid;
    const s = await this.state(this.db, row.id);
    return { row: s.row, content: s.preview };
  }

  // ---- live page -------------------------------------------------------------------------

  async livePage(shopId: string, hasSchedule: boolean): Promise<PageConfig> {
    const [p] = await this.db.select().from(shopPages).where(eq(shopPages.shopId, shopId));
    return p ? parsePage({ sections: p.sections, theme: p.theme }) : defaultPage({ booking: hasSchedule });
  }

  // ---- operational: immediate, never previewed --------------------------------------------

  // Times the shop is closed on top of its weekly hours, e.g. a day off.
  async setClosures(shopId: string, closures: { start: string; end: string }[]) {
    return this.db.transaction(async (tx) => {
      const [row] = await tx.select().from(shops).where(eq(shops.id, shopId)).for("update");
      if (!row?.schedule) throw new ShopError(409, "no_bookings", "这家店没有开启预约");
      for (const c of closures) {
        if (new Date(c.end) <= new Date(c.start)) throw new ShopError(400, "invalid_request", "休息时间的结束要晚于开始");
      }
      const schedule = { ...row.schedule, closures };
      await tx.update(shops).set({ schedule }).where(eq(shops.id, shopId));
      return { closures };
    });
  }
}

const change = (o: OpRow): Change => ({ id: o.id, summary: o.summary, kind: (o.op as { kind: Op["kind"] }).kind, createdAt: o.createdAt.toISOString() });

// Applies ops in order, skipping any that no longer apply (e.g. after an undo removed what
// they built on). Skipped ops are returned so callers can drop them.
function replay(content: Content, ops: OpRow[]) {
  const dropped: OpRow[] = [];
  for (const o of ops) {
    try {
      content = applyOp(content, o.op as unknown as Op);
    } catch (err) {
      if (!(err instanceof ShopError)) throw err;
      dropped.push(o);
    }
  }
  return { content, dropped };
}

// A shop's live content, read from the tables. With lock, the shop row is locked so edits to
// one shop are serialised.
export async function loadContent(db: Db, shopId: string, lock = false): Promise<{ row: ShopRow; content: Content }> {
  const q = db.select().from(shops).where(eq(shops.id, shopId));
  const [row] = lock ? await q.for("update") : await q;
  if (!row) throw new ShopError(404, "shop_not_found", "找不到这家店");
  const [p] = await db.select().from(shopPages).where(eq(shopPages.shopId, shopId));
  const ps = await db
    .select()
    .from(products)
    .where(and(eq(products.shopId, shopId), eq(products.deleted, false)))
    .orderBy(asc(products.createdAt), asc(products.id));
  const vs = ps.length
    ? await db
        .select()
        .from(variants)
        .where(and(inArray(variants.productId, ps.map((x) => x.id)), eq(variants.deleted, false)))
        .orderBy(asc(variants.position))
    : [];
  const { weekly, capacity, stepMinutes } = row.schedule ?? { weekly: [], capacity: 1, stepMinutes: 30 };
  return {
    row,
    content: {
      shop: {
        name: row.name,
        description: row.description,
        phone: row.phone,
        address: row.address,
        hours: row.schedule ? { weekly, capacity, stepMinutes } : null,
        cancelPolicy: row.cancelPolicy,
      },
      page: p ? parsePage({ sections: p.sections, theme: p.theme }) : defaultPage({ booking: !!row.schedule }),
      products: ps.map((x) => ({
        id: x.id,
        name: x.name,
        description: x.description,
        images: x.images,
        fulfillment: x.fulfillment,
        durationMinutes: x.durationMinutes,
        orderOptions: x.orderOptions,
        info: x.info,
        published: x.published,
        sample: x.sample,
        variants: vs.filter((v) => v.productId === x.id).map((v) => ({ id: v.id, attributes: v.attributes, priceFen: v.priceFen, stock: v.stock })),
      })),
    },
  };
}
