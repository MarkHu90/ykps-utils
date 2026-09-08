# YKPS Utils 使用说明

本文面向服务部署者和 API 调用方，说明如何配置、启动和调用 YKPS Utils。服务目前提供翻译、邮件、统一事件通知以及 MCP 接口。

## 1. 服务地址与认证

本地默认地址：

```text
http://127.0.0.1:3030
```

以下接口无需认证：

- `GET /`
- `GET /health`
- `GET /docs`：Swagger UI 在线文档（浏览器打开即可查看接口、填写 Bearer Token 在线调试）
- `GET /openapi.json`
- 各业务接口的 `GET` 使用提示

以下业务请求必须携带 Bearer Token：

```http
Authorization: Bearer <SERVICE_API_KEY>
```

建议先设置调用环境变量：

```bash
export YKPS_UTILS_URL=http://127.0.0.1:3030
export YKPS_UTILS_API_KEY='<SERVICE_API_KEYS 中的一个值>'
```

检查服务状态：

```bash
curl "$YKPS_UTILS_URL/health"
```

成功响应：

```json
{"status":"ok"}
```

完整 OpenAPI 3.1 契约位于：

```text
GET /openapi.json
```

也可以在浏览器打开 Swagger UI 在线查看与调试：

```text
GET /docs
```

## 2. 部署配置

要求 Node.js 20 或更高版本。复制环境变量模板：

```bash
npm install
cp .env.example .env
```

核心配置：

| 环境变量 | 必填 | 说明 |
| --- | --- | --- |
| `AZURE_TRANSLATOR_KEY` | 是 | Azure Translator 资源密钥 |
| `AZURE_TRANSLATOR_REGION` | 视资源而定 | 区域或多服务资源必须提供，例如 `eastasia` |
| `AZURE_TRANSLATOR_ENDPOINT` | 否 | 默认 `https://api.cognitive.microsofttranslator.com` |
| `AZURE_TRANSLATOR_CATEGORY` | 否 | 已发布的 Custom Translator category ID |
| `SERVICE_API_KEYS` | HTTP 模式必填 | 一个或多个逗号分隔的调用密钥，每个至少 16 字符 |
| `SMTP_USERNAME` | 邮件发送必填 | 阿里云 Direct Mail SMTP 用户名，同时作为默认发件地址 |
| `SMTP_PASSWORD` | 邮件发送必填 | SMTP 密码，必须与 `SMTP_USERNAME` 一起设置 |
| `SMTP_HOST` | 否 | 默认 `smtpdm.aliyun.com` |
| `SMTP_PORT` | 否 | 默认 `25` |
| `SMTP_SECURE` | 否 | 默认 `false`；端口 465 通常设为 `true` |
| `EMAIL_TEMPLATES_FILE` | 模板功能必填 | UTF-8 JSON 模板文件路径，相对路径基于进程工作目录 |
| `NOTIFICATION_CONFIG_FILE` | 通知功能必填 | UTF-8 JSON 渠道与事件路由文件路径 |
| `HOST` | 否 | 默认 `127.0.0.1` |
| `PORT` | 否 | 默认 `3030` |
| `ALLOWED_HOSTS` | 否 | 允许的 Host 列表，逗号分隔 |
| `ALLOWED_ORIGINS` | 否 | 允许的浏览器 Origin 列表，逗号分隔 |

启动 HTTP 与远程 MCP 服务：

```bash
npm start
```

生产构建与启动：

```bash
npm run build
npm run serve
```

Docker 启动：

```bash
docker compose up --build
```

使用邮件模板或通知配置时，`compose.yaml` 会把宿主机的 `./config` 目录只读挂载到容器的 `/app/config`。从 `email-templates.example.json` / `notification-config.example.json` 复制到 `config/` 下（命名为 `email-templates.json` / `notification-config.json`）并编辑，然后在 `.env` 中启用 `EMAIL_TEMPLATES_FILE=./config/email-templates.json`、`NOTIFICATION_CONFIG_FILE=./config/notification-config.json`。相对路径基于进程工作目录解析——本地开发时为仓库根目录，容器内为 `/app`，同一份 `.env` 在两种场景下都有效。

## 3. 翻译 API

### 3.1 自动中英互译

请求：

```bash
curl "$YKPS_UTILS_URL/v1/translate" \
  -H "Authorization: Bearer $YKPS_UTILS_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"text":"Hello, how are you?"}'
```

省略 `sourceLanguage` 和 `targetLanguage` 时：

- 检测为英文，目标语言为简体中文 `zh-Hans`。
- 检测为中文，目标语言为英文 `en`。
- 自动模式只支持中文和英文。
- 批量自动翻译不能混合中英文方向。

### 3.2 指定翻译方向

`sourceLanguage` 与 `targetLanguage` 必须同时提供：

```bash
curl "$YKPS_UTILS_URL/v1/translate" \
  -H "Authorization: Bearer $YKPS_UTILS_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
    "text": ["Bonjour", "Au revoir"],
    "sourceLanguage": "fr",
    "targetLanguage": "en",
    "textType": "plain"
  }'
```

请求字段：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `text` | `string` 或 `string[]` | 是 | 单条或批量文本 |
| `sourceLanguage` | `string` | 否 | BCP 47 风格源语言，例如 `en`、`zh-Hans` |
| `targetLanguage` | `string` | 否 | BCP 47 风格目标语言 |
| `textType` | `plain` 或 `html` | 否 | 默认 `plain` |

成功响应：

```json
{
  "requestId": "req-1",
  "provider": "azure-translator-v3",
  "targetLanguage": "en",
  "translations": [
    {
      "sourceText": "Bonjour",
      "text": "Hello"
    },
    {
      "sourceText": "Au revoir",
      "text": "Goodbye"
    }
  ]
}
```

翻译限额：

- 每次最多 100 条文本。
- 单条最多 10,000 字符。
- 每次请求合计最多 50,000 字符。

## 4. 邮件 API

邮件发送接口：

```text
POST /v1/email/send
```

### 4.1 HTML 与纯文本双版本

推荐同时提供 `html` 和 `text`：

```bash
curl "$YKPS_UTILS_URL/v1/email/send" \
  -H "Authorization: Bearer $YKPS_UTILS_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
    "to": ["first@example.com", "second@example.com"],
    "replyTo": "support@example.com",
    "subject": "Order received",
    "html": "<h1>Thank you</h1><p>We received your order.</p>",
    "text": "Thank you\n\nWe received your order.",
    "displayName": "Example Store"
  }'
```

兼容旧的单正文格式：

```json
{
  "to": "recipient@example.com",
  "subject": "Hello",
  "body": "<p>Hello</p>",
  "isBodyHtml": true
}
```

`body` 不能与 `html` 或 `text` 混用。不提供 `from` 时使用 `SMTP_USERNAME`。

成功响应：

```json
{
  "requestId": "req-1",
  "provider": "aliyun-direct-mail-smtp",
  "messageId": "<message-id>",
  "accepted": ["recipient@example.com"],
  "rejected": []
}
```

### 4.2 发送模板邮件

模板文件格式参见 [email-templates.example.json](../email-templates.example.json)。每个语言版本必须同时包含 `subject`、`html` 和 `text`，同一模板的所有语言版本必须使用相同变量集合。

```bash
curl "$YKPS_UTILS_URL/v1/email/send" \
  -H "Authorization: Bearer $YKPS_UTILS_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
    "to": "recipient@example.com",
    "templateId": "welcome",
    "locale": "zh-CN",
    "variables": {
      "name": "小明"
    }
  }'
```

模板行为：

- 省略 `locale` 时使用模板的 `defaultLocale`。
- 没有 `zh-CN` 等精确版本时，尝试回退到 `zh`。
- 缺失变量、多余变量、未知模板和不支持的语言均返回 `400`。
- 插入 HTML 的变量会自动转义；主题和纯文本变量保持原始文本。

### 4.3 预览模板邮件

预览只渲染模板，不发送邮件，也不需要 `to`：

```bash
curl "$YKPS_UTILS_URL/v1/email/preview" \
  -H "Authorization: Bearer $YKPS_UTILS_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
    "templateId": "welcome",
    "locale": "zh-CN",
    "variables": {
      "name": "小明"
    }
  }'
```

响应包含 `subject`、`html` 和 `text`。在 macOS 浏览器中查看 HTML：

```bash
curl -sS "$YKPS_UTILS_URL/v1/email/preview" \
  -H "Authorization: Bearer $YKPS_UTILS_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"templateId":"welcome","variables":{"name":"Ada"}}' \
  | jq -r '.html' > /tmp/email-preview.html

open /tmp/email-preview.html
```

浏览器效果仅供快速检查。Gmail、Outlook 和 Apple Mail 对 CSS 的支持可能不同，生产邮件建议使用内联 CSS。

### 4.4 附件

附件通过 JSON 中的纯 Base64 字符串传递，不使用 `multipart/form-data`，也不要添加 `data:...;base64,` 前缀：

```bash
attachment=$(base64 < report.pdf | tr -d '\n')

jq -n --arg attachment "$attachment" '{
  to: "recipient@example.com",
  subject: "Monthly report",
  html: "<p>Report attached.</p>",
  text: "Report attached.",
  attachments: [{
    filename: "report.pdf",
    contentBase64: $attachment,
    contentType: "application/pdf",
    disposition: "attachment"
  }]
}' | curl "$YKPS_UTILS_URL/v1/email/send" \
  -H "Authorization: Bearer $YKPS_UTILS_API_KEY" \
  -H 'Content-Type: application/json' \
  --data-binary @-
```

### 4.5 内嵌图片

内嵌图片的 `contentId` 必须与 HTML 中的 `cid:` 一致：

```json
{
  "to": "recipient@example.com",
  "subject": "Logo preview",
  "html": "<img src=\"cid:company-logo\" alt=\"Company logo\">",
  "text": "Company logo",
  "attachments": [
    {
      "filename": "logo.png",
      "contentBase64": "<纯 Base64 内容>",
      "contentType": "image/png",
      "contentId": "company-logo",
      "disposition": "inline"
    }
  ]
}
```

附件限制：

- 每封邮件最多 20 个附件。
- 单个附件解码后最多 10 MiB。
- 全部附件解码后合计最多 20 MiB。
- `from`、`to`、`replyTo`、`subject`、`displayName`、文件名、MIME 类型和 `contentId` 禁止包含 CR/LF。

## 5. 统一通知 API

统一入口根据 `eventType` 选择渠道，调用方不需要提供供应商或 Webhook 地址：

```text
POST /v1/notifications/send
```

复制 [notification-config.example.json](../notification-config.example.json) 到 `config/` 目录并配置：

```dotenv
NOTIFICATION_CONFIG_FILE=./config/notification-config.json
```

`channels` 支持 `email`、`webhook`、`slack`、`teams`、`dingtalk` 和 `wechat`。邮件渠道配置 `recipients`，其余渠道配置 HTTPS `url`；`routes` 将一个或多个精确事件类型分配到渠道，`*` 匹配所有事件。同一事件匹配的渠道会去重后并发发送。

```bash
curl "$YKPS_UTILS_URL/v1/notifications/send" \
  -H "Authorization: Bearer $YKPS_UTILS_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
    "eventType": "deployment.failed",
    "title": "Deployment failed",
    "message": "Production deployment 42 failed.",
    "priority": "critical",
    "idempotencyKey": "deployment-42",
    "data": { "deploymentId": 42 }
  }'
```

`low`、`normal`、`high`、`critical` 默认分别最多尝试 1、2、3、4 次。可以通过 `maxAttempts` 覆盖，`timeoutMs` 控制每个渠道每次尝试的超时；重试采用指数退避。响应中的 `channels` 分别报告 `sent` 或 `failed`，因此部分渠道失败不会隐藏其他渠道的成功结果。

相同 `idempotencyKey` 和相同请求会复用进行中或已完成的结果，并返回 `duplicate: true`；同一键对应不同内容会返回 `400`。当前幂等记录保存在服务进程内，重启后清空，横向扩容部署应将该仓库替换为 Redis 或数据库实现。

## 6. 错误处理

错误响应格式：

```json
{
  "error": {
    "code": "INVALID_REQUEST",
    "message": "错误说明",
    "requestId": "req-1"
  }
}
```

| HTTP 状态 | 错误代码 | 说明 |
| --- | --- | --- |
| `400` | `INVALID_REQUEST` | 参数、模板、变量、语言或附件无效 |
| `401` | `UNAUTHORIZED` | Bearer Token 缺失或无效 |
| `422` | `NO_ROUTE` | 没有匹配事件类型的通知路由 |
| `502` | `PROVIDER_ERROR` | Azure Translator 或 SMTP 上游调用失败 |
| `503` | `PROVIDER_NOT_CONFIGURED` | SMTP 未配置时尝试发送邮件 |
| `500` | `INTERNAL_ERROR` | 未预期的服务端错误 |

调用方应记录 `requestId`，但不要记录 API Key、SMTP 密码或待翻译及邮件正文中的敏感数据。

## 7. MCP 使用

服务提供四个 MCP 工具：

| 工具 | 用途 |
| --- | --- |
| `translate_text` | 单条或批量翻译 |
| `send_email` | 发送直接邮件或模板邮件 |
| `preview_email` | 渲染模板但不发送 |
| `send_notification` | 按事件类型发送统一通知，无需指定供应商 |

远程 Streamable HTTP 配置：

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

本地 stdio MCP：

```bash
npm run mcp
```

stdio 模式的协议输出使用 stdout，诊断输出使用 stderr。项目中的 `.vscode/mcp.json` 可供 VS Code 直接启动本地服务。

## 8. JavaScript 调用示例

```javascript
const response = await fetch(`${process.env.YKPS_UTILS_URL}/v1/translate`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${process.env.YKPS_UTILS_API_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    text: "Hello",
    sourceLanguage: "en",
    targetLanguage: "zh-Hans",
  }),
});

const payload = await response.json();
if (!response.ok) {
  throw new Error(`${payload.error?.code}: ${payload.error?.message}`);
}

console.log(payload.translations[0].text);
```

## 8. 运维检查

```bash
# 健康检查
curl -fsS "$YKPS_UTILS_URL/health"

# 查看服务入口
curl -sS "$YKPS_UTILS_URL/"

# 下载 OpenAPI
curl -sS "$YKPS_UTILS_URL/openapi.json" -o openapi.json
```

部署到反向代理或 API Gateway 后，应启用 HTTPS、请求速率限制和请求体大小限制。网关的请求体上限至少需要覆盖 Base64 编码后的附件 JSON；服务内邮件路由上限为 30 MiB。