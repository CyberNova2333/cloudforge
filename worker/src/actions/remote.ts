// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { parse as parseYaml } from 'yaml';
import { parseStep, type StepDef } from './workflow-file';

/**
 * Actions that aren't built in (executor.ts implements actions/checkout, setup-node, cache, upload-artifact,
 * download-artifact and cloudforge/relevance itself): a JavaScript or composite action from GitHub
 * (`owner/repo[/path]@ref`), or one in the repository itself (`./path`). The worker reads its action.yml; the
 * runner downloads its code and runs it, the way GitHub's runner does. Docker actions can't run: the job
 * container has no Docker.
 */

export const BUILTIN_ACTIONS = new Set([
  'actions/checkout',
  'actions/setup-node',
  'actions/cache',
  'actions/upload-artifact',
  'actions/download-artifact',
  'cloudforge/relevance',
]);

export type ActionRef =
  | {
      kind: 'github';
      owner: string;
      repo: string;
      /** Sub-directory holding action.yml ('' for the repository root). */
      path: string;
      ref: string;
    }
  | { kind: 'local'; path: string };

export class ActionError extends Error {}

const NAME = /^[A-Za-z0-9_.-]+$/;

/** Where `uses:` points; null for a built-in action. Throws ActionError for what can't run here. */
export function parseUses(uses: string): ActionRef | null {
  const u = uses.trim();
  if (u.startsWith('docker://'))
    throw new ActionError(
      `\`uses: ${u}\`: Docker images can't run on CloudForge runners (the job container has no Docker).`
    );
  if (u.startsWith('./')) {
    const parts = u
      .slice(2)
      .split('/')
      .filter((p) => p && p !== '.');
    if (!parts.length || parts.some((p) => p === '..' || !NAME.test(p)))
      throw new ActionError(
        `\`uses: ${u}\` is not a path inside the repository.`
      );
    return { kind: 'local', path: parts.join('/') };
  }
  const at = u.lastIndexOf('@');
  if (at < 0)
    throw new ActionError(
      `\`uses: ${u}\` needs a version, like owner/repo@v1.`
    );
  const ref = u.slice(at + 1);
  const [owner, repo, ...rest] = u.slice(0, at).split('/');
  if (
    !owner ||
    !repo ||
    ![owner, repo, ...rest].every((p) => NAME.test(p) && p !== '..') ||
    !/^[A-Za-z0-9_.\/-]+$/.test(ref) ||
    ref.includes('..')
  )
    throw new ActionError(
      `\`uses: ${u}\` is not an action reference (owner/repo[/path]@ref).`
    );
  if (!rest.length && BUILTIN_ACTIONS.has(`${owner}/${repo}`)) return null;
  return { kind: 'github', owner, repo, path: rest.join('/'), ref };
}

/** How `uses:` names the action in logs. */
export const refLabel = (r: ActionRef) =>
  r.kind === 'local'
    ? `./${r.path}`
    : `${r.owner}/${r.repo}${r.path ? `/${r.path}` : ''}@${r.ref}`;

export interface ActionInput {
  default?: string;
  required: boolean;
}

export type ActionMeta =
  | {
      using: 'node';
      name: string;
      main: string;
      pre?: string;
      post?: string;
      /** When the post phase runs (`post-if`); GitHub's default is always(). */
      postIf: string;
      inputs: Record<string, ActionInput>;
    }
  | {
      using: 'composite';
      name: string;
      inputs: Record<string, ActionInput>;
      /** Output name → its `value` expression over the composite's own steps. */
      outputs: Record<string, string>;
      steps: StepDef[];
    };

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown) =>
  v === undefined || v === null ? undefined : String(v);

/** Reads an action.yml. `label` names it in errors. Throws ActionError. */
export function parseActionYaml(text: string, label: string): ActionMeta {
  let doc: unknown;
  try {
    doc = parseYaml(text);
  } catch (e) {
    throw new ActionError(
      `${label}: action.yml is not valid YAML (${e instanceof Error ? e.message : String(e)}).`
    );
  }
  if (!isObj(doc) || !isObj(doc.runs))
    throw new ActionError(`${label}: action.yml has no \`runs\`.`);
  const runs = doc.runs;
  const using = String(runs.using ?? '');
  const inputs: Record<string, ActionInput> = {};
  if (isObj(doc.inputs))
    for (const [k, v] of Object.entries(doc.inputs)) {
      const d = isObj(v) ? v : {};
      inputs[k] = {
        default: str(d.default),
        required: d.required === true || d.required === 'true',
      };
    }
  const name = str(doc.name) ?? label;
  if (/^node\d+$/.test(using)) {
    const main = str(runs.main);
    if (!main) throw new ActionError(`${label}: action.yml has no runs.main.`);
    return {
      using: 'node',
      name,
      main,
      pre: str(runs.pre),
      post: str(runs.post),
      postIf: str(runs['post-if']) ?? 'always()',
      inputs,
    };
  }
  if (using === 'composite') {
    if (!Array.isArray(runs.steps) || !runs.steps.length)
      throw new ActionError(`${label}: a composite action needs runs.steps.`);
    const outputs: Record<string, string> = {};
    if (isObj(doc.outputs))
      for (const [k, v] of Object.entries(doc.outputs))
        if (isObj(v) && v.value !== undefined) outputs[k] = String(v.value);
    return {
      using: 'composite',
      name,
      inputs,
      outputs,
      steps: runs.steps.map((st, i) =>
        parseStep(st, `${label} runs.steps[${i}]`)
      ),
    };
  }
  if (using === 'docker')
    throw new ActionError(
      `${label} is a Docker action: it can't run on CloudForge runners (the job container has no Docker). Use a JavaScript or composite action, or a \`run:\` step.`
    );
  throw new ActionError(`${label}: runs.using "${using}" is not supported.`);
}

/** action.yml (or action.yaml) of a GitHub action, from raw.githubusercontent.com. Throws ActionError. */
export async function fetchGithubActionYaml(
  r: Extract<ActionRef, { kind: 'github' }>,
  fetchFn: typeof fetch = fetch
): Promise<string> {
  const dir = r.path ? `${r.path}/` : '';
  for (const file of ['action.yml', 'action.yaml']) {
    const url = `https://raw.githubusercontent.com/${r.owner}/${r.repo}/${r.ref}/${dir}${file}`;
    let res: Response;
    try {
      res = await fetchFn(url, {
        headers: { 'User-Agent': 'CloudForge-Actions' },
      });
    } catch (e) {
      throw new ActionError(
        `Could not reach GitHub for ${refLabel(r)}: ${e instanceof Error ? e.message : String(e)}`
      );
    }
    if (res.ok) return res.text();
    if (res.status !== 404)
      throw new ActionError(
        `GitHub answered ${res.status} for ${refLabel(r)}'s action.yml.`
      );
  }
  throw new ActionError(
    `${refLabel(r)} was not found on GitHub (no action.yml at that ref).`
  );
}

/** Where the runner keeps a downloaded GitHub action (one copy per job, reused by its post step). */
export const ACTIONS_DIR = '/opt/cloudforge/actions';
/** Toolchains the setup-* actions install (RUNNER_TOOL_CACHE). */
export const TOOL_CACHE = '/opt/hostedtoolcache';

const quoteSh = (t: string) => `'${t.replace(/'/g, `'\\''`)}'`;

/** Keep ordinary refs stable; encode separators without aliasing literal underscores. */
function githubActionRoot(r: Extract<ActionRef, { kind: 'github' }>): string {
  const revision = encodeURIComponent(r.ref).replace(/^\.$/, '%2E');
  return `${ACTIONS_DIR}/${r.owner}/${r.repo}/${revision}`;
}

/** The directory the action's code is in on the runner (GITHUB_ACTION_PATH). */
export function actionDir(r: ActionRef, workspace: string): string {
  if (r.kind === 'local') return `${workspace}/${r.path}`;
  const root = githubActionRoot(r);
  return r.path ? `${root}/${r.path}` : root;
}

/**
 * Shell lines that make the action's code available: a GitHub action is downloaded (once per job) from
 * codeload.github.com; a local one must have been checked out by an earlier step, as on GitHub.
 */
export function fetchScript(r: ActionRef, workspace: string): string {
  if (r.kind === 'local')
    return `[ -d ${quoteSh(actionDir(r, workspace))} ] || { echo ${quoteSh(`./${r.path} is not in the workspace: check out the repository (actions/checkout) before using a local action.`)}; exit 1; }`;
  const root = githubActionRoot(r);
  const url = `https://codeload.github.com/${r.owner}/${r.repo}/tar.gz/${r.ref}`;
  return [
    `if [ ! -f ${quoteSh(`${root}/.cloudforge-ready`)} ]; then`,
    `  echo ${quoteSh(`Download action repository '${r.owner}/${r.repo}@${r.ref}'`)}`,
    `  mkdir -p ${quoteSh(root)}`,
    `  curl -fsSL --retry 3 ${quoteSh(url)} | tar -xz --strip-components=1 -C ${quoteSh(root)}`,
    `  touch ${quoteSh(`${root}/.cloudforge-ready`)}`,
    `fi`,
  ].join('\n');
}

/** GitHub's INPUT_<NAME> variable for an input: upper-cased, spaces as underscores. */
export const inputVar = (name: string) =>
  `INPUT_${name.replace(/ /g, '_').toUpperCase()}`;

/** Shell that runs one of a JavaScript action's entry points (main, pre or post) with the image's Node.js. */
export function nodeScript(
  r: ActionRef,
  workspace: string,
  entry: string
): string {
  return [
    'set -e',
    fetchScript(r, workspace),
    `mkdir -p ${quoteSh(TOOL_CACHE)} "$RUNNER_TEMP"`,
    `node ${quoteSh(`${actionDir(r, workspace)}/${entry}`)}`,
  ].join('\n');
}
