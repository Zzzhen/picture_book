# 数据库安全规则

V1-Core 不允许小程序客户端直接访问数据库，以 `database/security-rules.json` 为部署基准。

```json
{
  "read": false,
  "write": false
}
```

所有业务访问经过云函数；云函数重新计算 HMAC 用户 ID，并校验账号状态、管理员角色、资源所有权、action 白名单、payload 字段白名单与幂等键。任何集合都不依赖客户端提交的 `owner_id`、角色或用户 ID。

云存储的手工封面目录不得开放匿名写入；客户端上传的临时文件必须由 `bookService` 内容安全检测后才可引用。公共版本封面由云函数从供应商 HTTPS 地址校验并转存。
