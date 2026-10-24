// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import type { MergeResolutionParams } from './workflow';

/** A landing retries the same Workflow id if starting it or acknowledging its start failed. */
export async function startLandingWorkflow(
  env: CloudflareBindings,
  id: string,
  params: MergeResolutionParams
): Promise<void> {
  try {
    await env.MERGE_RESOLUTION.create({ id, params });
  } catch (error) {
    // A duplicate create and an interrupted create response are both success only if the instance exists.
    try {
      await (await env.MERGE_RESOLUTION.get(id)).status();
      return;
    } catch {
      throw error;
    }
  }
}
