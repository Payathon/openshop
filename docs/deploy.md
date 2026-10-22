# 部署手册

app 负责 API、`/mcp` 和店铺网页，Postgres 存数据，另有一个服务每天做备份，HTTPS 由 Caddy 负责。所有文件都在 `deploy/` 下。为什么部署在海外、为什么不选香港，见 [tech-plan.md](tech-plan.md) 的部署一节。

## 现在的部署

和 [hive](https://github.com/Payathon/hive) 共用一台阿里云新加坡 ECS（2 vCPU / 3.5 GB，Ubuntu 22.04，`47.84.123.150`）：

| 地址 | 应用 |
|---|---|
| https://shop.47-84-123-150.sslip.io | OpenShop，例如 `/s/moon-nail`、`/admin` |
| https://hive.47-84-123-150.sslip.io | hive |

还没有真域名，用的是 [sslip.io](https://sslip.io)：`<任意名字>.47-84-123-150.sslip.io` 自动解析到这个 IP，Let's Encrypt 照样能签证书。

```
/opt/edge      共用的 Caddy（项目名 edge）：占 80/443，签所有证书，按域名转给各个应用。
               来自 hive 仓库的 deploy/edge/，hive 的 CD 维护
  sites/openshop.caddy   ← 本仓库 up.sh 用 deploy/site.caddy 生成，域名取自 .env
/opt/openshop  app + postgres + backup（项目名 openshop，数据卷 openshop_pgdata、openshop_uploads）
  .env  docker-compose*.yml  Caddyfile  site.caddy  backup.sh  up.sh  backups/
/opt/hive      hive，见 hive 仓库的 deploy/README.md
```

各个 compose 项目通过外部 docker 网络 `edge` 连起来，app 在上面叫 `openshop`，自己不占端口。

| 文件 | 作用 |
|---|---|
| `docker-compose.yml` | app、postgres、backup 和数据卷 |
| `docker-compose.edge.yml` | 共用服务器：app 加入 `edge` 网络（现在用的） |
| `docker-compose.caddy.yml` | 这台机器只跑 OpenShop：自带 Caddy，占 80/443（用 `Caddyfile`） |
| `docker-compose.build.yml` | 从源码构建镜像，不从 GHCR 拉 |
| `docker-compose.local.yml` | 在自己电脑上试，HTTP 8080 |
| `site.caddy` | 共用 Caddy 上的站点配置模板 |
| `up.sh` | 启动或更新：拉镜像、`up -d`、写站点配置并 reload 共用 Caddy。CD 和手动都用它 |

用哪几个 compose 文件由 `.env` 里的 `COMPOSE_FILE` 决定（docker compose 自己会读），所以在 `/opt/openshop` 里直接 `docker compose ps`、`docker compose logs -f app` 就行：

- 共用服务器：`COMPOSE_FILE=docker-compose.yml:docker-compose.edge.yml`
- 只跑 OpenShop：`COMPOSE_FILE=docker-compose.yml:docker-compose.caddy.yml`
- 任一种后面加 `:docker-compose.build.yml`：在服务器上从源码构建

## 要准备的东西

| 东西 | 建议 | 填到哪里 |
|---|---|---|
| 服务器 | 阿里云国际站（alibabacloud.com），新加坡区，轻量应用服务器或 ECS，2 核 4 GB，60 GB SSD，系统选 Ubuntu 24.04 | 记下公网 IP |
| 防火墙 | 入方向放行 TCP 22、80、443，以及 UDP 443（HTTP/3，可选），来源 `0.0.0.0/0` | 控制台的防火墙或安全组 |
| 域名 | 一个 `.com` 等普通域名，不需要备案；没有就先用 `shop.<IP 用横线连>.sslip.io` | `.env` 的 `OPENSHOP_DOMAIN`（`PUBLIC_URL` 默认跟着它） |
| DNS | `@` 的 A 记录指向服务器 IP。以后做店铺子域名时，再加一条 `*` 的 A 记录 | 域名服务商的解析设置 |
| 数据库密码 | `openssl rand -hex 24` 生成 | `.env` 的 `POSTGRES_PASSWORD` |
| 预览签名密钥 | `openssl rand -hex 32` 生成；不填的话每次重启预览链接就失效 | `.env` 的 `PREVIEW_SECRET` |
| 支付宝收款（可选） | 开放平台应用的 APPID、应用私钥（PKCS#1）、支付宝公钥，都填不带 PEM 头尾的原始字符串。付款通知地址（`https://<域名>/payments/alipay/notify`）随每笔下单请求发给支付宝，不用在开放平台配置。不填就用模拟收银台 | `.env` 的 `ALIPAY_*` |

服务端不调 Claude API，不需要 Anthropic 的 key。

## 第一次部署（共用服务器）

前提：共用 Caddy 已经在 `/opt/edge`（hive 的 CD 会建，或者按 hive 仓库 `deploy/README.md` 手动拷 `deploy/edge/`）。

```bash
ssh root@<服务器 IP>
mkdir -p /opt/openshop && cd /opt/openshop
# 照 deploy/.env.example 写 .env：COMPOSE_FILE、OPENSHOP_DOMAIN、POSTGRES_PASSWORD、PREVIEW_SECRET
vi .env
```

然后让 CD 来（push 到 main，或 `gh workflow run deploy.yml -R Payathon/openshop`）：它把 `deploy/` 的文件拷到 `/opt/openshop`，拉镜像，跑 `./up.sh`。以后在服务器上手动更新也是 `cd /opt/openshop && ./up.sh`。

只跑 OpenShop 的机器：`COMPOSE_FILE=docker-compose.yml:docker-compose.caddy.yml`，不需要 `/opt/edge`；或者把仓库 clone 下来，在 `deploy/` 里放 `.env`，`COMPOSE_FILE` 再加 `:docker-compose.build.yml`，跑 `./up.sh` 就在本机构建。

Caddy 第一次收到请求时会自动申请 HTTPS 证书，大约需要几十秒，前提是 DNS 已经生效，并且 80 和 443 端口能从外网访问。签不下来看 `docker compose -f /opt/edge/docker-compose.yml logs caddy`。

如果 `.env` 里 `SEED=1`，第一次启动时会建两家演示店，商家令牌打印在日志里；`SEED_ACCOUNTS=1` 再建三家装修好的店（`moon-nail`、`baiyi`、`xiangkou`）和工作台账号，密码 `openshop123` 写在代码里，所以只适合演示：

```bash
docker compose logs app | grep -A6 "merchant tokens\|workbench accounts"
```

## 换成真域名

改 `/opt/openshop/.env` 的 `OPENSHOP_DOMAIN`，跑 `./up.sh`。共用 Caddy 会换上新的站点配置并自动签证书。`PUBLIC_URL` 没单独填就跟着变。

## 自动部署（GitHub Actions）

| 工作流 | 触发 | 做什么 |
|---|---|---|
| `ci.yml` | push、PR | 装依赖、typecheck、测试（PGlite）、构建工作台、构建镜像（不推） |
| `deploy.yml` | `main` 上 CI 通过后（也可手动触发） | 构建镜像推到 `ghcr.io/payathon/openshop`（`sha-<12位>` 和 `latest`），再 SSH 到服务器：拷 `deploy/` 的文件到 `/opt/openshop`，用工作流自己的 token 临时登录 GHCR，`OPENSHOP_IMAGE=…:sha-… ./up.sh`，等健康检查通过 |

仓库 secrets（已设好，和 hive 共用一把 deploy key）：`DEPLOY_HOST=47.84.123.150`、`DEPLOY_USER=root`、`DEPLOY_SSH_KEY`（私钥全文，公钥在服务器 root 的 `authorized_keys` 里）。没设时 deploy 只推镜像、跳过上线。

`.env` 只在服务器上，CI 不碰它。回滚：`OPENSHOP_IMAGE=ghcr.io/payathon/openshop:sha-<旧版本> ./up.sh`。GHCR 包默认私有，服务器上手动拉要先 `docker login ghcr.io`，或者在 GitHub 的 Packages → openshop → Package settings 改成 Public；拉不到时 `up.sh` 会继续用机器上已有的镜像。

## 更新

push 到 main 即可。手动：`cd /opt/openshop && ./up.sh`。只换 app，Postgres 不动。只有一个实例，所以切换时有几秒钟访问不了。app 启动时会自动执行数据库迁移。

## 日志

```bash
docker compose logs -f app      # 应用日志，包括付款同步的报错
docker compose -f /opt/edge/docker-compose.yml logs -f caddy   # 访问和证书（只跑 OpenShop 时是 docker compose logs -f caddy）
```

每个服务的日志最多保留 5 个 20 MB 的文件，自动轮转。

## 备份

每天北京时间 3 点（`BACKUP_HOUR_UTC=19`）自动备份到服务器的 `/opt/openshop/backups/`：

- `openshop-<时间>.dump`：数据库，pg_dump 的 custom 格式
- `uploads-<时间>.tar.gz`：商家上传的图片

保留 `BACKUP_KEEP_DAYS` 天，默认 14 天。

随时手动备份一次：

```bash
docker compose run --rm backup now
```

**复制到服务器以外**：备份和数据库在同一台机器上，机器坏了备份也就没了。正式有商家以后，建一个 OSS 存储桶（新加坡区），在服务器上装好 `ossutil`，加一条 cron：

```bash
# crontab -e
30 3 * * * ossutil sync /opt/openshop/backups oss://<存储桶名>/backups --update
```

## 恢复

```bash
cd /opt/openshop
docker compose stop app

# 数据库：清空后从备份恢复
docker compose exec postgres dropdb -U openshop openshop
docker compose exec postgres createdb -U openshop openshop
docker compose exec -T postgres pg_restore -U openshop -d openshop --no-owner < backups/openshop-<时间>.dump

# 图片：解压回 uploads 卷（卷名是 compose 项目名 openshop 加 _uploads）
docker run --rm -v openshop_uploads:/uploads -v "$PWD/backups:/backups:ro" alpine \
  tar -xzf /backups/uploads-<时间>.tar.gz -C /uploads

docker compose start app
```

## 在自己电脑上试一遍

不需要域名，走 HTTP，端口 8080：

```bash
cd deploy
docker compose -f docker-compose.yml -f docker-compose.build.yml -f docker-compose.caddy.yml -f docker-compose.local.yml --env-file .env.local.example up -d --build
open http://localhost:8080/s/nail-studio
docker compose -f docker-compose.yml -f docker-compose.build.yml -f docker-compose.caddy.yml -f docker-compose.local.yml --env-file .env.local.example down -v   # 用完删掉，包括数据
```

## 以后要加的

- **店铺子域名**：DNS 加 `*` 记录；共用 Caddy（hive 仓库 `deploy/edge`）换成带 `caddy-dns/alidns` 插件的版本；在 `site.caddy` 里加上泛域名那一段（写法见 `Caddyfile` 的注释），并填入阿里云 AccessKey；app 里实现按 Host 识别店铺
- **多实例**：数据库换成云数据库 RDS，图片换成 OSS（`apps/server/src/storage.ts` 里有说明），app 起多个实例，前面加负载均衡。付款同步已经支持多实例，不需要改
