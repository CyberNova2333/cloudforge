# Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
# CloudForge Actions runner image: what `runs-on: ubuntu-latest` jobs get.
# Debian trixie with Node.js 24 (the base of Cloudflare's managed debian-trixie image), plus git
# for checkout and the build tools most projects expect. Keep it lean: every MB here is paid
# once per host on the first job's cold start.
# Pinned by digest (the tag alone can be moved under every deploy); Dependabot proposes new digests.
FROM --platform=$BUILDPLATFORM golang:1.27.3-trixie@sha256:c65ecfe613b539ac74c62a4c3b2c27e8f8a6076384c8f27e8a3c0f3be17cc385 AS git-lfs-build
ARG TARGETARCH
ENV CGO_ENABLED=0 GOTOOLCHAIN=local GOPROXY=https://proxy.golang.org GOSUMDB=sum.golang.org
WORKDIR /src
ADD --checksum=sha256:877b54ae20ca32ce37cb33c826e7710143cc71895f7c67a60a69b570a335ad2c \
    https://codeload.github.com/git-lfs/git-lfs/tar.gz/a662a6dbfedf706cfa9fc7a5b7bcc7ba2e2c8a65 /tmp/git-lfs-source.tar.gz
RUN tar -xzf /tmp/git-lfs-source.tar.gz --strip-components=1 -C /src \
  && rm /tmp/git-lfs-source.tar.gz
COPY git-lfs/go.mod git-lfs/go.sum /src/
RUN cp go.sum /tmp/git-lfs-go.sum.locked \
  && go mod download all \
  && cmp go.sum /tmp/git-lfs-go.sum.locked \
  && go mod verify
COPY git-lfs/build.sh /usr/local/libexec/cloudforge-git-lfs-build
RUN sh /usr/local/libexec/cloudforge-git-lfs-build "$TARGETARCH"

FROM node:24-trixie-slim@sha256:54f84b4cf8432b21aaffd5d3ce8d41e12cea0d10d33c09d2f3c9879d49d6b446
RUN apt-get update \
  && apt-get upgrade -y \
  && apt-get install -y --no-install-recommends \
    git ca-certificates curl wget jq unzip zip xz-utils zstd \
    python3 build-essential openssh-client procps \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /workspace

# Custom Git LFS 3.8.1 with pinned modules; the Go toolchain stays in the builder stage.
COPY --from=git-lfs-build /out/git-lfs /usr/local/bin/git-lfs
COPY --from=git-lfs-build /out/licenses/ /usr/local/share/licenses/git-lfs/
RUN git lfs install --skip-repo --system

# npm's bundled dependencies are independent of the application lockfile.
# Pin a tested glob/minimatch pair for every consumer, including Yarn's nested copies.
RUN node -e 'const fs = require("node:fs"); const dir = "/usr/local/share/.config/yarn/global"; fs.mkdirSync(dir, { recursive: true }); const f = dir + "/package.json"; const p = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : {}; p.private = true; p.resolutions = { ...p.resolutions, undici: "6.29.1", "ip-address": "10.7.5", glob: "14.0.3", minimatch: "11.0.4" }; fs.writeFileSync(f, JSON.stringify(p));' \
  && yarn global add npm@11.21.1 undici@6.29.1 ip-address@10.7.5 glob@14.0.3 minimatch@11.0.4 --prefix /usr/local --non-interactive \
  && rm -rf /usr/local/lib/node_modules/npm \
    /usr/local/share/.config/yarn/global/node_modules/npm/node_modules/undici \
    /usr/local/share/.config/yarn/global/node_modules/npm/node_modules/ip-address \
    /usr/local/share/.config/yarn/global/node_modules/npm/node_modules/glob \
    /usr/local/share/.config/yarn/global/node_modules/npm/node_modules/minimatch \
  && yarn cache clean

# Bootstrap verified, platform-independent wheels without keeping the older APT pip/wheel copies.
# Versions and hashes are pinned from each release's official PyPI JSON metadata.
COPY python/ /tmp/cloudforge-python/
RUN mkdir -p /tmp/python-wheels \
  && curl --fail --location --retry 3 --proto '=https' --tlsv1.2 \
    "https://files.pythonhosted.org/packages/3f/06/3e4420302363fbb71be3c7f35ce042f54bfca330e3e66b3a2e3c4cca579f/pip-26.2.2-py3-none-any.whl" \
    --output /tmp/python-wheels/pip-26.2.2-py3-none-any.whl \
  && curl --fail --location --retry 3 --proto '=https' --tlsv1.2 \
    "https://files.pythonhosted.org/packages/2e/29/69cfbb602cd91690c55d38ba9fe53e6a7e76a6fa647bf38f19c138d25449/wheel-0.48.0-py3-none-any.whl" \
    --output /tmp/python-wheels/wheel-0.48.0-py3-none-any.whl \
  && curl --fail --location --retry 3 --proto '=https' --tlsv1.2 \
    "https://files.pythonhosted.org/packages/20/12/38679034af332785aac8774540895e234f4d07f7545804097de4b666afd8/packaging-25.0-py3-none-any.whl" \
    --output /tmp/python-wheels/packaging-25.0-py3-none-any.whl \
  && curl --fail --location --retry 3 --proto '=https' --tlsv1.2 \
    "https://files.pythonhosted.org/packages/92/9d/c4e665119135114480843e7ab388fa94d8480650450e6f8e26b70d323a4c/urllib3-2.8.0-py3-none-any.whl" \
    --output /tmp/python-wheels/urllib3-2.8.0-py3-none-any.whl \
  && printf '%s\n' \
    "fd7f4dfa8190e014013b9f08f3e973f4e4c26ffd179a204895533a7254813a70  /tmp/python-wheels/pip-26.2.2-py3-none-any.whl" \
    "3217dcc807155e45db462d7ef2431f5ddda0d7273b700d05a67b271ceb1287ab  /tmp/python-wheels/wheel-0.48.0-py3-none-any.whl" \
    "29572ef2b1f17581046b3a2227d5c611fb25ec70ca1ba8554b24b0e69331a484  /tmp/python-wheels/packaging-25.0-py3-none-any.whl" \
    "0cf3cae568d36aa9576b28dfb35f11328f1cb974ca7647d9475ebb86c75ac6e3  /tmp/python-wheels/urllib3-2.8.0-py3-none-any.whl" \
    | sha256sum --check - \
  && python3 /tmp/cloudforge-python/rebuild-pip.py --inputs /tmp/python-wheels --output /tmp/python-wheels \
  && PYTHONPATH=/tmp/python-wheels/pip-26.2.2-py3-none-any.whl python3 -m pip --isolated install \
    --no-index --find-links=/tmp/python-wheels --no-deps --ignore-installed --break-system-packages \
    'pip==26.2.2+cloudforge.1' wheel==0.48.0 packaging==25.0 \
  && rm -rf /tmp/python-wheels /tmp/cloudforge-python
