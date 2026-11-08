---
title: 快速入门
description: Cloudforge 是专为多边缘 Serverless 计算环境打造的**轻量级函数工作流编排与 D1 分布式状态协同引擎**。
---

# 快速入门

Cloudforge 是专为多边缘 Serverless 计算环境打造的**轻量级函数工作流编排与 D1 分布式状态协同引擎**。

## 解决的核心痛点

- **痛点 1**：多边缘函数执行时缺少统一的工作流状态机，断点续传与分布式重试难以实现
- **痛点 2**：不同边缘平台（Cloudflare、EdgeOne、Node.js）的运行时上下文严重异构
- **痛点 3**：冷启动时延高，状态数据跨节点同步一致性难以保证

---

## 环境准备

Node.js 20+，pnpm 12.6.0，Cloudflare 开发者账号。

---

## 快速安装与运行

```bash
# 1. 安装项目依赖
pnpm install

# 2. 运行本地开发与测试工作流
pnpm test

# 3. 一键编译并部署边缘编排网关
pnpm run build
pnpm run deploy
```

---

## 接下来探索

- 深入了解系统内部流转：查阅 [系统架构与设计](/docs/architecture)
- 探索全部配置参数与高级场景：查阅 [配置与使用指南](/docs/configuration)
- 遇到问题排错：查阅 [常见问题与排错](/docs/faq)
