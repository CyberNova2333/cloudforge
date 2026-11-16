---
layout: page
sidebar: false
title: API 与组件参考
description: CloudForge OpenAPI /api/*、Git Smart HTTP & R2 LFS、OAuth 2.1 Streamable HTTP /mcp（31+3 工具）、Webhooks、容器 Actions 与官方 CLI 参考。
---

<script setup lang="ts">
import { apiSpecZh } from '../.vitepress/data/api-spec'
</script>

<ApiExplorer :spec="apiSpecZh">

### OpenAPI REST、实例探针与实时失效通道 (`/api/*` / `/.well-known/cloudforge`) {#rest-openapi-live}

提供 OpenAPI 3.0 (`/api/doc`)、私有仓库 404 屏蔽、本地 MFA 验证与代次 CAS（`409` 冲突），单租户关闭公开注册。

### Git Smart HTTP、LFS Batch API 与 `cfd_` 令牌 (`/.../info/lfs/objects/batch`) {#git-http-lfs}

对象存于 Cloudflare Artifacts（新建 1 GB 上限 / Git v1），大文件经 15 分钟 R2 预签名 URL 直传；不支持 Git SSH 与 LFS Locking (`501`)。

### 无状态 Streamable HTTP `/mcp` 与 OAuth 2.1 (`POST /mcp`) {#mcp-oauth-tools}

实现 RFC 9728/8414/7591 动态注册，暴露 31 个标准工具及需用户在 Settings 显式提升权限的 3 个 Moderator 审批工具。

### 容器 Actions、Webhooks 与非目标范围 (`.github/workflows/*.yml`) {#actions-webhooks}

在 Cloudflare Containers 运行兼容工作流及 `cloudforge/relevance@v1` 跳测，出站 Webhook 拦截内网 SSRF。

### 零克隆部署、接管与离线恢复 CLI (`pnpm dlx @cybernova2333/cloudforge`) {#cli-installer}

提供 `install`、`upgrade`、`adopt`、`status` 与审计级 `reset-password` / `reset-mfa`。

</ApiExplorer>
