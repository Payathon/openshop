import { describe, expect, it } from "vitest";
import { checkOptionValues, type OrderOption } from "./catalog.ts";

const options: OrderOption[] = [
  { key: "spice", label: "辣度", type: "choice", choices: ["微辣", "中辣", "特辣"], required: true },
  { key: "note", label: "备注", type: "text", required: false },
];

describe("checkOptionValues", () => {
  it("accepts a valid choice and an omitted optional field", () => {
    expect(checkOptionValues(options, { spice: "中辣" })).toEqual({ ok: true, values: { spice: "中辣" } });
  });

  it("reports a missing required option by its label", () => {
    expect(checkOptionValues(options, {})).toEqual({ ok: false, error: "缺少下单选项：辣度" });
  });

  it("rejects a choice that is not offered", () => {
    expect(checkOptionValues(options, { spice: "变态辣" })).toEqual({
      ok: false,
      error: "辣度 只能选择：微辣、中辣、特辣",
    });
  });

  it("rejects keys the product does not define", () => {
    expect(checkOptionValues(options, { spice: "微辣", size: "大" })).toEqual({ ok: false, error: "未知的下单选项：size" });
  });
});
