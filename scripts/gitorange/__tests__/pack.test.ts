// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSE).
import { describe, expect, it } from 'vitest';
import { npmManifest } from '../pack.mjs';

describe('npmManifest：软件包清单', () => {
  it('描述发布的软件包', () => {
    expect(
      npmManifest({
        version: '1.0.0',
        commit: 'abc',
        wranglerVersion: '4.146.0',
      })
    ).toEqual({
      name: '@cybernova2333/cloudforge',
      version: '1.0.0',
      description:
        'Install, upgrade and adopt a CloudForge deployment on Cloudflare.',
      license: 'GPL-3.0-or-later',
      type: 'module',
      bin: { cloudforge: 'bin/cloudforge.js' },
      engines: { node: '>=22.0.0' },
      dependencies: { wrangler: '4.146.0' },
      cloudforgeCommit: 'abc',
      repository: {
        type: 'git',
        url: 'git+https://cnb.cool/CyberNova2333/cloudforge.git',
      },
      files: [
        'bin',
        'worker',
        'client',
        'migrations',
        'actions',
        'wrangler.jsonc.example',
        'README.md',
        'LICENSE',
        'COPYING',
      ],
    });
  });
});
