import type OpenAI from "openai";
import { describe, expect, it } from "vitest";
import { setup } from "./test-helpers.ts";

type Reply = OpenAI.Chat.ChatCompletionMessage;

// Plays back the model's side of a conversation, one reply per request, and records what
// each request sent so tests can check the tool results.
function scripted(replies: Partial<Reply>[]) {
  const requests: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming[] = [];
  const client = {
    chat: {
      completions: {
        create: async (params: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming) => {
          requests.push(structuredClone(params));
          const next = replies.shift();
          if (!next) throw new Error("no scripted reply left");
          return { choices: [{ message: { role: "assistant", content: null, ...next } }] };
        },
      },
    },
  } as unknown as OpenAI;
  return { client, requests };
}

const tool = (id: string, name: string, input: unknown): Partial<Reply> => ({
  tool_calls: [{ id, type: "function", function: { name, arguments: JSON.stringify(input) } }],
});
const say = (content: string): Partial<Reply> => ({ content });
// The tool message answering a call, from the request after it.
const result = (req: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming, id: string) =>
  req.messages.find((m) => m.role === "tool" && m.tool_call_id === id)?.content;

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

    // The shop snapshot went to the model; the edits wait in the changeset like hand-made ones.
    expect(String(result(requests[1]!, "t1"))).toContain("法式美甲");
    const shop = await t.ok("GET", "/api/merchant/shop", { token });
    expect(shop.page.theme.primary).toBe("#e8590c");
    expect(shop.page.sections[1]).toMatchObject({ type: "banner", props: { title: "周末 8 折" } });
    expect(shop.changes).toHaveLength(2);
    // Nothing is live until the merchant publishes.
    expect((await t.ok("GET", "/api/s/nail-studio")).theme?.primary).not.toBe("#e8590c");
  });

  it("hands bad edits back to the model instead of failing the turn", async () => {
    const { client, requests } = scripted([
      tool("t1", "propose_change", { change: { kind: "section.remove", id: "nope" } }),
      say("没找到那个区块。"),
    ]);
    const t = await setup(undefined, { agent: { client, model: "test" } });
    const { token } = await t.nailStudio();
    const turn = await t.ok("POST", "/api/merchant/agent/chat", { token, body: { messages: [{ role: "user", content: "删掉相册" }] } });
    expect(turn.changes).toEqual([]);
    expect(result(requests[1]!, "t1")).toBe("错误：找不到区块 nope");
  });

  it("says so when no model key is configured", async () => {
    const t = await setup();
    const { token } = await t.nailStudio();
    const r = await t.call("POST", "/api/merchant/agent/chat", { token, body: { messages: [{ role: "user", content: "你好" }] } });
    expect(r.status).toBe(503);
  });
});
