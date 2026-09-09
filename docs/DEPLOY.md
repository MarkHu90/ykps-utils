# YKPS Utils 部署指南（Ubuntu）

本文描述把 YKPS Utils 部署到 Ubuntu 服务器的完整流程：Docker 运行服务，Nginx 反向代理对外提供 HTTPS。REST 与 MCP 调用方式见 [YKPS Utils 使用说明](USAGE.md)。

## 1. 架构概览

```text
客户端（REST / 远程 MCP，HTTPS）
        │
        ▼
Nginx（80/443，终止 TLS；防火墙只放行 22/80/443）
        │  proxy_pass → http://127.0.0.1:3030
        ▼
ykps-utils 容器（docker compose 运行，端口只绑定 127.0.0.1）
        ├─ Azure Translator（出网 443）
        ├─ 阿里云 Direct Mail SMTP（出网 25 或 465）
        └─ ./config 只读挂载（邮件模板、通知配置，可选）
```

要点：

- 服务端口只绑定 `127.0.0.1`，公网入口唯一（Nginx）。Docker 发布的端口会绕过 UFW 防火墙，不能直接绑 `0.0.0.0` 暴露公网。
- 全部配置集中在服务器上的 `.env`（compose 通过 `env_file` 注入），密钥不进镜像、不进仓库。
- `compose.yaml` 已内置：回环绑定、`./config` 只读挂载、日志轮转（10 MiB × 3 份）、`restart: unless-stopped`。

## 2. 前置准备清单

| 项目 | 要求 |
| --- | --- |
| Ubuntu 服务器 | 22.04 或 24.04，有 sudo 权限的用户，SSH 可登录 |
| 域名 | 公网 DNS A 记录指向服务器公网 IP，本项目为 `apis.ykpaoschool.cn`（远程 MCP 客户端需要 HTTPS） |
| Azure Translator | 资源密钥；区域或多服务资源需记录区域名（如 `eastasia`） |
| 阿里云 Direct Mail | SMTP 用户名、密码，发信地址已在控制台配置 |
| 入站 API Key | 本地生成：`openssl rand -hex 32`（至少 16 字符，多个用逗号分隔） |

SSH 使用非默认端口时，下文所有防火墙命令中的 `OpenSSH` 替换为实际端口。

### 2.1 域名解析现状（2026-09-08 检查）

`apis.ykpaoschool.cn` 目前**只有校内 DNS 有记录**（解析到内网地址 `10.1.120.84`），公网 DNS（223.5.5.5、8.8.8.8）均无记录；主域名 `ykpaoschool.cn` 公网解析正常。部署前按用途二选一：

- **公网可访问（推荐，本文默认）**：在 `ykpaoschool.cn` 的公网 DNS 处为 `apis` 添加 A 记录，指向服务器公网 IP（或防火墙 NAT 映射）。验证：`dig +short apis.ykpaoschool.cn @223.5.5.5` 能返回公网 IP。服务器在中国大陆时，主域名已有 ICP 备案，子域名一般随主域生效；如云厂商控制台提示，按需补充接入备案。
- **仅校内使用**：公网不可达时 Let's Encrypt HTTP-01 验证必然失败，需改用 DNS-01 验证（安装对应 DNS 服务商的 certbot 插件）或使用学校内部 CA 签发的证书，Nginx 配置部分相同。

## 3. 服务器初始化

### 3.1 系统更新与防火墙

```bash
sudo apt update && sudo apt upgrade -y
sudo timedatectl set-timezone Asia/Shanghai

sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status
```

只放行 22（SSH）、80/443（Nginx）。3030 不放行，也不需要——服务只监听回环地址。

### 3.2 安装 Docker

```bash
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
  https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# 让当前用户免 sudo 使用 docker（执行后重新登录生效）
sudo usermod -aG docker $USER

sudo systemctl enable --now docker
docker compose version
```

### 3.3 配置镜像加速（中国大陆服务器）

构建时需要从 Docker Hub 拉取 `node:24-alpine` 基础镜像。国内服务器通常无法直连 Docker Hub，需配置镜像加速。推荐使用阿里云容器镜像服务控制台提供的个人加速地址（`https://<你的ID>.mirror.aliyuncs.com`）：

```bash
sudo tee /etc/docker/daemon.json <<'EOF'
{
  "registry-mirrors": ["https://<你的ID>.mirror.aliyuncs.com"]
}
EOF
sudo systemctl restart docker
```

验证：`docker pull hello-world` 能成功即配置生效。若 `npm ci` 构建阶段缓慢或失败，说明服务器访问 npm 官方源受限，可在 `Dockerfile` 的 `RUN npm ci` 前加一行 `RUN npm config set registry https://registry.npmmirror.com`。

## 4. 上传代码

在开发机（项目根目录）执行：

```bash
rsync -av \
  --exclude node_modules \
  --exclude dist \
  --exclude .env \
  --exclude .git \
  ./ 用户名@服务器IP:/opt/ykps-utils/
```

说明：

- `.env` **不传输**——密钥只应在服务器上创建（见下节）。
- `config/` 会随同步传输，服务器上后续创建的模板文件不受影响。
- **不要加 `--delete`**：会把服务器上已创建而本地没有的 `config/` 内容删掉。后续版本更新使用同一条命令。

## 5. 配置 .env

在服务器上：

```bash
cd /opt/ykps-utils
cp .env.example .env
chmod 600 .env
```

编辑 `.env`，生产环境关键项：

| 变量 | 必填 | 生产环境取值 |
| --- | --- | --- |
| `AZURE_TRANSLATOR_KEY` | 是 | Azure Translator 密钥 |
| `AZURE_TRANSLATOR_REGION` | 区域资源必填 | 如 `eastasia`；全局单服务资源可省略 |
| `SMTP_USERNAME` / `SMTP_PASSWORD` | 邮件功能必填 | 阿里云 Direct Mail 凭据 |
| `SMTP_PORT` / `SMTP_SECURE` | 否 | **云服务器建议 `465` + `true`**（见第 11 节，出网 25 端口常被封禁） |
| `SERVICE_API_KEYS` | 是 | `openssl rand -hex 32` 生成；多个 Key 用逗号分隔，便于无停机轮换 |
| `HOST` / `PORT` | 否 | 容器内由 compose 固定为 `0.0.0.0:3030`，保持默认即可 |
| `ALLOWED_HOSTS` | 是 | **必须包含域名**：`apis.ykpaoschool.cn,localhost,127.0.0.1` |
| `ALLOWED_ORIGINS` | 否 | 有浏览器页面调用时设置为调用页面的主机名（带 `https://` 或端口也会归一化成主机名）；纯服务端调用可留空 |

完整环境变量说明见 [USAGE.md 第 2 节](USAGE.md#2-部署配置)。

## 6. 可选：邮件模板与通知配置

`compose.yaml` 已把宿主机 `./config` 目录只读挂载到容器 `/app/config`。启用相应功能时：

```bash
cp email-templates.example.json config/email-templates.json
cp notification-config.example.json config/notification-config.json
# 编辑两个文件后，在 .env 中启用：
#   EMAIL_TEMPLATES_FILE=./config/email-templates.json
#   NOTIFICATION_CONFIG_FILE=./config/notification-config.json
```

不使用模板/通知功能时 `config/` 留空即可，无需改动任何配置。文件修改后即时生效（目录挂载），无需重启容器；`.env` 修改需要重建容器（见下节）。

## 7. 构建并启动

```bash
cd /opt/ykps-utils
docker compose up -d --build
docker compose ps
curl -s http://127.0.0.1:3030/health   # 期望 {"status":"ok"}
```

容器内已配置健康检查（`/health`，30 秒一次），`docker compose ps` 的 `STATUS` 列显示 `(healthy)` 即正常。开机自启由 `restart: unless-stopped` + `systemctl enable docker` 保证。

`.env` 修改后的应用方式：

```bash
docker compose up -d   # 重建容器以加载新环境变量
```

## 8. Nginx 反向代理与 HTTPS

### 8.1 安装并配置

```bash
sudo apt install -y nginx certbot python3-certbot-nginx
```

创建 `/etc/nginx/sites-available/ykps-utils`：

```nginx
server {
    listen 80;
    server_name apis.ykpaoschool.cn;

    location / {
        proxy_pass http://127.0.0.1:3030;
        proxy_http_version 1.1;

        # Host 头必须原样传给后端，否则 ALLOWED_HOSTS 校验失败
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # MCP Streamable HTTP 的 SSE 流式响应不缓冲、长连接不提前断开
        proxy_set_header Connection "";
        proxy_buffering off;
        proxy_read_timeout 3600s;

        # 覆盖 Base64 附件（服务内邮件路由上限 30 MiB）
        client_max_body_size 35m;
    }
}
```

启用：

```bash
sudo ln -s /etc/nginx/sites-available/ykps-utils /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

### 8.2 签发证书

先确认公网能解析到本机（`dig +short apis.ykpaoschool.cn @223.5.5.5`），再执行：

```bash
sudo certbot --nginx -d apis.ykpaoschool.cn
```

certbot 会自动写入 443 配置并安装续期定时器。若 HTTP-01 验证超时失败，通常是域名仅内网可解析或 80 端口未对公网开放（见第 2.1 节），改用 DNS-01 或内部证书。验证续期：

```bash
sudo certbot renew --dry-run
```

## 9. 上线验证

在开发机上逐项验证：

```bash
# 1. 健康检查（无需认证）
curl -s https://apis.ykpaoschool.cn/health

# 2. 不带 Key 应返回 401
curl -s -o /dev/null -w '%{http_code}\n' \
  https://apis.ykpaoschool.cn/v1/translate \
  -H 'Content-Type: application/json' -d '{"text":"hello"}'

# 3. 带 Key 翻译
curl -s https://apis.ykpaoschool.cn/v1/translate \
  -H 'Authorization: Bearer <SERVICE_API_KEYS 中的 Key>' \
  -H 'Content-Type: application/json' \
  -d '{"text":"Hello, how are you?"}'
```

远程 MCP 客户端配置：

```json
{
  "servers": {
    "ykps-utils": {
      "type": "http",
      "url": "https://apis.ykpaoschool.cn/mcp",
      "headers": {
        "Authorization": "Bearer <client-api-key>"
      }
    }
  }
}
```

接口详情与更多调用示例见 [USAGE.md](USAGE.md)。

## 10. 日常运维

### 10.1 版本更新

开发机上先跑 `npm run check`（类型检查 + 测试），通过后：

```bash
# 开发机：同步代码（命令同第 4 节，不带 --delete）
rsync -av --exclude node_modules --exclude dist --exclude .env --exclude .git \
  ./ 用户名@服务器IP:/opt/ykps-utils/

# 服务器：重建并滚动替换容器
cd /opt/ykps-utils && docker compose up -d --build
```

定期重建基础镜像（安全更新）：

```bash
docker compose build --pull && docker compose up -d
```

### 10.2 日志

```bash
docker compose logs -f --tail=100 ykps-utils
```

日志驱动已限制为 `json-file`，单份 10 MiB、最多 3 份，不会撑爆磁盘。

### 10.3 服务管理

```bash
docker compose ps          # 状态与健康检查
docker compose restart     # 重启
docker compose down        # 停止并移除容器（.env、config/、镜像均保留）
docker compose up -d       # 再次启动
```

### 10.4 备份

需要备份的只有两处，均在 `/opt/ykps-utils/` 下：`.env` 和 `config/`（含密钥，备份文件需加密保存）。镜像可随时通过源码重建，无需备份。

### 10.5 已知限制

- 通知幂等记录保存在服务进程内存中，容器重启后清空；同一事件重启后可能重复通知。横向扩容（多实例）前需将幂等实现替换为 Redis 或数据库。
- 静态 Bearer Key 适合单租户使用；多租户生产环境建议升级为 OAuth 2.1 或网关签发的短期令牌。

## 11. 故障排查

| 症状 | 可能原因 | 处理 |
| --- | --- | --- |
| 构建时拉取 `node:24-alpine` 超时 | 服务器无法直连 Docker Hub | 按第 3.3 节配置镜像加速 |
| 构建时 `npm ci` 缓慢或失败 | 服务器访问 npm 官方源受限 | 在 Dockerfile 中设置 npmmirror 源（见 3.3 节） |
| `docker compose up` 报 env file 相关错误 | `.env` 未创建 | `cp .env.example .env` 并填写 |
| 邮件发送报 SMTP 连接超时 | 云厂商封禁出网 25 端口 | `SMTP_PORT=465`、`SMTP_SECURE=true` 后重建容器 |
| 经域名访问一律 400 | `ALLOWED_HOSTS` 未包含域名 | `.env` 中补上域名并 `docker compose up -d` |
| 经域名访问 502 | 容器未运行，或 Nginx 与容器端口不一致 | `docker compose ps`；`curl http://127.0.0.1:3030/health` |
| 公网直连 `IP:3030` 不通 | 端口只绑 `127.0.0.1`（预期行为） | 通过域名经 Nginx 访问 |
| 启动报 `EMAIL_TEMPLATES_FILE` / `NOTIFICATION_CONFIG_FILE` 相关错误 | `.env` 启用了路径但 `config/` 下缺文件 | 从 example 复制到 `config/`（第 6 节） |
| MCP 客户端连接后无响应 / 频繁断开 | 反代缓冲或超时中断 SSE 流 | 确认 Nginx 含 `proxy_buffering off` 与 `proxy_read_timeout` |

## 12. 安全清单

- [ ] `.env` 权限 `600`，仅部署用户可读；不提交仓库、不传入镜像
- [ ] `SERVICE_API_KEYS` 使用 `openssl rand -hex 32` 生成的随机值，并定期轮换（多 Key 逗号分隔可无停机轮换）
- [ ] `SMTP_PASSWORD` 定期轮换；发信地址保持阿里云控制台可用状态
- [ ] 防火墙仅放行 22/80/443；3030 仅监听回环
- [ ] HTTPS 证书自动续期（`certbot renew --dry-run` 验证过）
- [ ] 定期 `docker compose build --pull` 更新基础镜像与依赖
- [ ] Azure 密钥不写入任何代码、文档或聊天记录；泄露后在 Azure 控制台立即轮换

## 附录：裸机 Node + systemd（不使用 Docker）

不使用 Docker 时，可按以下方式部署。Node 版本要求 ≥ 20。

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash -
sudo apt install -y nodejs
```

构建并安装为 systemd 服务：

```bash
cd /opt/ykps-utils
npm ci && npm run build
sudo tee /etc/systemd/system/ykps-utils.service > /dev/null <<'EOF'
[Unit]
Description=YKPS Utils
After=network-online.target
Wants=network-online.target

[Service]
User=www-data
WorkingDirectory=/opt/ykps-utils
EnvironmentFile=/opt/ykps-utils/.env
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now ykps-utils
sudo systemctl status ykps-utils
```

此方式下 `.env` 中 `HOST` 应设为 `127.0.0.1`（由 Nginx 反代），模板路径 `./config/...` 相对 `/opt/ykps-utils` 解析，与容器部署一致。Nginx 与证书配置与正文相同。
