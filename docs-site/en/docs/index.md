---
title: Quick Start
description: Cloudforge is a lightweight workflow orchestration and D1 distributed state coordination engine designed for multi-edge Serverless environments.
---

::: warning AI Translation Notice
This document was translated by an AI language model. In case of any discrepancies or ambiguities, please refer to the [original Chinese documentation](/docs/) as the authoritative reference.
:::

# Quick Start

Cloudforge is a **lightweight workflow orchestration and D1 distributed state coordination engine** designed specifically for multi-edge Serverless computing environments.

## Core Problems Solved

- **Pain Point 1**: Multi-edge function execution lacks a unified workflow state machine, making breakpoint resumption and distributed retries difficult.
- **Pain Point 2**: Heterogeneous runtime contexts across different edge platforms (Cloudflare, EdgeOne, Node.js).
- **Pain Point 3**: High cold-start latencies and challenging cross-node state consistency.

---

## Prerequisites

Node.js 20+, pnpm 12.6.0, Cloudflare Developer Account.

---

## Quick Installation & Launch

```bash
# 1. Install dependencies
pnpm install

# 2. Run local tests
pnpm test

# 3. Build and deploy edge orchestration gateway
pnpm run build
pnpm run deploy
```

---

## Next Steps

- Explore internal mechanics: [Architecture & Design](/en/docs/architecture)
- Comprehensive configuration reference: [Configuration Guide](/en/docs/configuration)
- Troubleshooting & FAQ: [FAQ & Diagnostics](/en/docs/faq)
