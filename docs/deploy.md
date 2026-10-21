# 部署手册

一台海外服务器跑全部服务：Caddy 负责 HTTPS，app 负责 API、`/mcp` 和店铺网页，Postgres 存数据，另有一个服务每天做备份。所有文件都在 `deploy/` 下。为什么部署在海外、为什么不选香港，见 [tech-plan.md](tech-plan.md) 的部署一节。

## 要准备的东西

| 东西 | 建议 | 填到哪里 |
|---|---|---|
| 服务器 | 阿里云国际站（alibabacloud.com），新加坡区，轻量应用服务器或 ECS，2 核 4 GB，60 GB SSD，系统选 Ubuntu 24.04 | 记下公网 IP |
| 防火墙 | 放行 TCP 22、80、443，以及 UDP 443（HTTP/3，可选） | 控制台的防火墙或安全组 |
| 域名 | 一个 `.com` 等普通域名，不需要备案 | `deploy/.env` 的 `OPENSHOP_DOMAIN` 和 `PUBLIC_URL` |
| DNS | `@` 的 A 记录指向服务器 IP。以后做店铺子域名时，再加一条 `*` 的 A 记录 | 域名服务商的解析设置 |
| 数据库密码 | `openssl rand -hex 24` 生成 | `deploy/.env` 的 `POSTGRES_PASSWORD` |

## 第一次部署

```bash
ssh root@<服务器 IP>

# 安装 Docker（带 compose 插件）
curl -fsSL https://get.docker.com | sh

# 取代码：私有仓库要先给服务器配一个只读的 deploy key
git clone <仓库地址> /opt/openshop
cd /opt/openshop/deploy

cp .env.example .env
vi .env            # 填域名、PUBLIC_URL、数据库密码

docker compose up -d --build
docker compose ps  # app、postgres 显示 healthy
curl https://<域名>/healthz
```

Caddy 第一次收到请求时会自动申请 HTTPS 证书，大约需要几十秒，前提是 DNS 已经生效，并且 80 和 443 端口能从外网访问。

如果 `.env` 里 `SEED=1`，第一次启动时会建两家演示店，商家令牌打印在日志里：

```bash
docker compose logs app | grep -A3 "merchant tokens"
```

## 更新

```bash
cd /opt/openshop && git pull
cd deploy && docker compose up -d --build app
```

只重建 app，Caddy 和 Postgres 不动。只有一个实例，所以切换时有几秒钟访问不了。app 启动时会自动执行数据库迁移。

## 日志

```bash
docker compose logs -f app      # 应用日志，包括付款同步的报错
docker compose logs -f caddy    # 访问和证书
```

每个服务的日志最多保留 5 个 20 MB 的文件，自动轮转。

## 备份

每天北京时间 3 点（`BACKUP_HOUR_UTC=19`）自动备份到服务器的 `/opt/openshop/deploy/backups/`：

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
30 3 * * * ossutil sync /opt/openshop/deploy/backups oss://<存储桶名>/backups --update
```

## 恢复

```bash
cd /opt/openshop/deploy
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
docker compose -f docker-compose.yml -f docker-compose.local.yml --env-file .env.local.example up -d --build
open http://localhost:8080/s/nail-studio
docker compose -f docker-compose.yml -f docker-compose.local.yml --env-file .env.local.example down -v   # 用完删掉，包括数据
```

## 以后要加的

- **店铺子域名**：DNS 加 `*` 记录；Caddy 换成带 `caddy-dns/alidns` 插件的版本；在 Caddyfile 里取消泛域名那一段的注释，并填入阿里云 AccessKey；app 里实现按 Host 识别店铺
- **多实例**：数据库换成云数据库 RDS，图片换成 OSS（`apps/server/src/storage.ts` 里有说明），app 起多个实例，前面加负载均衡。付款同步已经支持多实例，不需要改
