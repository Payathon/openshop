import type OpenAI from "openai";
import { z } from "zod";
import { SECTIONS } from "@openshop/core";
import { opInputSchema } from "./content.ts";
import { ShopError } from "./shop.ts";
import type { Change, Studio } from "./studio.ts";

// The merchant agent inside the workbench (product-decisions #13, #15): the merchant says what
// to change, the model (DeepSeek, through its OpenAI-format API) turns it into content edits.
// Every edit goes through studio.propose, so it lands in the open changeset like a hand-made
// one: previewed, undoable, live only on publish.
//
// Demo scope: no stored threads. The browser sends the text of the conversation each turn.

const MAX_STEPS = 8;

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export const chatSchema = z.object({
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(4000) }))
    .min(1)
    .max(40)
    .refine((m) => m.at(-1)?.role === "user", "最后一条必须是商家的消息"),
});

const sectionDocs = Object.entries(SECTIONS)
  .map(([type, d]) => `- ${type}（${d.label}${d.single ? "，每页最多一个" : ""}）：${JSON.stringify(z.toJSONSchema(d.props, { io: "input" }).properties)}`)
  .join("\n");

const SYSTEM = `你是 OpenShop 的店铺装修助手，帮中小商家用对话修改自己的店铺网站。

工作方式：
- 先调用 get_shop 看店铺现在的内容（店铺信息、主题、页面区块和它们的 id、商品），再动手
- 每一处修改调用一次 propose_change。修改先进入“待发布修改”，商家在预览里能马上看到，确认后自己点发布
- 改错了用 undo_change 撤销
- 不要编造商家没说过的事实，比如价格、电话、地址。需要的信息问商家
- 商家说得模糊时（“好看一点”“喜庆一点”），直接给一个合理的改法并做出来，不用反复确认
- 你只能改店铺内容。订单、库存、休息时间、收款不归你管，告诉商家去工作台对应的页面
- 回复用简短的中文，说清楚改了什么。不要用 Markdown 标题和表格

区块类型和 props（section.add / section.update 用；update 只传要改的字段，会和原来的合并）：
${sectionDocs}

主题：style 是模板（minimal 简约、fashion 服装、dining 餐厅、beauty 美业），primary 是主色（#rrggbb），font 是 system/rounded/serif，radius 是 square/soft/round。
商品价格以分为单位（priceFen：¥42 写 4200）。product.update 要传完整的商品，没改的字段照 get_shop 里的原样带上。`;

const fn = (name: string, description: string, parameters: Record<string, unknown>): OpenAI.Chat.ChatCompletionTool => ({
  type: "function",
  function: { name, description, parameters },
});

const tools = [
  fn("get_shop", "读取店铺当前的预览内容（线上内容加上还没发布的修改），以及待发布修改的清单。", { type: "object", properties: {} }),
  fn(
    "propose_change",
    "提交一处修改到待发布修改。返回这条修改的说明；失败时返回原因，按原因改正后再试。",
    z.toJSONSchema(z.object({ change: opInputSchema }), { io: "input" }) as Record<string, unknown>,
  ),
  fn("undo_change", "撤销一条待发布修改（id 来自 get_shop 的 changes 或 propose_change 的返回）。之后对同一处的修改会一起撤销。", {
    type: "object",
    properties: { id: { type: "string" } },
    required: ["id"],
  }),
];

export class MerchantAgent {
  constructor(
    private readonly studio: Studio,
    private readonly client: OpenAI,
    private readonly model: string,
  ) {}

  // Runs one merchant turn. Returns the model's reply and the changes it made this turn.
  async chat(shopId: string, history: ChatMessage[]): Promise<{ reply: string; changes: Change[] }> {
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [{ role: "system", content: SYSTEM }, ...history];
    const made: Change[] = [];

    for (let step = 0; step < MAX_STEPS; step++) {
      // Thinking off: edits are simple and the merchant is watching the preview.
      const params = { model: this.model, messages, tools, thinking: { type: "disabled" } };
      const res = await this.client.chat.completions.create(params as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming);
      const msg = res.choices[0]?.message;
      if (!msg) throw new Error("empty completion");
      const calls = (msg.tool_calls ?? []).filter((c) => c.type === "function");
      if (!calls.length) return { reply: msg.content?.trim() || "好的。", changes: made };

      messages.push({ role: "assistant", content: msg.content ?? "", tool_calls: calls });
      for (const call of calls) {
        let input: unknown;
        try {
          input = JSON.parse(call.function.arguments || "{}");
        } catch {
          messages.push({ role: "tool", tool_call_id: call.id, content: "参数不是合法的 JSON，请重试" });
          continue;
        }
        messages.push({ role: "tool", tool_call_id: call.id, content: await this.run(shopId, call.function.name, input, made) });
      }
    }
    return { reply: "这次改动有点多，我先停在这里。看看预览，需要的话再告诉我接着改。", changes: made };
  }

  // Tool results are text for the model; failures start with 错误 so it corrects itself.
  private async run(shopId: string, name: string, input: unknown, made: Change[]): Promise<string> {
    try {
      switch (name) {
        case "get_shop": {
          const { previewUrl: _, ...overview } = await this.studio.overview(shopId);
          return JSON.stringify(overview);
        }
        case "propose_change": {
          const parsed = z.object({ change: opInputSchema }).safeParse(input);
          if (!parsed.success) return `错误：${z.prettifyError(parsed.error)}`;
          const { change } = await this.studio.propose(shopId, parsed.data.change);
          made.push(change);
          return JSON.stringify(change);
        }
        case "undo_change": {
          const { undone } = await this.studio.undo(shopId, String((input as { id?: unknown }).id));
          const gone = new Set(undone.map((c) => c.id));
          made.splice(0, made.length, ...made.filter((c) => !gone.has(c.id)));
          return JSON.stringify(undone);
        }
        default:
          return `错误：未知的工具 ${name}`;
      }
    } catch (err) {
      if (err instanceof ShopError) return `错误：${err.message}`;
      throw err;
    }
  }
}
