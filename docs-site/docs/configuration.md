---
title: 配置与使用指南
description: Cloudforge 云函数编排 的参数配置详解、典型使用场景与最佳实践
---

# 配置与使用指南

### 工作流编排配置 (cloudforge.config.json)

```json
{
  "workflow": {
    "name": "data-pipeline",
    "steps": [
      { "id": "fetch", "timeout_ms": 3000 },
      { "id": "transform", "memory_mb": 128 },
      { "id": "persist", "target": "d1" }
    ],
    "retry_policy": {
      "max_attempts": 3,
      "backoff_multiplier": 1.5
    }
  }
}
```

### 核心特性

- **D1 分布式持久化**：原生集成去中心化 SQLite D1，自动对流程状态进行幂等存储；
- **微任务调度**：利用高效 Promise 链与边缘运行时，将任务冷启动控制在亚毫秒级别。

---

## 生产部署建议

1. **环境变量保护**：切勿将包含真实密钥或 Token 的配置提交至版本库；
2. **优雅停机与超时**：建议将关键长任务的超时时限设置为合理范围，避免僵尸进程驻留；
3. **日志监控**：结合控制台输出建立定期检查机制，捕获潜在异常。
