import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { and, eq, gt } from "drizzle-orm";
import { accounts, memberships, sessions } from "./db/accounts.ts";
import type { Db } from "./db/client.ts";
import { shops } from "./db/schema.ts";
import { ShopError } from "./shop.ts";

const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export const SESSION_TTL_MS = 30 * 86_400_000;

async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, 32);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

async function checkPassword(password: string, stored: string) {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const actual = await scryptAsync(password, Buffer.from(salt, "hex"), 32);
  return timingSafeEqual(actual, Buffer.from(hash, "hex"));
}

const normalizeEmail = (email: string) => email.trim().toLowerCase();

export type Account = { id: string; email: string; name: string };

export class Accounts {
  constructor(
    private readonly db: Db,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async register(input: { email: string; password: string; name: string }): Promise<{ account: Account; session: string }> {
    const account = {
      id: `acc_${randomUUID().replaceAll("-", "").slice(0, 16)}`,
      email: normalizeEmail(input.email),
      name: input.name.trim(),
      passwordHash: await hashPassword(input.password),
      createdAt: this.clock(),
    };
    const inserted = await this.db.insert(accounts).values(account).onConflictDoNothing({ target: accounts.email }).returning();
    if (inserted.length === 0) throw new ShopError(409, "email_taken", "这个邮箱已经注册过了，直接登录就行");
    return { account: { id: account.id, email: account.email, name: account.name }, session: await this.startSession(account.id) };
  }

  async login(email: string, password: string): Promise<{ account: Account; session: string }> {
    const [a] = await this.db.select().from(accounts).where(eq(accounts.email, normalizeEmail(email)));
    // Same message either way, so the form doesn't reveal which emails exist.
    if (!a || !(await checkPassword(password, a.passwordHash))) throw new ShopError(401, "bad_credentials", "邮箱或密码不对");
    return { account: { id: a.id, email: a.email, name: a.name }, session: await this.startSession(a.id) };
  }

  async logout(session: string) {
    await this.db.delete(sessions).where(eq(sessions.tokenHash, sha256(session)));
  }

  async fromSession(session: string): Promise<Account | null> {
    const [row] = await this.db
      .select({ id: accounts.id, email: accounts.email, name: accounts.name })
      .from(sessions)
      .innerJoin(accounts, eq(accounts.id, sessions.accountId))
      .where(and(eq(sessions.tokenHash, sha256(session)), gt(sessions.expiresAt, this.clock())));
    return row ?? null;
  }

  // The account's shops, oldest first. The MVP workbench uses the first one.
  async shopsOf(accountId: string) {
    return this.db
      .select({ id: shops.id, slug: shops.slug, name: shops.name, industry: shops.industry })
      .from(memberships)
      .innerJoin(shops, eq(shops.id, memberships.shopId))
      .where(eq(memberships.accountId, accountId))
      .orderBy(memberships.createdAt);
  }

  async canManage(accountId: string, shopId: string) {
    const [m] = await this.db
      .select({ shopId: memberships.shopId })
      .from(memberships)
      .where(and(eq(memberships.accountId, accountId), eq(memberships.shopId, shopId)));
    return m !== undefined;
  }

  async addOwner(accountId: string, shopId: string) {
    await this.db.insert(memberships).values({ accountId, shopId, role: "owner", createdAt: this.clock() }).onConflictDoNothing();
  }

  private async startSession(accountId: string) {
    const token = `oss_${randomBytes(24).toString("base64url")}`;
    const now = this.clock();
    await this.db.insert(sessions).values({ tokenHash: sha256(token), accountId, expiresAt: new Date(now.getTime() + SESSION_TTL_MS), createdAt: now });
    return token;
  }
}
