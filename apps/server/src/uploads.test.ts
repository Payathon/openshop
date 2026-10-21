import { expect, it } from "vitest";
import { BASE, setup } from "./test-helpers.ts";

// The smallest valid PNG header plus a little payload.
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

async function upload(t: Awaited<ReturnType<typeof setup>>, data: Uint8Array<ArrayBuffer>, token?: string) {
  const res = await t.app.request(`${BASE}/api/merchant/uploads`, {
    method: "POST",
    headers: { "content-type": "image/png", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: data,
  });
  return { status: res.status, body: await res.json() };
}

it("stores a merchant's image and serves it back", async () => {
  const t = await setup();
  const { token } = await t.bakery();
  const r = await upload(t, png, token);
  expect(r.status).toBe(201);
  expect(r.body.url).toBe(`${BASE}/files/${r.body.key}`);
  expect(r.body.key).toMatch(/^shops\/shop_[0-9a-f]+\/[0-9a-f]{24}\.png$/);

  const file = await t.app.request(r.body.url);
  expect(file.status).toBe(200);
  expect(file.headers.get("content-type")).toBe("image/png");
  expect(new Uint8Array(await file.arrayBuffer())).toEqual(png);
});

it("takes only images, within the size limit, from a merchant", async () => {
  const t = await setup();
  const { token } = await t.bakery();
  expect((await upload(t, png)).status).toBe(401);
  // Declared as PNG but isn't one.
  const fake = await upload(t, new TextEncoder().encode("<script>alert(1)</script>"), token);
  expect(fake).toMatchObject({ status: 415, body: { error: "unsupported_type" } });
  const huge = new Uint8Array(5 * 1024 * 1024 + 1);
  huge.set(png);
  expect((await upload(t, huge, token)).body.error).toBe("too_large");
});

it("serves nothing outside the uploads", async () => {
  const t = await setup();
  for (const path of ["/files/shops/x/nope.png", "/files/..%2F..%2Fetc%2Fpasswd", "/files/shops/x/a.html"]) {
    expect((await t.app.request(`${BASE}${path}`)).status).toBe(404);
  }
});
