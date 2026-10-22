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
- [开发中自行决定的事项](docs/dev-notes.md)：MVP 阶段的实现细节和发布前要改的地方
- [部署手册](docs/deploy.md)：服务器和域名的准备、首次部署、更新、日志、备份与恢复

## 本地运行

需要 Node 26 和 pnpm。数据库默认用进程内的 PGlite，不需要 Docker。

```bash
pnpm install
pnpm start           # 打包商家后台并启动服务：http://localhost:8788
pnpm dev             # 开发模式：服务端 8788 + 商家后台热更新 http://localhost:5173/admin/
pnpm test            # 全部测试
pnpm typecheck
```

打开 http://localhost:8788 会进入商家后台。首次启动会自动准备四个账号，密码都是 `openshop123`：

| 账号 | 状态 | 用来做什么 |
|---|---|---|
| `demo@openshop.dev` | 美甲店，走完了注册、开店表单、换商品、装修、发布的全流程，有几笔订单。用“简约”模板 | 看一家建好的店：后台各页面，以及它的店铺网站 http://localhost:8788/s/moon-nail |
| `fashion@openshop.dev` | 服装店，用“服装”模板，卖快递商品 | http://localhost:8788/s/baiyi |
| `food@openshop.dev` | 餐厅，用“餐厅”模板，订座、套餐，也卖辣椒酱 | http://localhost:8788/s/xiangkou |
| `try@openshop.dev` | 只注册了，还没有店 | 自己从开店向导开始体验。也可以在登录页点“免费开店”注册新账号 |

店铺网站有四个模板：简约、服装、餐厅、美业。开店时选一个（默认按行业推荐），之后在“店铺装修”里随时能换，内容不受影响。

数据存在 `apps/server/.data/`，删掉这个目录就能从头再来。

店铺网页在 `/s/<店铺地址>`，比如 http://localhost:8788/s/moon-nail。另外还有两家只能用 API 管理的演示店：http://localhost:8788/s/nail-studio（预约）和 http://localhost:8788/s/bakery（快递），CLI 和 Skill 的例子用的是它们。页面由服务端渲染，用手机宽度看效果最好。每家店还提供给 agent 用的 `/s/<店铺地址>/llms.txt` 和 `/s/<店铺地址>/.well-known/openshop.json`。

### 让 agent 来下单

消费者这一侧有三种接入方式，用的是同一套工具：

- **CLI 加 Skill**（Claude Code 等桌面 agent 推荐用这个）：

  ```bash
  pnpm --filter @openshop/cli build
  ln -s "$PWD/packages/cli/dist/openshop.mjs" ~/.local/bin/openshop   # 放到 PATH 里的任意目录
  cp -r skill/openshop ~/.claude/skills/
  ```

  然后在 Claude Code 里说"帮我约 http://localhost:8788/s/nail-studio 周六下午做个法式"。`openshop --help` 可以查看全部命令。消费者的称呼、手机号、地址和订单凭证保存在 `~/.openshop`。
- **本地 MCP**：`openshop mcp`（stdio），比 Skill 多了 `profile_get` 和 `profile_save`。
- **远程 MCP**：服务端的 `/mcp`（Streamable HTTP），不需要登录。因为没有本地存储，agent 要自己保存下单时返回的 `accessToken`。

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
