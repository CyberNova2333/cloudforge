// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react-swc';
import path from 'path';
import { cloudflare } from '@cloudflare/vite-plugin';
import { licenseBanners } from './build/license-banners';

/**
 * Strips mermaid's unused lazy ELK layout chunk (`elkjs`, EPL-2.0) from built bundles so no
 * EPL-2.0 code ships inside CloudForge's AGPL-3.0-only client or worker artifacts.
 * CloudForge initializes mermaid with `layout: 'dagre'` (`src/lib/ui/mermaid.ts`).
 */
function stripMermaidElk(): Plugin {
  const VIRTUAL_ID = '\0cloudforge:elk-disabled';
  const MERMAID_ELK_CHUNK =
    /[\\/]mermaid[\\/]dist[\\/]chunks[\\/]mermaid\.(?:core|esm(?:\.min)?)[\\/]elk-[^\\/]+\.mjs$/;
  return {
    name: 'cloudforge:strip-mermaid-elk',
    enforce: 'pre',
    resolveId(source, importer) {
      if (source === 'elkjs' || source.startsWith('elkjs/')) return VIRTUAL_ID;
      if (
        importer &&
        /[\\/]mermaid[\\/]dist[\\/]/.test(importer) &&
        /(?:^|[\\/])elk-[^\\/]+\.mjs$/.test(source)
      ) {
        return VIRTUAL_ID;
      }
      if (MERMAID_ELK_CHUNK.test(source)) return VIRTUAL_ID;
      return null;
    },
    load(id) {
      if (id === VIRTUAL_ID) {
        return [
          "export async function render() { throw new Error('ELK layout is disabled in this build (layout: dagre only).'); }",
          "export default class DisabledELK { constructor() { throw new Error('ELK layout is disabled in this build.'); } }",
          '',
        ].join('\n');
      }
      return null;
    },
  };
}

export default defineConfig({
  server: { host: '::', port: 8080 },
  plugins: [
    stripMermaidElk(),
    // The npm package is built from a placeholder config (scripts/cloudforge/pack.mjs); a normal
    // build reads ./wrangler.jsonc.
    cloudflare({ configPath: process.env.CLOUDFORGE_BUILD_CONFIG }),
    react(),
    licenseBanners(),
  ],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  // Keep dependencies' /*! … */ and @license comments; MIT/BSD notices must ship with the code.
  esbuild: { legalComments: 'inline' },
});
