import { apiFetch } from './api';

export interface DeployToken {
  id: string;
  name: string;
  scope: 'read' | 'write';
  createdById: string;
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string | null;
}

export interface DeployTokenInput {
  name: string;
  scope: DeployToken['scope'];
  expiresInDays: number;
}

export const deployTokenKeys = {
  list: (owner: string, repo: string) =>
    ['repo', owner, repo, 'deploy-tokens'] as const,
};

const path = (owner: string, repo: string, id?: string) =>
  `/api/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/deploy-tokens${
    id === undefined ? '' : `/${encodeURIComponent(id)}`
  }`;

export const deployTokensApi = {
  list: (owner: string, repo: string) =>
    apiFetch<DeployToken[]>(path(owner, repo), { cache: 'no-store' }),
  create: (owner: string, repo: string, json: DeployTokenInput) =>
    apiFetch<{ token: DeployToken; plaintext: string }>(path(owner, repo), {
      method: 'POST',
      json,
      cache: 'no-store',
    }),
  remove: (owner: string, repo: string, id: string) =>
    apiFetch<{ ok: true }>(path(owner, repo, id), { method: 'DELETE' }),
};
