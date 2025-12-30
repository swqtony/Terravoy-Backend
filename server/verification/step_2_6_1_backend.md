# Step 2.6.1 Backend Verification

## A1) 迁移与字段检查

- profiles.nickname 已存在（nullable，默认值为空）：见 `\d+ profiles` 输出（nickname 列 Nullable 为空、Default 为空）。
- 认证表已创建（auth_users/auth_sms_codes/auth_sessions）：通过执行 `db/migrations/0012_auth_sms.sql` 创建成功。
- 本次运行中，`npm run db:migrate --prefix server` 因已存在类型报错（重复执行 0001 导致），因此采用手动执行迁移 SQL（不影响数据）。

## A2) curl 验证结果

> 基础环境：`BASE_URL=http://localhost:3000`

### 1) nickname-only 更新成功（200）

- HTTP status: 200
- Response body:
```json
{"success":true,"data":{"profileId":"99b5fd3d-fc8b-44a5-b884-891f94c495d2"}}
```

### 2) nickname 空/全空格（400 INVALID_NICKNAME）

- HTTP status: 400
- Response body:
```json
{"success":false,"code":"INVALID_NICKNAME","message":"Invalid nickname","detail":null}
```

### 3) 画像全量字段更新成功（200）

- HTTP status: 200
- Response body:
```json
{"success":true,"data":{"profileId":"99b5fd3d-fc8b-44a5-b884-891f94c495d2"}}
```

### 4) 越权 profileId（403）

- HTTP status: 403
- Response body:
```json
{"success":false,"code":"FORBIDDEN","message":"profileId does not belong to user","detail":null}
```

### 5) （可选）nickname-only 更新后 bootstrap

- HTTP status: 200
- Response body:
```json
{"success":true,"data":{"profileId":"99b5fd3d-fc8b-44a5-b884-891f94c495d2","isCompleted":true,"missingFields":[]}}
```

## 认证获取（sms/verify）

- HTTP status: 200
- Response body（脱敏）:
```json
{
  "success": true,
  "data": {
    "accessToken": "eyJhbGciOi...dYXo",
    "accessTokenExpiresIn": 3600,
    "refreshToken": "YkyFVVYA...Ob6s",
    "refreshTokenExpiresIn": 2592000,
    "user": {
      "id": "db08e5c1-ae70-46b5-82b2-15c992385011",
      "phone": "13800138000"
    }
  }
}
```

- profile-bootstrap（Bearer + {}）:
  - HTTP status: 200
  - Response body:
```json
{"success":true,"data":{"profileId":"99b5fd3d-fc8b-44a5-b884-891f94c495d2","isCompleted":false,"missingFields":["gender","age","firstLanguage","secondLanguage","homeCity"]}}
```
