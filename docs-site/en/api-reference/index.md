---
layout: page
sidebar: false
title: API & Component Reference
description: Interactive specification for CloudForge OpenAPI routes, Git HTTP + R2 LFS, OAuth 2.1 Streamable HTTP /mcp (31+3 tools), Webhooks, Containers CI, and installer CLIs.
---

<script setup lang="ts">
import { apiSpecEn } from '../../.vitepress/data/api-spec'
</script>

<ApiExplorer :spec="apiSpecEn">

### OpenAPI REST, Health Probe & Live Invalidation (`/api/*`) {#rest-openapi-live}

Exposes Zod OpenAPI 3.0 (`/api/doc`), private-repo 404 masking, recent MFA verification + SQL generation CAS, and WebSocket `/api/live`.

### Git Smart HTTP, LFS Batch API & `cfd_` Deploy Tokens (`/.../info/lfs/objects/batch`) {#git-http-lfs}

Stores packs in Cloudflare Artifacts (`1 GB` new-repo cap / Git v1) and streams LFS objects via 15-min R2 presigned URLs; omits Git SSH and LFS locks (`501`).

### Stateless Streamable HTTP `/mcp` & OAuth 2.1 (`POST /mcp`) {#mcp-oauth-tools}

Implements RFC 9728/8414/7591 OAuth 2.1 with 31 standard tools and 3 user-promoted moderator approval tools.

### Container Actions, Webhooks & Non-Goals (`.github/workflows/*.yml`) {#actions-webhooks}

Runs GitHub-compatible workflows on Cloudflare Containers alongside SSRF-guarded Webhooks and explicit non-goal boundaries.

### Zero-Clone Deploy, Adopt & Offline Recovery CLI (`@cybernova2333/cloudforge`) {#cli-installer}

Handles `install`, `upgrade`, `adopt`, `status`, and audited `reset-password` / `reset-mfa`.

</ApiExplorer>
