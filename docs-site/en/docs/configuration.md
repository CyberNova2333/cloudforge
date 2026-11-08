---
title: Configuration Guide
description: Parameter configuration details, typical usage scenarios, and best practices for Cloudforge.
---

::: warning AI Translation Notice
This document was translated by an AI language model. In case of any discrepancies or ambiguities, please refer to the [original Chinese documentation](/docs/configuration) as the authoritative reference.
:::

# Configuration Guide

### Workflow Orchestration Configuration (`cloudforge.config.json`)

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

### Core Features

- **D1 Distributed Persistence**: Native decentralized SQLite D1 integration, automatically persisting workflow state with idempotency guarantees.
- **Microtask Scheduling**: Highly optimized Promise chains and edge runtimes keeping task cold starts under sub-milliseconds.

---

## Production Deployment Recommendations

1. **Environment Variable Protection**: Never commit configurations containing real API keys or tokens into version control.
2. **Graceful Shutdown & Timeouts**: Set appropriate timeout limits on critical long-running tasks to prevent orphan execution.
3. **Log Monitoring**: Establish regular health checks via console output to proactively catch unexpected exceptions.
