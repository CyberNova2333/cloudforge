# Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
# CloudForge Actions runner image: what `runs-on: ubuntu-latest` jobs get.
# Debian trixie with Node.js 24 (the base of Cloudflare's managed debian-trixie image), plus git
# for checkout and the build tools most projects expect. Keep it lean: every MB here is paid
# once per host on the first job's cold start.
# Pinned by digest (the tag alone can be moved under every deploy); Dependabot proposes new digests.
FROM node:24-trixie-slim@sha256:54f84b4cf8432b21aaffd5d3ce8d41e12cea0d10d33c09d2f3c9879d49d6b446
RUN apt-get update \
  && apt-get upgrade -y \
  && apt-get install -y --no-install-recommends \
    git git-lfs ca-certificates curl wget jq unzip zip xz-utils zstd \
    python3 python3-pip build-essential openssh-client procps \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /workspace

# The Node image ships its own npm dependency tree, outside the application lockfile.
# Use a patched same-major undici via Node resolution instead of npm's bundled older copy.
RUN yarn global add npm@11.21.1 undici@6.29.1 --prefix /usr/local --non-interactive \
  && rm -rf /usr/local/lib/node_modules/npm \
    /usr/local/share/.config/yarn/global/node_modules/npm/node_modules/undici \
  && yarn cache clean
