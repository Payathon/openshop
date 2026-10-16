# OpenShop

AI 版有赞：帮中小商家搭一个属于自己的独立站，并把店铺能力以 MCP / Skill 的形式开放给 AI agent。

PAYATHON 2026 参赛项目。比赛规则见上级目录 [`../docs/PROJECT_CONTEXT.md`](../docs/PROJECT_CONTEXT.md)。

## 动机

- 国内大量商家活在美团、淘宝这类平台上，没有自己的独立站；平台不开放接口，agent 很难接进来。
- 未来 agent 会成为最大的流量入口，帮商家做数字化基础建设是机会。
- 形态：SaaS，开箱即用的组件。商家不用开发，店是商家自己的，不是平台的。
- "接进来"的意思：每家店暴露 MCP，agent 能直接操作（查商品/空档、下单、付款）；同时提供 Skill，降低 agent 的学习成本。

## 文档

- [产品决策记录](docs/product-decisions.md)：产品形态、模块、流程、收费方式等已确认的决定
- [支付可行性调研](docs/payment-research.md)
- [技术方案](docs/tech-plan.md)：技术栈、数据模型、API、MCP、里程碑

## 本地运行

需要 Node 26 和 pnpm。数据库默认用进程内的 PGlite，不需要 Docker。

```bash
pnpm install
pnpm test            # 全部测试
pnpm typecheck
cd apps/server && pnpm dev   # http://localhost:8788，首次启动会建两家演示店并打印商家令牌
```

现在用的是模拟支付：下单返回的 `paymentUrl` 是一个本地的模拟收银台页面，点"确认付款"即视为付款成功。模拟支付的状态只保存在内存里，服务重启后，之前未付款的订单会被当作过期。

## 初步 MVP 设想（已被决策记录取代）

1. **一句话开店**：商家和 agent 对话，生成店铺页（H5）+ 专属 MCP endpoint + Skill。
2. **Agent 下单**：消费者在自己的 agent 里装上店铺 Skill，查询、下单，并通过支付宝 AI 付完成付款。
3. **商家接单**：订单通知与简单后台。

## 待决定

- 目标商家：倾向于预约制服务型商家（美甲、理发、私教、摄影、民宿、手作课），尚未确认。
- 收款主体：A 自己先当第一个商家（Agent Pay 赛道）/ B 向商家收订阅或按单费用 / A+B。
- Discovery：消费者的 agent 如何发现这家店（私域分发 Skill、商家目录 MCP……）。
- 合规：避免平台代收再分账（二清）。
