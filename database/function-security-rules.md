# 云函数调用安全规则

```json
{
  "*": {
    "invoke": "auth.loginType != 'ANONYMOUS' && auth != null"
  },
  "maintenanceService": {
    "invoke": false
  },
  "shareService": {
    "invoke": true
  }
}
```

- 普通业务云函数仅允许当前小程序已登录用户调用。
- `adminService` 还在函数内验证 `status === "active"` 与 `role === "admin"`。
- `maintenanceService` 检测到 OpenID 即返回 `FORBIDDEN`，只接受云端定时触发器。
- 所有业务调用携带 UUID v4 `requestId`；写 action 先原子认领幂等键。
- 日志不得记录 OpenID、孩子资料、家庭备注、AppCode 或 HMAC 密钥。
