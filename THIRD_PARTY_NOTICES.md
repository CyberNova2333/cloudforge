# Third-party notices

CloudForge is distributed under GPL-3.0-or-later (`LICENSE`). It is a fork of GitOrange, whose original portions remain under the Apache License 2.0 (`LICENSES/Apache-2.0.txt`, unchanged, "Copyright 2026 GitOrange contributors").

The built Worker and web app bundle the following 373 packages: everything reachable from `dependencies` in `package.json`, as installed. Each remains under its own license; the build also prepends each bundled package's license and copyright notice to the client files it ends up in (`build/license-banners.ts`). Development tooling (`devDependencies`) is not distributed. The npm installer package (`@cybernova2333/cloudforge`) declares `wrangler` as a dependency, which npm installs with its own dependency tree under their own licenses (among them `sharp`'s platform binaries, LGPL-3.0-or-later AND Apache-2.0).

Regenerate this file after changing dependencies (see the end of this file).

## Fonts (SIL Open Font License 1.1)

The web app ships these fonts as WOFF2 files; the OFL text and their copyright notices ship alongside them at `public/licenses/OFL-1.1.txt` (served at `/licenses/OFL-1.1.txt`).

- **Figtree** (`@fontsource/figtree` 5.3.0): Copyright 2022 The Figtree Project Authors (https://github.com/erikdkennedy/figtree)
- **IBM Plex Mono** (`@fontsource/ibm-plex-mono` 5.3.0): Copyright 2017 IBM Corp. All rights reserved.
- **Inter Tight** (`@fontsource/inter-tight` 5.3.0): Copyright 2022 The Inter Project Authors (https://github.com/rsms/inter-tight)

## Packages by license

| License                             | Packages |
| ----------------------------------- | -------- |
| MIT                                 | 252      |
| Apache-2.0                          | 45       |
| ISC                                 | 41       |
| BSD-3-Clause                        | 24       |
| OFL-1.1                             | 3        |
| Unlicense                           | 2        |
| (BSD-2-Clause OR MIT OR Apache-2.0) | 1        |
| (MIT OR WTFPL)                      | 1        |
| (MPL-2.0 OR Apache-2.0)             | 1        |
| 0BSD                                | 1        |
| BSD-2-Clause                        | 1        |
| MIT-0                               | 1        |

### MIT

| Package                                              | Version      | Source                                                         |
| ---------------------------------------------------- | ------------ | -------------------------------------------------------------- |
| `@antfu/install-pkg`                                 | 2.1.0        | https://github.com/antfu-collective/install-pkg                |
| `@anthropic-ai/sdk`                                  | 0.129.0      | https://github.com/anthropics/anthropic-sdk-typescript         |
| `@asteasolutions/zod-to-openapi`                     | 9.1.0        | https://github.com/asteasolutions/zod-to-openapi               |
| `@babel/code-frame`                                  | 8.0.6        | https://github.com/babel/babel                                 |
| `@babel/generator`                                   | 8.0.6        | https://github.com/babel/babel                                 |
| `@babel/helper-annotate-as-pure`                     | 8.0.0        | https://github.com/babel/babel                                 |
| `@babel/helper-create-class-features-plugin`         | 8.0.6        | https://github.com/babel/babel                                 |
| `@babel/helper-globals`                              | 8.0.6        | https://github.com/babel/babel                                 |
| `@babel/helper-member-expression-to-functions`       | 8.0.5        | https://github.com/babel/babel                                 |
| `@babel/helper-optimise-call-expression`             | 8.0.0        | https://github.com/babel/babel                                 |
| `@babel/helper-plugin-utils`                         | 8.0.1        | https://github.com/babel/babel                                 |
| `@babel/helper-replace-supers`                       | 8.0.1        | https://github.com/babel/babel                                 |
| `@babel/helper-skip-transparent-expression-wrappers` | 8.0.0        | https://github.com/babel/babel                                 |
| `@babel/helper-string-parser`                        | 8.0.6        | https://github.com/babel/babel                                 |
| `@babel/helper-validator-identifier`                 | 8.0.6        | https://github.com/babel/babel                                 |
| `@babel/parser`                                      | 8.0.6        | https://github.com/babel/babel                                 |
| `@babel/plugin-proposal-decorators`                  | 8.0.2        | https://github.com/babel/babel                                 |
| `@babel/plugin-syntax-decorators`                    | 8.0.1        | https://github.com/babel/babel                                 |
| `@babel/runtime`                                     | 7.29.7       | https://github.com/babel/babel                                 |
| `@babel/runtime-corejs3`                             | 7.29.7       | https://github.com/babel/babel                                 |
| `@babel/template`                                    | 8.0.0        | https://github.com/babel/babel                                 |
| `@babel/traverse`                                    | 8.0.6        | https://github.com/babel/babel                                 |
| `@babel/types`                                       | 8.0.6        | https://github.com/babel/babel                                 |
| `@better-auth/core`                                  | 1.7.7        | https://github.com/better-auth/better-auth                     |
| `@better-auth/drizzle-adapter`                       | 1.7.7        | https://github.com/better-auth/better-auth                     |
| `@better-auth/kysely-adapter`                        | 1.7.7        | https://github.com/better-auth/better-auth                     |
| `@better-auth/memory-adapter`                        | 1.7.7        | https://github.com/better-auth/better-auth                     |
| `@better-auth/mongo-adapter`                         | 1.7.7        | https://github.com/better-auth/better-auth                     |
| `@better-auth/oauth-provider`                        | 1.7.7        | https://github.com/better-auth/better-auth                     |
| `@better-auth/prisma-adapter`                        | 1.7.7        | https://github.com/better-auth/better-auth                     |
| `@better-auth/telemetry`                             | 1.7.7        | https://github.com/better-auth/better-auth                     |
| `@better-auth/utils`                                 | 0.4.2        | https://github.com/better-auth/utils                           |
| `@better-auth/utils`                                 | 0.5.0        | https://github.com/better-auth/utils                           |
| `@better-fetch/fetch`                                | 1.3.2        | https://github.com/better-auth/better-fetch                    |
| `@borewit/text-codec`                                | 0.2.2        | https://github.com/Borewit/text-codec                          |
| `@braintree/sanitize-url`                            | 7.1.2        | https://github.com/braintree/sanitize-url                      |
| `@cfworker/json-schema`                              | 4.1.1        | https://github.com/cfworker/cfworker                           |
| `@cloudflare/computer`                               | 0.4.0        | https://github.com/cloudflare/computer                         |
| `@earendil-works/chord`                              | 1.0.0        | https://github.com/earendil-works/pi                           |
| `@earendil-works/chord`                              | 1.0.1        | https://github.com/earendil-works/pi                           |
| `@earendil-works/pi-ai`                              | 1.0.1        | https://github.com/earendil-works/pi                           |
| `@earendil-works/pi-durable`                         | 1.0.1        | https://github.com/earendil-works/pi                           |
| `@earendil-works/pi-telemetry`                       | 1.0.1        | https://github.com/earendil-works/pi                           |
| `@esbuild/win32-x64`                                 | 0.28.2       | https://github.com/evanw/esbuild                               |
| `@hono/swagger-ui`                                   | 0.6.1        | https://github.com/honojs/middleware                           |
| `@hono/zod-openapi`                                  | 1.6.3        | https://github.com/honojs/middleware                           |
| `@hono/zod-validator`                                | 0.9.1        | https://github.com/honojs/middleware                           |
| `@iconify/types`                                     | 2.0.0        | https://github.com/iconify/iconify                             |
| `@iconify/utils`                                     | 3.1.7        | https://github.com/iconify/iconify                             |
| `@jridgewell/gen-mapping`                            | 0.4.0-beta.0 | https://github.com/jridgewell/sourcemaps                       |
| `@jridgewell/resolve-uri`                            | 3.1.2        | https://github.com/jridgewell/resolve-uri                      |
| `@jridgewell/sourcemap-codec`                        | 1.6.0        | https://github.com/jridgewell/sourcemaps                       |
| `@jridgewell/trace-mapping`                          | 0.3.31       | https://github.com/jridgewell/sourcemaps                       |
| `@mermaid-js/parser`                                 | 1.2.1        | https://github.com/mermaid-js/mermaid                          |
| `@noble/ciphers`                                     | 2.4.0        | https://github.com/paulmillr/noble-ciphers                     |
| `@noble/hashes`                                      | 2.4.0        | https://github.com/paulmillr/noble-hashes                      |
| `@nodable/entities`                                  | 3.1.0        | https://github.com/nodable/val-parsers                         |
| `@primer/css`                                        | 21.5.1       | https://github.com/primer/css                                  |
| `@primer/octicons-react`                             | 19.38.0      | primer/octicons                                                |
| `@primer/primitives`                                 | 10.7.0       | https://github.com/primer/primitives                           |
| `@remix-run/router`                                  | 1.23.4       | https://github.com/remix-run/react-router                      |
| `@rolldown/plugin-babel`                             | 0.2.4        | https://github.com/rolldown/plugins                            |
| `@stablelib/base64`                                  | 1.0.1        | https://github.com/StableLib/stablelib                         |
| `@standard-schema/spec`                              | 1.1.0        | https://github.com/standard-schema/standard-schema             |
| `@tanstack/query-core`                               | 5.104.0      | https://github.com/TanStack/query                              |
| `@tanstack/react-query`                              | 5.104.0      | https://github.com/TanStack/query                              |
| `@tokenizer/inflate`                                 | 0.4.1        | https://github.com/Borewit/tokenizer-inflate                   |
| `@tokenizer/token`                                   | 0.3.0        | https://github.com/Borewit/tokenizer-token                     |
| `@types/d3`                                          | 7.4.3        | https://github.com/DefinitelyTyped/DefinitelyTyped             |
| `@types/d3-array`                                    | 3.2.2        | https://github.com/DefinitelyTyped/DefinitelyTyped             |
| `@types/d3-axis`                                     | 3.0.6        | https://github.com/DefinitelyTyped/DefinitelyTyped             |
| `@types/d3-brush`                                    | 3.0.6        | https://github.com/DefinitelyTyped/DefinitelyTyped             |
| `@types/d3-chord`                                    | 3.0.6        | https://github.com/DefinitelyTyped/DefinitelyTyped             |
| `@types/d3-color`                                    | 3.1.3        | https://github.com/DefinitelyTyped/DefinitelyTyped             |
| `@types/d3-contour`                                  | 3.0.6        | https://github.com/DefinitelyTyped/DefinitelyTyped             |
| `@types/d3-delaunay`                                 | 6.0.4        | https://github.com/DefinitelyTyped/DefinitelyTyped             |
| `@types/d3-dispatch`                                 | 3.0.7        | https://github.com/DefinitelyTyped/DefinitelyTyped             |
| `@types/d3-drag`                                     | 3.0.7        | https://github.com/DefinitelyTyped/DefinitelyTyped             |
| `@types/d3-dsv`                                      | 3.0.7        | https://github.com/DefinitelyTyped/DefinitelyTyped             |
| `@types/d3-ease`                                     | 3.0.2        | https://github.com/DefinitelyTyped/DefinitelyTyped             |
| `@types/d3-fetch`                                    | 3.0.7        | https://github.com/DefinitelyTyped/DefinitelyTyped             |
| `@types/d3-force`                                    | 3.0.10       | https://github.com/DefinitelyTyped/DefinitelyTyped             |
| `@types/d3-format`                                   | 3.0.4        | https://github.com/DefinitelyTyped/DefinitelyTyped             |
| `@types/d3-geo`                                      | 3.1.1        | https://github.com/DefinitelyTyped/DefinitelyTyped             |
| `@types/d3-hierarchy`                                | 3.1.7        | https://github.com/DefinitelyTyped/DefinitelyTyped             |
| `@types/d3-interpolate`                              | 3.0.4        | https://github.com/DefinitelyTyped/DefinitelyTyped             |
| `@types/d3-path`                                     | 3.1.1        | https://github.com/DefinitelyTyped/DefinitelyTyped             |
| `@types/d3-polygon`                                  | 3.0.2        | https://github.com/DefinitelyTyped/DefinitelyTyped             |
| `@types/d3-quadtree`                                 | 3.0.6        | https://github.com/DefinitelyTyped/DefinitelyTyped             |
| `@types/d3-random`                                   | 3.0.4        | https://github.com/DefinitelyTyped/DefinitelyTyped             |
| `@types/d3-scale`                                    | 4.0.9        | https://github.com/DefinitelyTyped/DefinitelyTyped             |
| `@types/d3-scale-chromatic`                          | 3.1.0        | https://github.com/DefinitelyTyped/DefinitelyTyped             |
| `@types/d3-selection`                                | 3.0.12       | https://github.com/DefinitelyTyped/DefinitelyTyped             |
| `@types/d3-shape`                                    | 3.2.0        | https://github.com/DefinitelyTyped/DefinitelyTyped             |
| `@types/d3-time`                                     | 3.0.4        | https://github.com/DefinitelyTyped/DefinitelyTyped             |
| `@types/d3-time-format`                              | 4.0.3        | https://github.com/DefinitelyTyped/DefinitelyTyped             |
| `@types/d3-timer`                                    | 3.0.2        | https://github.com/DefinitelyTyped/DefinitelyTyped             |
| `@types/d3-transition`                               | 3.0.9        | https://github.com/DefinitelyTyped/DefinitelyTyped             |
| `@types/d3-zoom`                                     | 3.0.9        | https://github.com/DefinitelyTyped/DefinitelyTyped             |
| `@types/geojson`                                     | 7946.0.16    | https://github.com/DefinitelyTyped/DefinitelyTyped             |
| `@types/jsesc`                                       | 2.5.1        | https://github.com/DefinitelyTyped/DefinitelyTyped             |
| `@types/node`                                        | 26.6.4       | https://github.com/DefinitelyTyped/DefinitelyTyped             |
| `@types/retry`                                       | 0.12.0       | https://github.com/DefinitelyTyped/DefinitelyTyped             |
| `@types/trusted-types`                               | 2.0.7        | https://github.com/DefinitelyTyped/DefinitelyTyped             |
| `@upsetjs/venn.js`                                   | 2.0.0        | https://github.com/upsetjs/venn.js                             |
| `acorn`                                              | 8.18.0       | https://github.com/acornjs/acorn                               |
| `agent-base`                                         | 7.1.4        | https://github.com/TooTallNate/proxy-agents                    |
| `agent-base`                                         | 9.0.0        | https://github.com/TooTallNate/proxy-agents                    |
| `agent-robot-avatar`                                 | 0.5.2        | https://github.com/CX-ArtLab/agent-robot-avatar                |
| `agents`                                             | 0.26.0       | https://github.com/cloudflare/agents                           |
| `anynum`                                             | 1.0.1        | https://github.com/NaturalIntelligence/anynum                  |
| `aws4fetch`                                          | 1.0.20       | https://github.com/mhart/aws4fetch                             |
| `base64-js`                                          | 1.5.1        | https://github.com/beatgammit/base64-js                        |
| `better-auth`                                        | 1.7.7        | https://github.com/better-auth/better-auth                     |
| `better-call`                                        | 1.4.0        | https://github.com/better-auth/better-call                     |
| `bignumber.js`                                       | 9.3.1        | https://github.com/MikeMcl/bignumber.js                        |
| `bl`                                                 | 4.1.0        | https://github.com/rvagg/bl                                    |
| `bowser`                                             | 2.14.1       | https://github.com/bowser-js/bowser                            |
| `buffer`                                             | 5.7.1        | https://github.com/feross/buffer                               |
| `capnweb`                                            | 0.10.0       | https://github.com/cloudflare/capnweb                          |
| `capnweb`                                            | 0.12.0       | https://github.com/cloudflare/capnweb                          |
| `clsx`                                               | 2.1.1        | lukeed/clsx                                                    |
| `commander`                                          | 6.2.1        | https://github.com/tj/commander.js                             |
| `commander`                                          | 7.2.0        | https://github.com/tj/commander.js                             |
| `commander`                                          | 8.3.0        | https://github.com/tj/commander.js                             |
| `core-js-pure`                                       | 3.50.0       | https://github.com/zloirock/core-js                            |
| `cose-base`                                          | 1.0.3        | https://github.com/iVis-at-Bilkent/cose-base                   |
| `cose-base`                                          | 2.2.0        | https://github.com/iVis-at-Bilkent/cose-base                   |
| `cron-schedule`                                      | 6.0.0        | https://github.com/P4sca1/cron-schedule                        |
| `cytoscape`                                          | 3.34.3       | https://github.com/cytoscape/cytoscape.js                      |
| `cytoscape-cose-bilkent`                             | 4.1.0        | https://github.com/cytoscape/cytoscape.js-cose-bilkent         |
| `cytoscape-fcose`                                    | 2.2.0        | https://github.com/iVis-at-Bilkent/cytoscape.js-fcose          |
| `dagre-d3-es`                                        | 7.0.14       | https://github.com/tbo47/dagre-es                              |
| `data-uri-to-buffer`                                 | 4.0.1        | https://github.com/TooTallNate/node-data-uri-to-buffer         |
| `dayjs`                                              | 1.11.23      | https://github.com/iamkun/dayjs                                |
| `debug`                                              | 4.4.3        | https://github.com/debug-js/debug                              |
| `decompress-response`                                | 6.0.0        | sindresorhus/decompress-response                               |
| `deep-extend`                                        | 0.6.0        | https://github.com/unclechu/node-deep-extend                   |
| `defu`                                               | 6.1.7        | unjs/defu                                                      |
| `end-of-stream`                                      | 1.4.5        | https://github.com/mafintosh/end-of-stream                     |
| `es-toolkit`                                         | 1.52.0       | https://github.com/toss/es-toolkit                             |
| `esbuild`                                            | 0.28.2       | https://github.com/evanw/esbuild                               |
| `event-target-polyfill`                              | 0.0.4        | https://github.com/benlesh/event-target-polyfill               |
| `extend`                                             | 3.0.2        | https://github.com/justmoon/node-extend                        |
| `fast-xml-builder`                                   | 1.3.1        | https://github.com/NaturalIntelligence/fast-xml-builder        |
| `fast-xml-parser`                                    | 5.11.2       | https://github.com/NaturalIntelligence/fast-xml-parser         |
| `fastdom`                                            | 1.0.12       | https://github.com/wilsonpage/fastdom                          |
| `fetch-blob`                                         | 3.2.0        | https://github.com/node-fetch/fetch-blob                       |
| `file-type`                                          | 21.3.4       | sindresorhus/file-type                                         |
| `formdata-polyfill`                                  | 4.0.10       | https://jimmywarting@github.com/jimmywarting/FormData          |
| `fs-constants`                                       | 1.0.0        | https://github.com/mafintosh/fs-constants                      |
| `github-from-package`                                | 0.0.0        | https://github.com/substack/github-from-package                |
| `hachure-fill`                                       | 0.5.2        | https://github.com/pshihn/hachure-fill                         |
| `hono`                                               | 4.13.12      | https://github.com/honojs/hono                                 |
| `http-proxy-agent`                                   | 9.1.0        | https://github.com/TooTallNate/proxy-agents                    |
| `https-proxy-agent`                                  | 7.0.6        | https://github.com/TooTallNate/proxy-agents                    |
| `https-proxy-agent`                                  | 9.1.0        | https://github.com/TooTallNate/proxy-agents                    |
| `iconv-lite`                                         | 0.6.3        | https://github.com/ashtuchkin/iconv-lite                       |
| `import-meta-resolve`                                | 4.2.0        | wooorm/import-meta-resolve                                     |
| `ipaddr.js`                                          | 2.2.0        | https://github.com/whitequark/ipaddr.js                        |
| `is-unsafe`                                          | 2.0.2        | https://github.com/NaturalIntelligence/is-unsafe               |
| `jose`                                               | 6.2.12       | panva/jose                                                     |
| `js-tokens`                                          | 10.0.0       | lydell/js-tokens                                               |
| `js-tokens`                                          | 4.0.0        | lydell/js-tokens                                               |
| `jsesc`                                              | 3.1.0        | https://github.com/mathiasbynens/jsesc                         |
| `json-bigint`                                        | 1.0.0        | https://github.com/sidorares/json-bigint                       |
| `json-schema-to-ts`                                  | 3.1.1        | https://github.com/ThomasAribart/json-schema-to-ts             |
| `jwa`                                                | 2.0.1        | https://github.com/brianloveswords/node-jwa                    |
| `jws`                                                | 4.0.1        | https://github.com/brianloveswords/node-jws                    |
| `katex`                                              | 0.16.47      | https://github.com/KaTeX/KaTeX                                 |
| `khroma`                                             | 2.1.0        | https://github.com/fabiospampinato/khroma                      |
| `kysely`                                             | 0.29.6       | https://github.com/kysely-org/kysely                           |
| `layout-base`                                        | 1.0.2        | https://github.com/iVis-at-Bilkent/layout-base                 |
| `layout-base`                                        | 2.0.1        | https://github.com/iVis-at-Bilkent/layout-base                 |
| `lodash-es`                                          | 4.18.1       | lodash/lodash                                                  |
| `loose-envify`                                       | 1.4.0        | https://github.com/zertosh/loose-envify                        |
| `marked`                                             | 16.4.2       | https://github.com/markedjs/marked                             |
| `marked`                                             | 18.0.14      | https://github.com/markedjs/marked                             |
| `mermaid`                                            | 11.17.2      | https://github.com/mermaid-js/mermaid                          |
| `mime-db`                                            | 1.52.0       | jshttp/mime-db                                                 |
| `mime-types`                                         | 2.1.35       | jshttp/mime-types                                              |
| `mimetext`                                           | 3.0.28       | https://github.com/muratgozel/MIMEText                         |
| `mimic-response`                                     | 3.1.0        | sindresorhus/mimic-response                                    |
| `minimist`                                           | 1.2.8        | https://github.com/minimistjs/minimist                         |
| `mkdirp-classic`                                     | 0.5.3        | https://github.com/mafintosh/mkdirp-classic                    |
| `modern-tar`                                         | 0.7.7        | https://github.com/ayuhito/modern-tar                          |
| `ms`                                                 | 2.1.3        | vercel/ms                                                      |
| `nanoid`                                             | 5.1.16       | ai/nanoid                                                      |
| `nanostores`                                         | 1.5.4        | nanostores/nanostores                                          |
| `napi-build-utils`                                   | 2.0.0        | https://github.com/inspiredware/napi-build-utils               |
| `node-abi`                                           | 3.96.0       | https://github.com/electron/node-abi                           |
| `node-addon-api`                                     | 8.9.2        | https://github.com/nodejs/node-addon-api                       |
| `node-diff3`                                         | 3.2.1        | https://github.com/bhousel/node-diff3                          |
| `node-domexception`                                  | 1.0.0        | https://github.com/jimmywarting/node-domexception              |
| `node-fetch`                                         | 3.3.2        | https://github.com/node-fetch/node-fetch                       |
| `obug`                                               | 2.2.1        | https://github.com/sxzz/obug                                   |
| `openapi3-ts`                                        | 4.6.1        | https://github.com/metadevpro/openapi3-ts                      |
| `p-retry`                                            | 4.6.2        | sindresorhus/p-retry                                           |
| `package-manager-detector`                           | 1.8.0        | https://github.com/antfu-collective/package-manager-detector   |
| `papaparse`                                          | 5.7.0        | https://github.com/mholt/PapaParse                             |
| `partial-json`                                       | 0.1.7        | https://github.com/promplate/partial-json-parser-js            |
| `partysocket`                                        | 1.3.0        | https://github.com/cloudflare/partykit                         |
| `path-data-parser`                                   | 0.1.0        | https://github.com/pshihn/path-data-parser                     |
| `path-expression-matcher`                            | 1.6.2        | https://github.com/NaturalIntelligence/path-expression-matcher |
| `picomatch`                                          | 4.0.7        | micromatch/picomatch                                           |
| `points-on-curve`                                    | 0.2.0        | https://github.com/pshihn/bezier-points                        |
| `points-on-path`                                     | 0.2.1        | https://github.com/pshihn/points-on-path                       |
| `prebuild-install`                                   | 7.1.3        | https://github.com/prebuild/prebuild-install                   |
| `proxy-agent-negotiate`                              | 1.1.0        | https://github.com/TooTallNate/proxy-agents                    |
| `pump`                                               | 3.0.4        | https://github.com/mafintosh/pump                              |
| `re2js`                                              | 1.4.0        | https://github.com/le0pard/re2js                               |
| `react`                                              | 18.3.1       | https://github.com/facebook/react                              |
| `react-dom`                                          | 18.3.1       | https://github.com/facebook/react                              |
| `react-router`                                       | 6.30.6       | https://github.com/remix-run/react-router                      |
| `react-router-dom`                                   | 6.30.6       | https://github.com/remix-run/react-router                      |
| `readable-stream`                                    | 3.6.2        | https://github.com/nodejs/readable-stream                      |
| `retry`                                              | 0.13.1       | https://github.com/tim-kos/node-retry                          |
| `rou3`                                               | 0.9.2        | h3js/rou3                                                      |
| `roughjs`                                            | 4.6.6        | https://github.com/pshihn/rough                                |
| `safe-buffer`                                        | 5.2.1        | https://github.com/feross/safe-buffer                          |
| `safer-buffer`                                       | 2.1.2        | https://github.com/ChALkeR/safer-buffer                        |
| `scheduler`                                          | 0.23.2       | https://github.com/facebook/react                              |
| `seek-bzip`                                          | 2.0.0        | https://github.com/cscott/seek-bzip                            |
| `set-cookie-parser`                                  | 3.1.2        | nfriedly/set-cookie-parser                                     |
| `simple-concat`                                      | 1.0.1        | https://github.com/feross/simple-concat                        |
| `simple-get`                                         | 4.0.1        | https://github.com/feross/simple-get                           |
| `sql.js`                                             | 1.14.2       | http://github.com/sql-js/sql.js                                |
| `standardwebhooks`                                   | 1.1.1        | https://github.com/standard-webhooks/standard-webhooks         |
| `strictdom`                                          | 1.0.1        | https://github.com/wilsonpage/strictdom                        |
| `string_decoder`                                     | 1.3.0        | https://github.com/nodejs/string_decoder                       |
| `strip-json-comments`                                | 2.0.1        | sindresorhus/strip-json-comments                               |
| `strnum`                                             | 2.4.2        | https://github.com/NaturalIntelligence/strnum                  |
| `strtok3`                                            | 10.3.5       | https://github.com/Borewit/strtok3                             |
| `stylis`                                             | 4.4.0        | https://github.com/thysultan/stylis.js                         |
| `tar-fs`                                             | 2.1.5        | https://github.com/mafintosh/tar-fs                            |
| `tar-stream`                                         | 2.2.0        | https://github.com/mafintosh/tar-stream                        |
| `tinyexec`                                           | 1.3.1        | https://github.com/tinylibs/tinyexec                           |
| `token-types`                                        | 6.1.2        | https://github.com/Borewit/token-types                         |
| `ts-algebra`                                         | 2.0.0        | https://github.com/ThomasAribart/ts-algebra                    |
| `ts-dedent`                                          | 2.3.0        | https://github.com/tamino-martinius/node-ts-dedent             |
| `turndown`                                           | 7.2.4        | https://github.com/mixmark-io/turndown                         |
| `typebox`                                            | 1.3.27       | https://github.com/sinclairzx81/typebox                        |
| `uint8array-extras`                                  | 1.6.0        | sindresorhus/uint8array-extras                                 |
| `undici`                                             | 7.29.0       | https://github.com/nodejs/undici                               |
| `undici-types`                                       | 8.9.0        | https://github.com/nodejs/undici                               |
| `util-deprecate`                                     | 1.0.2        | https://github.com/TooTallNate/util-deprecate                  |
| `uuid`                                               | 14.0.2       | https://github.com/uuidjs/uuid                                 |
| `verkit`                                             | 0.3.2        | https://github.com/sxzz/verkit                                 |
| `web-streams-polyfill`                               | 3.3.3        | https://github.com/MattiasBuelens/web-streams-polyfill         |
| `ws`                                                 | 8.22.0       | https://github.com/websockets/ws                               |
| `xml-naming`                                         | 0.3.0        | https://github.com/NaturalIntelligence/xml-naming              |
| `zod`                                                | 4.6.5        | https://github.com/colinhacks/zod                              |

### Apache-2.0

| Package                                     | Version  | Source                                                    |
| ------------------------------------------- | -------- | --------------------------------------------------------- |
| `@aws-sdk/client-bedrock-runtime`           | 3.1127.0 | https://github.com/aws/aws-sdk-js-v3                      |
| `@aws-sdk/core`                             | 3.978.1  | https://github.com/aws/aws-sdk-js-v3                      |
| `@aws-sdk/credential-provider-env`          | 3.972.72 | https://github.com/aws/aws-sdk-js-v3                      |
| `@aws-sdk/credential-provider-http`         | 3.972.74 | https://github.com/aws/aws-sdk-js-v3                      |
| `@aws-sdk/credential-provider-ini`          | 3.973.17 | https://github.com/aws/aws-sdk-js-v3                      |
| `@aws-sdk/credential-provider-login`        | 3.972.79 | https://github.com/aws/aws-sdk-js-v3                      |
| `@aws-sdk/credential-provider-node`         | 3.972.84 | https://github.com/aws/aws-sdk-js-v3                      |
| `@aws-sdk/credential-provider-process`      | 3.972.72 | https://github.com/aws/aws-sdk-js-v3                      |
| `@aws-sdk/credential-provider-sso`          | 3.973.16 | https://github.com/aws/aws-sdk-js-v3                      |
| `@aws-sdk/credential-provider-web-identity` | 3.972.78 | https://github.com/aws/aws-sdk-js-v3                      |
| `@aws-sdk/eventstream-handler-node`         | 3.972.35 | https://github.com/aws/aws-sdk-js-v3                      |
| `@aws-sdk/middleware-eventstream`           | 3.972.30 | https://github.com/aws/aws-sdk-js-v3                      |
| `@aws-sdk/middleware-websocket`             | 3.972.54 | https://github.com/aws/aws-sdk-js-v3                      |
| `@aws-sdk/nested-clients`                   | 3.997.46 | https://github.com/aws/aws-sdk-js-v3                      |
| `@aws-sdk/signature-v4-multi-region`        | 3.996.47 | https://github.com/aws/aws-sdk-js-v3                      |
| `@aws-sdk/token-providers`                  | 3.1127.0 | https://github.com/aws/aws-sdk-js-v3                      |
| `@aws-sdk/token-providers`                  | 3.1138.0 | https://github.com/aws/aws-sdk-js-v3                      |
| `@aws-sdk/types`                            | 3.974.6  | https://github.com/aws/aws-sdk-js-v3                      |
| `@aws-sdk/xml-builder`                      | 3.972.41 | https://github.com/aws/aws-sdk-js-v3                      |
| `@aws/lambda-invoke-store`                  | 0.3.0    | https://github.com/awslabs/aws-lambda-invoke-store        |
| `@chevrotain/types`                         | 11.1.2   | https://github.com/Chevrotain/chevrotain                  |
| `@google/genai`                             | 2.21.0   | https://github.com/googleapis/js-genai                    |
| `@mongodb-js/zstd`                          | 7.0.0    | https://github.com/mongodb-js/zstd                        |
| `@opentelemetry/semantic-conventions`       | 1.43.0   | open-telemetry/opentelemetry-js                           |
| `@smithy/core`                              | 3.35.1   | https://github.com/smithy-lang/smithy-typescript          |
| `@smithy/credential-provider-imds`          | 4.5.2    | https://github.com/smithy-lang/smithy-typescript          |
| `@smithy/fetch-http-handler`                | 5.8.0    | https://github.com/smithy-lang/smithy-typescript          |
| `@smithy/node-http-handler`                 | 4.12.1   | https://github.com/smithy-lang/smithy-typescript          |
| `@smithy/signature-v4`                      | 5.7.4    | https://github.com/smithy-lang/smithy-typescript          |
| `@smithy/types`                             | 4.19.0   | https://github.com/smithy-lang/smithy-typescript          |
| `detect-libc`                               | 2.1.2    | https://github.com/lovell/detect-libc                     |
| `drizzle-orm`                               | 0.45.3   | https://github.com/drizzle-team/drizzle-orm               |
| `ecdsa-sig-formatter`                       | 1.0.11   | ssh://git@github.com/Brightspace/node-ecdsa-sig-formatter |
| `gaxios`                                    | 7.3.1    | https://github.com/googleapis/google-cloud-node           |
| `gcp-metadata`                              | 8.1.2    | https://github.com/googleapis/google-cloud-node-core      |
| `google-auth-library`                       | 10.9.1   | https://github.com/googleapis/google-cloud-node           |
| `google-logging-utils`                      | 1.1.3    | https://github.com/googleapis/google-cloud-node-core      |
| `google-logging-utils`                      | 1.2.0    | https://github.com/googleapis/google-cloud-node           |
| `guarded-fetch`                             | 0.1.3    | https://github.com/vercel-labs/guarded-fetch              |
| `just-bash`                                 | 3.6.0    | https://github.com/vercel-labs/just-bash                  |
| `long`                                      | 5.3.2    | https://github.com/dcodeIO/long.js                        |
| `openai`                                    | 7.19.0   | https://github.com/openai/openai-node                     |
| `run`                                       | 2.1.3    | https://github.com/vercel-labs/run                        |
| `tunnel-agent`                              | 0.6.0    | https://github.com/mikeal/tunnel-agent                    |
| `typescript`                                | 5.9.3    | https://github.com/microsoft/TypeScript                   |

### ISC

| Package              | Version | Source                                   |
| -------------------- | ------- | ---------------------------------------- |
| `chownr`             | 1.1.4   | https://github.com/isaacs/chownr         |
| `d3`                 | 7.9.0   | https://github.com/d3/d3                 |
| `d3-array`           | 3.2.4   | https://github.com/d3/d3-array           |
| `d3-axis`            | 3.0.0   | https://github.com/d3/d3-axis            |
| `d3-brush`           | 3.0.0   | https://github.com/d3/d3-brush           |
| `d3-chord`           | 3.0.1   | https://github.com/d3/d3-chord           |
| `d3-color`           | 3.1.0   | https://github.com/d3/d3-color           |
| `d3-contour`         | 4.0.2   | https://github.com/d3/d3-contour         |
| `d3-delaunay`        | 6.0.4   | https://github.com/d3/d3-delaunay        |
| `d3-dispatch`        | 3.0.1   | https://github.com/d3/d3-dispatch        |
| `d3-drag`            | 3.0.0   | https://github.com/d3/d3-drag            |
| `d3-dsv`             | 3.0.1   | https://github.com/d3/d3-dsv             |
| `d3-fetch`           | 3.0.1   | https://github.com/d3/d3-fetch           |
| `d3-force`           | 3.0.0   | https://github.com/d3/d3-force           |
| `d3-format`          | 3.1.2   | https://github.com/d3/d3-format          |
| `d3-geo`             | 3.1.1   | https://github.com/d3/d3-geo             |
| `d3-hierarchy`       | 3.1.2   | https://github.com/d3/d3-hierarchy       |
| `d3-interpolate`     | 3.0.1   | https://github.com/d3/d3-interpolate     |
| `d3-path`            | 3.1.0   | https://github.com/d3/d3-path            |
| `d3-polygon`         | 3.0.1   | https://github.com/d3/d3-polygon         |
| `d3-quadtree`        | 3.0.1   | https://github.com/d3/d3-quadtree        |
| `d3-random`          | 3.0.1   | https://github.com/d3/d3-random          |
| `d3-scale`           | 4.0.2   | https://github.com/d3/d3-scale           |
| `d3-scale-chromatic` | 3.1.0   | https://github.com/d3/d3-scale-chromatic |
| `d3-selection`       | 3.0.0   | https://github.com/d3/d3-selection       |
| `d3-shape`           | 3.2.0   | https://github.com/d3/d3-shape           |
| `d3-time`            | 3.1.0   | https://github.com/d3/d3-time            |
| `d3-time-format`     | 4.1.0   | https://github.com/d3/d3-time-format     |
| `d3-timer`           | 3.0.1   | https://github.com/d3/d3-timer           |
| `d3-transition`      | 3.0.1   | https://github.com/d3/d3-transition      |
| `d3-zoom`            | 3.0.0   | https://github.com/d3/d3-zoom            |
| `delaunator`         | 5.1.0   | https://github.com/mapbox/delaunator     |
| `inherits`           | 2.0.4   | https://github.com/isaacs/inherits       |
| `ini`                | 1.3.8   | https://github.com/isaacs/ini            |
| `ini`                | 6.0.0   | https://github.com/npm/ini               |
| `internmap`          | 1.0.1   | https://github.com/mbostock/internmap    |
| `internmap`          | 2.0.3   | https://github.com/mbostock/internmap    |
| `once`               | 1.4.0   | https://github.com/isaacs/once           |
| `semver`             | 7.8.5   | https://github.com/npm/node-semver       |
| `wrappy`             | 1.0.2   | https://github.com/npm/wrappy            |
| `yaml`               | 2.9.1   | https://github.com/eemeli/yaml           |

### BSD-3-Clause

| Package                      | Version | Source                                                  |
| ---------------------------- | ------- | ------------------------------------------------------- |
| `@protobufjs/aspromise`      | 1.1.2   | https://github.com/dcodeIO/protobuf.js                  |
| `@protobufjs/base64`         | 1.1.2   | https://github.com/dcodeIO/protobuf.js                  |
| `@protobufjs/codegen`        | 2.0.5   | https://github.com/dcodeIO/protobuf.js                  |
| `@protobufjs/eventemitter`   | 1.1.1   | https://github.com/dcodeIO/protobuf.js                  |
| `@protobufjs/fetch`          | 1.1.1   | https://github.com/dcodeIO/protobuf.js                  |
| `@protobufjs/float`          | 1.0.2   | https://github.com/dcodeIO/protobuf.js                  |
| `@protobufjs/path`           | 1.1.2   | https://github.com/dcodeIO/protobuf.js                  |
| `@protobufjs/pool`           | 1.1.0   | https://github.com/dcodeIO/protobuf.js                  |
| `@protobufjs/utf8`           | 1.1.2   | https://github.com/protobufjs/protobuf.js               |
| `buffer-equal-constant-time` | 1.0.1   | https://github.com/goinstant/buffer-equal-constant-time |
| `d3-array`                   | 2.12.1  | https://github.com/d3/d3-array                          |
| `d3-ease`                    | 3.0.1   | https://github.com/d3/d3-ease                           |
| `d3-path`                    | 1.0.9   | https://github.com/d3/d3-path                           |
| `d3-sankey`                  | 0.12.3  | https://github.com/d3/d3-sankey                         |
| `d3-shape`                   | 1.3.7   | https://github.com/d3/d3-shape                          |
| `diff`                       | 8.0.4   | https://github.com/kpdecker/jsdiff                      |
| `diff`                       | 9.0.0   | https://github.com/kpdecker/jsdiff                      |
| `highlight.js`               | 11.12.0 | https://github.com/highlightjs/highlight.js             |
| `ieee754`                    | 1.2.1   | https://github.com/feross/ieee754                       |
| `js-base64`                  | 3.9.4   | https://github.com/dankogai/js-base64                   |
| `protobufjs`                 | 7.6.6   | protobufjs/protobuf.js                                  |
| `rw`                         | 1.3.3   | http://github.com/mbostock/rw                           |
| `smol-toml`                  | 1.9.0   | https://github.com/squirrelchat/smol-toml               |
| `sprintf-js`                 | 1.1.3   | https://github.com/alexei/sprintf.js                    |

### OFL-1.1

| Package                     | Version | Source                                   |
| --------------------------- | ------- | ---------------------------------------- |
| `@fontsource/figtree`       | 5.3.0   | https://github.com/fontsource/font-files |
| `@fontsource/ibm-plex-mono` | 5.3.0   | https://github.com/fontsource/font-files |
| `@fontsource/inter-tight`   | 5.3.0   | https://github.com/fontsource/font-files |

### Unlicense

| Package             | Version | Source                                       |
| ------------------- | ------- | -------------------------------------------- |
| `fast-sha256`       | 1.3.0   | https://github.com/dchest/fast-sha256-js     |
| `robust-predicates` | 3.0.3   | https://github.com/mourner/robust-predicates |

### (BSD-2-Clause OR MIT OR Apache-2.0)

| Package | Version | Source                            |
| ------- | ------- | --------------------------------- |
| `rc`    | 1.2.8   | https://github.com/dominictarr/rc |

### (MIT OR WTFPL)

| Package           | Version | Source                                           |
| ----------------- | ------- | ------------------------------------------------ |
| `expand-template` | 2.0.3   | https://github.com/ralphtheninja/expand-template |

### (MPL-2.0 OR Apache-2.0)

| Package     | Version | Source                              |
| ----------- | ------- | ----------------------------------- |
| `dompurify` | 3.4.16  | https://github.com/cure53/DOMPurify |

### 0BSD

| Package | Version | Source                             |
| ------- | ------- | ---------------------------------- |
| `tslib` | 2.8.1   | https://github.com/Microsoft/tslib |

### BSD-2-Clause

| Package              | Version | Source                               |
| -------------------- | ------- | ------------------------------------ |
| `@mixmark-io/domino` | 2.2.0   | https://github.com/mixmark-io/domino |

### MIT-0

| Package       | Version | Source                                   |
| ------------- | ------- | ---------------------------------------- |
| `postal-mime` | 2.7.6   | https://github.com/postalsys/postal-mime |

## Regenerating

This list was generated from `node_modules` after `yarn install --frozen-lockfile`, by walking `dependencies` (and installed optional dependencies) from `package.json` and reading each package's `license` field.
