import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { SECTIONS } from "@openshop/core";
import { opInputSchema } from "./content.ts";
import { ShopError } from "./shop.ts";
import type { Change, Studio } from "./studio.ts";

// The merchant agent inside the workbench (product-decisions #13, #15): the merchant says what
// to change, Claude turns it into content edits. Every edit goes through studio.propose, so it
// lands in the open changeset like a hand-made one: previewed, undoable, live only on publish.
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
- 每一处修改调用一次 propose_change。修改先进入“待发布修改”，商家在右边的预览里能马上看到，确认后自己点发布
- 改错了用 undo_change 撤销
- 不要编造商家没说过的事实，比如价格、电话、地址。需要的信息问商家
- 商家说得模糊时（“好看一点”“喜庆一点”），直接给一个合理的改法并做出来，不用反复确认
- 你只能改店铺内容。订单、库存、休息时间、收款不归你管，告诉商家去工作台对应的页面
- 回复用简短的中文，说清楚改了什么。不要用 Markdown 标题和表格

区块类型和 props（section.add / section.update 用；update 只传要改的字段，会和原来的合并）：
${sectionDocs}

主题：style 是模板（minimal 简约、fashion 服装、dining 餐厅、beauty 美业），primary 是主色（#rrggbb），font 是 system/rounded/serif，radius 是 square/soft/round。
商品价格以分为单位（priceFen：¥42 写 4200）。product.update 要传完整的商品，没改的字段照 get_shop 里的原样带上。`;

const tools: Anthropic.Tool[] = [
  {
    name: "get_shop",
    description: "读取店铺当前的预览内容（线上内容加上还没发布的修改），以及待发布修改的清单。",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "propose_change",
    description: "提交一处修改到待发布修改。返回这条修改的说明；失败时返回原因，按原因改正后再试。",
    input_schema: z.toJSONSchema(z.object({ change: opInputSchema }), { io: "input" }) as Anthropic.Tool.InputSchema,
  },
  {
    name: "undo_change",
    description: "撤销一条待发布修改（id 来自 get_shop 的 changes 或 propose_change 的返回）。之后对同一处的修改会一起撤销。",
    input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
];

export class MerchantAgent {
  constructor(
    private readonly studio: Studio,
    private readonly client: Anthropic,
    private readonly model: string,
  ) {}

  // Runs one merchant turn. Returns Claude's reply and the changes it made this turn.
  async chat(shopId: string, history: ChatMessage[]): Promise<{ reply: string; changes: Change[] }> {
    const messages: Anthropic.Beta.BetaMessageParam[] = history.map((m) => ({ role: m.role, content: m.content }));
    const made: Change[] = [];

    for (let step = 0; step < MAX_STEPS; step++) {
      const res = await this.client.beta.messages.create({
        model: this.model,
        max_tokens: 16000,
        system: SYSTEM,
        tools,
        messages,
        output_config: { effort: "low" },
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      });
      messages.push({ role: "assistant", content: res.content });
      const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n").trim();

      if (res.stop_reason === "refusal") return { reply: "这个请求我没法处理，换个说法试试？", changes: made };
      if (res.stop_reason !== "tool_use") return { reply: text || "好的。", changes: made };

      const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
      for (const call of res.content) {
        if (call.type !== "tool_use") continue;
        const { content, isError } = await this.run(shopId, call.name, call.input, made);
        results.push({ type: "tool_result", tool_use_id: call.id, content, is_error: isError });
      }
      messages.push({ role: "user", content: results });
    }
    return { reply: "这次改动有点多，我先停在这里。看看预览，需要的话再告诉我接着改。", changes: made };
  }

  private async run(shopId: string, name: string, input: unknown, made: Change[]) {
    try {
      switch (name) {
        case "get_shop": {
          const { previewUrl: _, ...overview } = await this.studio.overview(shopId);
          return { content: JSON.stringify(overview), isError: false };
        }
        case "propose_change": {
          const parsed = z.object({ change: opInputSchema }).safeParse(input);
          if (!parsed.success) return { content: z.prettifyError(parsed.error), isError: true };
          const { change } = await this.studio.propose(shopId, parsed.data.change);
          made.push(change);
          return { content: JSON.stringify(change), isError: false };
        }
        case "undo_change": {
          const { undone } = await this.studio.undo(shopId, String((input as { id?: unknown }).id));
          const gone = new Set(undone.map((c) => c.id));
          made.splice(0, made.length, ...made.filter((c) => !gone.has(c.id)));
          return { content: JSON.stringify(undone), isError: false };
        }
        default:
          return { content: `未知的工具 ${name}`, isError: true };
      }
    } catch (err) {
      if (err instanceof ShopError) return { content: err.message, isError: true };
      throw err;
    }
  }
}
