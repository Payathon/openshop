import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { setup } from "./test-helpers.ts";

// Plays back Claude's side of a conversation, one response per request, and records what
// each request sent so tests can check the tool results.
function scripted(responses: Partial<Anthropic.Beta.BetaMessage>[]) {
  const requests: Anthropic.Beta.MessageCreateParams[] = [];
  const client = {
    beta: {
      messages: {
        create: async (params: Anthropic.Beta.MessageCreateParams) => {
          requests.push(structuredClone(params));
          const next = responses.shift();
          if (!next) throw new Error("no scripted response left");
          return next;
        },
      },
    },
  } as unknown as Anthropic;
  return { client, requests };
}

const tool = (id: string, name: string, input: unknown) => ({ stop_reason: "tool_use" as const, content: [{ type: "tool_use" as const, id, name, input, caller: { type: "direct" as const } }] });
const say = (text: string) => ({ stop_reason: "end_turn" as const, content: [{ type: "text" as const, text, citations: null }] });

describe("merchant agent", () => {
  it("turns a request into pending changes the merchant can see and undo", async () => {
    const { client, requests } = scripted([
      tool("t1", "get_shop", {}),
      tool("t2", "propose_change", { change: { kind: "theme.update", patch: { primary: "#e8590c" } } }),
      tool("t3", "propose_change", { change: { kind: "section.add", section: { type: "banner", props: { title: "周末 8 折" } }, index: 1 } }),
      say("主色换成了橙色，首页加了“周末 8 折”的横幅。"),
    ]);
    const t = await setup(undefined, { agent: { client, model: "test" } });
    const { token } = await t.nailStudio();

    const turn = await t.ok("POST", "/api/merchant/agent/chat", { token, body: { messages: [{ role: "user", content: "主色换成橙色，首页放个周末 8 折" }] } });
    expect(turn.reply).toContain("橙色");
    expect(turn.changes.map((c: { kind: string }) => c.kind)).toEqual(["theme.update", "section.add"]);

    // The shop snapshot went to Claude; the edits wait in the changeset like hand-made ones.
    const results = requests[1]!.messages.at(-1)!.content as Anthropic.Beta.BetaToolResultBlockParam[];
    expect(String(results[0]!.content)).toContain("法式美甲");
    const shop = await t.ok("GET", "/api/merchant/shop", { token });
    expect(shop.page.theme.primary).toBe("#e8590c");
    expect(shop.page.sections[1]).toMatchObject({ type: "banner", props: { title: "周末 8 折" } });
    expect(shop.changes).toHaveLength(2);
    // Nothing is live until the merchant publishes.
    expect((await t.ok("GET", "/api/s/nail-studio")).theme?.primary).not.toBe("#e8590c");
  });

  it("hands bad edits back to Claude instead of failing the turn", async () => {
    const { client, requests } = scripted([
      tool("t1", "propose_change", { change: { kind: "section.remove", id: "nope" } }),
      say("没找到那个区块。"),
    ]);
    const t = await setup(undefined, { agent: { client, model: "test" } });
    const { token } = await t.nailStudio();
    const turn = await t.ok("POST", "/api/merchant/agent/chat", { token, body: { messages: [{ role: "user", content: "删掉相册" }] } });
    expect(turn.changes).toEqual([]);
    const [result] = requests[1]!.messages.at(-1)!.content as Anthropic.Beta.BetaToolResultBlockParam[];
    expect(result).toMatchObject({ is_error: true, content: "找不到区块 nope" });
  });

  it("says so when no Claude key is configured", async () => {
    const t = await setup();
    const { token } = await t.nailStudio();
    const r = await t.call("POST", "/api/merchant/agent/chat", { token, body: { messages: [{ role: "user", content: "你好" }] } });
    expect(r.status).toBe(503);
  });
});
