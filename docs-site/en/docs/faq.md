---
title: FAQ & Troubleshooting
description: Frequently asked questions and diagnostic troubleshooting tips for Cloudforge.
---

::: warning AI Translation Notice
This document was translated by an AI language model. In case of any discrepancies or ambiguities, please refer to the [original Chinese documentation](/docs/faq) as the authoritative reference.
:::

# FAQ & Troubleshooting

Answers to the most common questions encountered during daily usage and integration:

### Q: How does this differ from standard Cloudflare Workers?

**A**: Cloudforge adds a stateless workflow orchestration and distributed persistence layer on top of raw Workers, specifically suited for multi-step tasks requiring state transitions and structured retry policies.

### Q: Is offline local testing supported?

**A**: Yes. Built-in in-memory SQLite and mock drivers allow `pnpm test` to run completely green locally without connecting to any remote cloud services.

---

## General Troubleshooting Steps

1. **Verify Runtime Versions**: Ensure Node.js, Python, or browser versions meet minimum requirements.
2. **Check Console Error Logs**: Most configuration mistakes or permission denials output informative line numbers and root causes in console logs.
3. **Submit Issue Feedback**: If you confirm an underlying framework bug, please report reproducible test cases and diagnostic logs via GitHub issues.
