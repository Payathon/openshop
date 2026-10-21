import { describe, expect, it } from "vitest";
import { DEMO, seedAccounts, TRY } from "./seed-accounts.ts";
import { BASE, setup } from "./test-helpers.ts";

// A browser: keeps the session cookie between requests.
function browser(app: Awaited<ReturnType<typeof setup>>["app"]) {
  let cookie = "";
  return async (method: string, path: string, body?: unknown) => {
    const res = await app.request(`${BASE}${path}`, {
      method,
      headers: { ...(cookie ? { cookie } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0]!;
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null, setCookie: set };
  };
}

const onboarding = { industry: "nail", name: "小美美甲", phone: "13800000000" };

describe("merchant accounts", () => {
  it("registers, opens a shop that belongs to the account, and manages it with the session", async () => {
    const t = await setup();
    const b = browser(t.app);
    const reg = await b("POST", "/api/auth/register", { name: "小美", email: "Mei@Example.com", password: "password1" });
    expect(reg.status).toBe(201);
    expect(reg.setCookie).toMatch(/os_session=.*HttpOnly/i);
    expect((await b("GET", "/api/auth/me")).body).toEqual({ account: { id: expect.any(String), email: "mei@example.com", name: "小美" }, shop: null });

    const created = await b("POST", "/api/onboarding", onboarding);
    expect(created.status).toBe(201);
    const me = (await b("GET", "/api/auth/me")).body;
    expect(me.shop).toMatchObject({ id: created.body.shop.id, status: "draft", name: "小美美甲" });

    // The session alone reaches the merchant API.
    const overview = await b("GET", "/api/merchant/shop");
    expect(overview.status).toBe(200);
    expect(overview.body.products.every((p: { sample: boolean }) => p.sample)).toBe(true);

    // One shop per account for now.
    expect((await b("POST", "/api/onboarding", onboarding)).body.error).toBe("has_shop");
  });

  it("logs in and out", async () => {
    const t = await setup();
    await browser(t.app)("POST", "/api/auth/register", { name: "小美", email: "mei@example.com", password: "password1" });
    const b = browser(t.app);
    expect((await b("POST", "/api/auth/login", { email: "mei@example.com", password: "wrong-pass" })).body.error).toBe("bad_credentials");
    expect((await b("POST", "/api/auth/login", { email: "nobody@example.com", password: "password1" })).body.message).toBe("邮箱或密码不对");
    expect((await b("POST", "/api/auth/login", { email: " MEI@example.com ", password: "password1" })).status).toBe(200);
    expect((await b("GET", "/api/auth/me")).status).toBe(200);
    await b("POST", "/api/auth/logout");
    expect((await b("GET", "/api/auth/me")).status).toBe(401);
  });

  it("refuses duplicate emails, weak passwords and strangers", async () => {
    const t = await setup();
    const b = browser(t.app);
    await b("POST", "/api/auth/register", { name: "小美", email: "mei@example.com", password: "password1" });
    expect((await browser(t.app)("POST", "/api/auth/register", { name: "x", email: "MEI@example.com", password: "password1" })).body.error).toBe("email_taken");
    expect((await browser(t.app)("POST", "/api/auth/register", { name: "x", email: "a@b.co", password: "short" })).status).toBe(400);
    // Signed in but without a shop, and signed out: no merchant API.
    expect((await b("GET", "/api/merchant/shop")).status).toBe(401);
    expect((await browser(t.app)("GET", "/api/merchant/orders")).status).toBe(401);
  });

  it("keeps a merchant token working without an account", async () => {
    const t = await setup();
    const { token } = await t.nailStudio();
    expect((await t.call("GET", "/api/merchant/shop", { token })).status).toBe(200);
  });

  it("seeds a finished shop and an account still to onboard, once", async () => {
    const t = await setup();
    expect(await seedAccounts(t.app, BASE)).toBe(true);
    expect(await seedAccounts(t.app, BASE)).toBe(false);

    const demo = browser(t.app);
    await demo("POST", "/api/auth/login", { email: DEMO.email, password: DEMO.password });
    const me = (await demo("GET", "/api/auth/me")).body;
    expect(me.shop).toMatchObject({ slug: DEMO.slug, status: "live" });
    const overview = (await demo("GET", "/api/merchant/shop")).body;
    expect(overview.changes).toEqual([]);
    expect(overview.products.some((p: { sample: boolean }) => p.sample)).toBe(false);
    expect(overview.products.every((p: { images: string[] }) => p.images.length === 1)).toBe(true);
    const orders = (await demo("GET", "/api/merchant/orders")).body as { status: string; source: string }[];
    expect(orders.filter((o) => o.status === "confirmed")).toHaveLength(2);
    expect(orders.some((o) => o.source === "agent")).toBe(true);
    // The public shop is up.
    expect((await t.call("GET", `/api/s/${DEMO.slug}`)).status).toBe(200);

    const fresh = browser(t.app);
    await fresh("POST", "/api/auth/login", { email: TRY.email, password: TRY.password });
    expect((await fresh("GET", "/api/auth/me")).body.shop).toBeNull();
  });
});
