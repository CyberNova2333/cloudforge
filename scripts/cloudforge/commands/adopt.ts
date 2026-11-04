// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
// `cloudforge adopt --from <checkout>` (spec §7): moves an install made from a git checkout into the
// package's home (<home>/<slug>/) so `npx @cybernova2333/cloudforge upgrade` can manage it. Files only: no
// Cloudflare call, no deploy.
import { randomUUID } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fstatSync,
  linkSync,
  lstatSync,
  openSync,
  readFileSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import type { Io } from '../ui/collect.ts';
import { installDir } from '../installation/home.ts';
import { UsageError } from './status.ts';
import {
  acquireLock,
  listStates,
  readState,
  statePath,
  writeState,
  type InstallState,
} from '../installation/state.ts';

/** Publish a complete file without replacing any entry, including a dangling symlink. */
function createAdoptionFile(path: string, data: Buffer): () => void {
  const temporary = `${path}.adopt-${randomUUID()}.tmp`;
  const fd = openSync(temporary, 'wx', 0o600);
  let closeAttempted = false;
  try {
    writeFileSync(fd, data);
    const owned = fstatSync(fd);
    // A close error must occur before publication, while rollback is still unnecessary.
    closeAttempted = true;
    closeSync(fd);
    linkSync(temporary, path);
    return () => {
      try {
        const current = lstatSync(path);
        // Retain replacements or edits observed before rollback. Uncooperative writers
        // can still race the final check/unlink; they must honor the installation lock.
        if (
          current.isFile() &&
          current.dev === owned.dev &&
          current.ino === owned.ino &&
          readFileSync(path).equals(data)
        )
          unlinkSync(path);
      } catch {
        // Preserve unconfirmed files for inspection; never recursively clean the directory.
      }
    };
  } finally {
    if (!closeAttempted) {
      try {
        closeSync(fd);
      } catch {
        // Preserve the write/stat failure that brought us here.
      }
    }
    try {
      unlinkSync(temporary);
    } catch {
      // Retain this private recovery file if cleanup fails. Never discard the
      // published file's undo function or replace the original operation error.
    }
  }
}

/** The state `adopt` moves: the one called `name`, or the only one recorded in the checkout. */
export function pickCheckoutState(
  checkout: string,
  name: string | undefined
): InstallState {
  const dir = join(checkout, '.cloudforge');
  const all = listStates(dir);
  if (name !== undefined) {
    const hit = all.find((s) => s.inputs.name === name);
    if (!hit) {
      throw new UsageError(`No cloudforge install named ${name} in ${dir}.`);
    }
    return hit;
  }
  if (all.length === 0) {
    throw new UsageError(`No cloudforge install in ${dir}.`);
  }
  if (all.length > 1) {
    throw new UsageError(
      `Several installs in ${dir}: ${all.map((s) => s.inputs.name).join(', ')}. Pass --name.`
    );
  }
  return all[0]!;
}

export async function adoptFromCheckout(o: {
  checkout: string;
  home: string;
  name?: string;
  io: Io;
  now(): Date;
}): Promise<{ slug: string; dir: string }> {
  const checkoutDir = join(o.checkout, '.cloudforge');
  const picked = pickCheckoutState(o.checkout, o.name);
  const slug = picked.names.worker;
  const dir = installDir(o.home, slug);
  const configFrom = join(o.checkout, 'wrangler.jsonc');
  const configTo = join(dir, 'wrangler.jsonc');

  const releaseSource = acquireLock(checkoutDir, picked.installationId);
  let releaseDest: (() => void) | undefined;
  const dirExisted = existsSync(dir);
  let undoState: (() => void) | undefined;
  let undoConfig: (() => void) | undefined;
  try {
    // Read again under the lock: another run may have changed it since it was picked.
    const s = readState(checkoutDir, picked.installationId);
    if (!s) throw new Error(`The install ${slug} is gone from ${checkoutDir}.`);
    if (s.movedTo !== undefined) {
      throw new Error(`This install already moved to ${s.movedTo}.`);
    }
    if (!existsSync(configFrom)) {
      throw new Error(`${configFrom} is missing: nothing to adopt.`);
    }
    releaseDest = acquireLock(dir, s.installationId);
    if (
      existsSync(statePath(dir, s.installationId)) ||
      listStates(dir).length > 0
    ) {
      throw new Error(`${dir} already has an install.`);
    }

    // Config first, then state (a state file is what makes the directory an install), the
    // checkout's marker last.
    try {
      undoConfig = createAdoptionFile(configTo, readFileSync(configFrom));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST')
        throw new Error(
          `${configTo} already exists; preserve or relocate it before adoption.`
        );
      throw error;
    }
    undoState = createAdoptionFile(
      statePath(dir, s.installationId),
      Buffer.from(
        `${JSON.stringify({ ...s, adoptedAt: o.now().toISOString() }, null, 2)}\n`
      )
    );
    writeState(checkoutDir, { ...s, movedTo: dir });
  } catch (e) {
    undoState?.();
    undoConfig?.();
    releaseDest?.();
    releaseDest = undefined;
    if (!dirExisted) {
      try {
        rmdirSync(dir); // Only an empty directory can be removed.
      } catch {
        // A concurrent writer or retained recovery file owns the remaining entries.
      }
    }
    throw e;
  } finally {
    releaseDest?.();
    releaseSource();
  }
  return { slug, dir };
}
