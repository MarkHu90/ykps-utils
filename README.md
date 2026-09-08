# YKPS Utils

一组可供其他平台调用的 YKPS 实用服务，目前提供翻译、邮件，以及支持 Webhook、Slack、Teams、钉钉和企业微信的统一通知能力。REST API 与 MCP 共用相同的业务服务。

完整的部署流程（Ubuntu + Docker + Nginx）见 [部署指南](docs/DEPLOY.md)；REST、邮件模板、附件和 MCP 调用手册见 [YKPS Utils 使用说明](docs/USAGE.md)。

## 接口

- `POST /v1/translate`：REST 单条或批量翻译
- `POST /v1/email/send`：通过阿里云 Direct Mail SMTP 发送邮件
- `POST /v1/email/preview`：渲染邮件模板但不发送
- `POST /v1/notifications/send`：根据事件类型路由统一通知
- `POST /mcp`：MCP Streamable HTTP（MCP 2026-07-28）
- stdio MCP：供 VS Code、GitHub Copilot 等本地客户端启动
- `GET /`：YKPS Utils 服务信息和入口
- `GET /docs`：Swagger UI 在线文档（可在线调试，支持 Bearer Token）
- `GET /openapi.json`：OpenAPI 3.1 文档
- `GET /health`：进程健康检查

HTTP 翻译、邮件与 MCP HTTP 都要求 `Authorization: Bearer <API_KEY>`。健康检查、Swagger UI 和 OpenAPI 文档不需要认证。

## 快速开始

要求 Node.js 20 或更高版本，以及一个 Azure Translator 资源。

```bash
npm install
cp .env.example .env
```

编辑 `.env`：

```dotenv
AZURE_TRANSLATOR_KEY=<your-azure-translator-key>
AZURE_TRANSLATOR_REGION=eastasia
SMTP_USERNAME=<your-aliyun-smtp-username>
SMTP_PASSWORD=<your-aliyun-smtp-password>
EMAIL_TEMPLATES_FILE=./config/email-templates.json
NOTIFICATION_CONFIG_FILE=./config/notification-config.json
SERVICE_API_KEYS=<a-long-random-client-key>
```

全局单服务 Translator 资源可以不设置 `AZURE_TRANSLATOR_REGION`。入站 API Key 可用以下命令生成：

```bash
openssl rand -hex 32
```

启动 REST 与远程 MCP：

```bash
npm start
```

默认监听 `http://127.0.0.1:3030`。

## REST 调用

自动判断中英文并选择翻译方向：

```bash
curl http://127.0.0.1:3030/v1/translate \
  -H 'Authorization: Bearer <client-api-key>' \
  -H 'Content-Type: application/json' \
  -d '{
    "text": "Hello, how are you?"
  }'
```

只传 `text` 时，英文自动翻译为简体中文，中文自动翻译为英文。批量自动翻译中的文本必须使用同一方向，不能混合中英文。

指定源语言和目标语言：

```bash
curl http://127.0.0.1:3030/v1/translate \
  -H 'Authorization: Bearer <client-api-key>' \
  -H 'Content-Type: application/json' \
  -d '{
    "text": ["Bonjour", "Au revoir"],
    "sourceLanguage": "fr",
    "targetLanguage": "en",
    "textType": "plain"
  }'
```

`sourceLanguage` 和 `targetLanguage` 必须同时传递；此时服务跳过自动判断并严格按指定方向翻译。

响应示例：

```json
{
  "requestId": "req-1",
  "provider": "azure-translator-v3",
  "targetLanguage": "zh-Hans",
  "translations": [
    {
      "sourceText": "Hello",
      "text": "你好",
      "detectedSourceLanguage": "en"
    }
  ]
}
```

## SMTP 邮件调用

默认 SMTP 服务器为 `smtpdm.aliyun.com:25`，使用 STARTTLS（`SMTP_SECURE=false`）。不传 `from` 时默认使用 `SMTP_USERNAME`；显式传入时，该地址必须是阿里云 Direct Mail 中已配置可用的发信地址。SMTP 用户名和密码只通过环境变量配置。

```bash
curl http://127.0.0.1:3030/v1/email/send \
  -H 'Authorization: Bearer <client-api-key>' \
  -H 'Content-Type: application/json' \
  -d '{
    "from": "sender@example.com",
    "to": ["first@example.com", "second@example.com"],
    "replyTo": "reply@example.com",
    "subject": "测试邮件",
    "body": "<p>邮件正文</p>",
    "isBodyHtml": true,
    "displayName": "发件人名称"
  }'
```

`from`、`replyTo` 和 `displayName` 可选；`to` 可以是单个邮箱字符串或邮箱数组。兼容原有的 `body + isBodyHtml` 调用，也可以同时传递 `html` 和 `text`，由邮件客户端选择最佳版本。`body` 不能和 `html`/`text` 混用。SMTP 未配置时，邮件接口返回 `503`，翻译功能仍可正常使用。响应包含 SMTP `messageId`、`accepted` 和 `rejected` 收件人列表。

### 邮件模板

复制 [email-templates.example.json](email-templates.example.json) 为业务模板文件，并通过 `EMAIL_TEMPLATES_FILE` 指定路径。每个模板包含默认语言和多个语言版本，每个版本必须同时提供 `subject`、`html`、`text`，并使用相同的一组 `{{variable}}` 变量。

模板发送请求：

```bash
curl http://127.0.0.1:3030/v1/email/send \
  -H 'Authorization: Bearer <client-api-key>' \
  -H 'Content-Type: application/json' \
  -d '{
    "to": "recipient@example.com",
    "templateId": "welcome",
    "locale": "zh-CN",
    "variables": { "name": "小明" }
  }'
```

`zh-CN` 找不到精确版本时会回退到 `zh`，省略 `locale` 时使用模板的 `defaultLocale`。缺少变量、多余变量、不支持的语言或未知模板都会返回 `400`。变量替换到 HTML 时会自动转义，主题和纯文本保持原始文本值。

预览使用相同的 `templateId`、`locale` 和 `variables`，但不需要收件人，也不会连接 SMTP：

```bash
curl http://127.0.0.1:3030/v1/email/preview \
  -H 'Authorization: Bearer <client-api-key>' \
  -H 'Content-Type: application/json' \
  -d '{
    "templateId": "welcome",
    "locale": "en",
    "variables": { "name": "Ada" }
  }'
```

### 附件与内嵌图片

普通附件和内嵌图片都使用 Base64 内容。内嵌图片必须设置 `disposition: "inline"` 与 `contentId`，HTML 使用对应的 `cid:` 引用：

```json
{
  "to": "recipient@example.com",
  "subject": "Monthly report",
  "html": "<p>Logo:</p><img src=\"cid:company-logo\">",
  "text": "Monthly report with company logo",
  "attachments": [
    {
      "filename": "logo.png",
      "contentBase64": "<base64-content>",
      "contentType": "image/png",
      "contentId": "company-logo",
      "disposition": "inline"
    }
  ]
}
```

每封邮件最多 20 个附件，单个附件解码后最多 10 MiB，全部附件解码后合计最多 20 MiB。`from`、`to`、`replyTo`、`subject`、`displayName`、附件文件名、MIME 类型和 `contentId` 均拒绝 CR/LF，防止 Header Injection。

## MCP 调用

项目内的 `.vscode/mcp.json` 已配置 stdio 服务。填好 `.env` 后，可以直接在 VS Code 中启动 `ykps-utils` MCP 服务并调试。

远程 MCP 客户端使用：

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

服务提供四个工具：

- `translate_text`：参数与 REST 请求一致。仅传 `text` 可自动进行中英互译；也可同时传 `sourceLanguage` 和 `targetLanguage` 指定方向；`textType` 可选。
- `send_email`：参数与 REST 邮件请求一致，支持直接或模板邮件、HTML/纯文本双版本、附件和内嵌图片。
- `preview_email`：渲染多语言模板并返回主题、HTML 和纯文本，不发送邮件。
- `send_notification`：提交事件、消息、优先级和幂等键，由服务选择具体通知渠道。

## 限额

- 每次最多 100 条文本
- 单条最多 10,000 字符
- 每次请求总计最多 50,000 字符
- `textType` 支持 `plain` 和 `html`
- 语言代码使用 `en`、`zh-Hans`、`pt-BR` 这类 BCP 47 风格值

## Docker

```bash
docker compose up --build
```

容器内固定监听 `0.0.0.0:3030`，主机端口使用 `.env` 中的 `PORT`（默认 `3030`），且只绑定 `127.0.0.1`——Docker 发布的端口会绕过 UFW 防火墙，服务不应直接暴露公网，由 Nginx 或 Caddy 等反向代理对外提供 HTTPS。`compose.yaml` 会把宿主机的 `./config` 目录只读挂载到容器 `/app/config`，邮件模板与通知配置文件（`config/email-templates.json`、`config/notification-config.json`）放入该目录即可。部署到域名时，需要把域名加入 `ALLOWED_HOSTS`；有浏览器 Origin 请求时，也要设置 `ALLOWED_ORIGINS`。生产环境完整上线流程（服务器初始化、Nginx、HTTPS、故障排查）见 [部署指南](docs/DEPLOY.md)。

## 开发命令

```bash
npm run dev       # HTTP 服务热重载
npm run mcp       # stdio MCP
npm run check     # 类型检查和全部测试
npm run build     # 编译到 dist/
npm run serve     # 运行编译后的 HTTP 服务
npm run serve:mcp # 运行编译后的 stdio MCP
```

## 生产建议

- 在反向代理或 API Gateway 终止 TLS，并配置速率限制和请求大小限制。
- 静态 Bearer Key 适合首版服务；多租户生产环境建议升级为 OAuth 2.1 或网关签发的短期令牌。
- Azure 密钥应存放在 Key Vault 或部署平台的 Secret Store，不要写入镜像或仓库。
- 定期轮换 `SERVICE_API_KEYS`；支持逗号分隔多个 Key，便于无停机轮换。
- 定期轮换 `SMTP_PASSWORD`，并确保发信地址已在阿里云 Direct Mail 控制台中配置。
- 上游请求固定使用 Azure Translator REST API `api-version=3.0`。只有明确发布了 Custom Translator 模型时才设置 `AZURE_TRANSLATOR_CATEGORY`。

如需更换翻译引擎，实现 `TranslationProvider` 接口并在 `src/bootstrap.ts` 中替换提供方即可，REST 与 MCP 无需改动。