# Step 2.6.5 SMS Mock/Gateway Switch 验证

## 配置示例

### Dev / Mock（默认）
```bash
NODE_ENV=development
AUTH_SMS_MODE=mock
# 可选：在响应体返回 debugCode
AUTH_DEBUG_SMS=true
```

### Prod / Gateway
```bash
NODE_ENV=production
AUTH_SMS_MODE=gateway
AUTH_SMS_PROVIDER=aliyun
AUTH_SMS_PROVIDER_KEY=***
AUTH_SMS_PROVIDER_SECRET=***
AUTH_SMS_PROVIDER_SIGN=***
AUTH_SMS_PROVIDER_TEMPLATE_LOGIN=***
AUTH_SMS_PROVIDER_TEMPLATE_REGISTER=***
```

> 注意：生产环境若 `AUTH_SMS_MODE != gateway` 会在启动时 fail-fast 直接退出。

## 行为说明（事实）

- mock：send 仍写库，但不调用外部短信；verify 不校验 code，只要存在未过期未消费的记录即可通过。
- gateway：send 需调用短信发送抽象；verify 严格校验 code hash。

## curl 验证（脱敏示例）

> 假设：`BASE_URL=http://localhost:3000`，手机号 `13800138000`

### 1) mock：send → verify（随便 code 成功）
```bash
curl -X POST "$BASE_URL/functions/v1/auth/sms/send" \
  -H "Content-Type: application/json" \
  -d '{"phone":"13800138000","purpose":"login"}'

curl -X POST "$BASE_URL/functions/v1/auth/sms/verify" \
  -H "Content-Type: application/json" \
  -d '{"phone":"13800138000","code":"000000"}'
```

期望响应（示例）：
```json
{"success":true,"data":{"accessToken":"***","refreshToken":"***","user":{"id":"***","phone":"13800138000"}}}
```

### 2) mock：未 send 直接 verify（失败 SMS_INVALID）
```bash
curl -X POST "$BASE_URL/functions/v1/auth/sms/verify" \
  -H "Content-Type: application/json" \
  -d '{"phone":"13800138001","code":"000000"}'
```

期望响应（示例）：
```json
{"success":false,"code":"SMS_INVALID","message":"Invalid or expired code","detail":null}
```

### 3) gateway：错误 code 失败 SMS_INVALID
```bash
curl -X POST "$BASE_URL/functions/v1/auth/sms/send" \
  -H "Content-Type: application/json" \
  -d '{"phone":"13800138000","purpose":"login"}'

curl -X POST "$BASE_URL/functions/v1/auth/sms/verify" \
  -H "Content-Type: application/json" \
  -d '{"phone":"13800138000","code":"000000"}'
```

期望响应（示例）：
```json
{"success":false,"code":"SMS_INVALID","message":"Invalid or expired code","detail":null}
```

### 4) production fail-fast（AUTH_SMS_MODE=mock 应启动失败）
```bash
NODE_ENV=production AUTH_SMS_MODE=mock npm run start --prefix server
```

期望结果：进程直接退出并提示 `AUTH_SMS_MODE must be "gateway" when NODE_ENV=production.`

## 备注

- gateway 模式未配置或未实现供应商时，send 将返回 `501 SMS_PROVIDER_NOT_CONFIGURED`。

## C. gateway 接入 TODO（必做 / 建议做）

### 必做（上线前）
- Provider 发送接口：必须可实际发送短信，否则无法登录。
- 模板映射（login / register）：不同模板对应不同风控/合规审核，必须区分。
- 失败重试 + 明确错误码：处理网关超时常态，且便于排查用户投诉。
- 审计日志（不打 code）：可追溯“未收到短信”问题，避免记录明文验证码。

### 建议做（上线后 1–2 周）
- 回执 / 状态查询：用于送达率统计。
- 黑名单 / 高级风控：规模增长后再做。
- 国际号码规范化（E.164）：国际化前再完善。
