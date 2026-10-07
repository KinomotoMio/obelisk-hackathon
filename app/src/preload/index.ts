// Copyright (C) 2026 tommy0103 and contributors.
// SPDX-License-Identifier: AGPL-3.0-only

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type {
  SessionPatch,
  SessionPatchCursor,
  UsageStatsOptions,
} from '../shared/ipc-types.ts';

// Every call to the main process goes through invoke(), which counts calls in
// flight; headless capture (main/capture.ts) waits for them to settle.
let pendingInvokes = 0;
let invokesSettledAt = Date.now();
function invoke(channel: string, ...args: unknown[]) {
  pendingInvokes++;
  return ipcRenderer.invoke(channel, ...args).finally(() => {
    pendingInvokes--;
    invokesSettledAt = Date.now();
  });
}

contextBridge.exposeInMainWorld('obelisk', {
  captureState: () => ({ pending: pendingInvokes, settledAt: invokesSettledAt }),
  getSessions: (opts?: unknown) => invoke('db:getSessions', opts),
  getSessionsByIds: (ids: string[]) => invoke('db:getSessionsByIds', ids),
  getSessionMessages: (id: string) => invoke('db:getSessionMessages', id),
  getSessionToolCalls: (id: string) => invoke('db:getSessionToolCalls', id),
  getSessionToolResults: (id: string) => invoke('db:getSessionToolResults', id),
  getSessionPatch: (id: string, cursor: SessionPatchCursor): Promise<SessionPatch | null> => (
    invoke('db:getSessionPatch', id, cursor)
  ),
  getSessionSubagents: (id: string) => invoke('db:getSessionSubagents', id),
  getSessionWorkflows: (id: string) => invoke('db:getSessionWorkflows', id),
  getSubagentMessages: (agentId: string) => invoke('db:getSubagentMessages', agentId),
  getSubagentToolCalls: (agentId: string) => invoke('db:getSubagentToolCalls', agentId),
  getSubagentToolResults: (agentId: string) => invoke('db:getSubagentToolResults', agentId),
  getSessionSummaries: (id: string) => invoke('db:getSessionSummaries', id),
  getMessageFullText: (uuid: string) => invoke('db:getMessageFullText', uuid),
  getMemories: () => invoke('db:getMemories'),
  readMemoryFile: (path: string) => invoke('db:readMemoryFile', path),
  openFileReference: (ref: { sessionId?: string | null; path: string; cwd?: string | null; line?: number | null; column?: number | null }) =>
    invoke('file-ref:open', ref),
  archiveMemory: (id: string, reason?: string) => invoke('db:archiveMemory', id, reason),
  restoreMemory: (id: string) => invoke('db:restoreMemory', id),
  getProjects: () => invoke('db:getProjects'),
  getStats: () => invoke('db:getStats'),
  getUsageStats: (opts?: UsageStatsOptions) => invoke('db:getUsageStats', opts),
  onIndexUpdated: (callback: (payload: unknown) => void) => {
    const listener = (_: IpcRendererEvent, payload: unknown) => callback(payload);
    ipcRenderer.on('obelisk:index-updated', listener);
    return () => ipcRenderer.removeListener('obelisk:index-updated', listener);
  },
  onSessionUpdated: (callback: (payload: unknown) => void) => {
    const listener = (_: IpcRendererEvent, payload: unknown) => callback(payload);
    ipcRenderer.on('obelisk:session-updated', listener);
    return () => ipcRenderer.removeListener('obelisk:session-updated', listener);
  },
  captureExport: (opts?: unknown) => invoke('capture:export', opts),
  copyImage: (opts?: unknown) => invoke('capture:copy', opts),
  recapList: () => invoke('recap:list'),
  recapRead: (filename: string) => invoke('recap:read', filename),
  onRecapUpdated: (callback: (filePath: unknown) => void) => {
    const listener = (_: IpcRendererEvent, filePath: unknown) => callback(filePath);
    ipcRenderer.on('obelisk:recap-updated', listener);
    return () => ipcRenderer.removeListener('obelisk:recap-updated', listener);
  },
  skillsList: () => invoke('skills:list'),
  skillsGet: (name: string) => invoke('skills:get', name),
  skillsDescribeScenes: (tags: string[]) => invoke('skills:describe-scenes', tags),
  skillsChainDetail: (skillId: string) => invoke('skills:chain-detail', skillId),
  onSkillsUpdated: (callback: (filePath: unknown) => void) => {
    const listener = (_: IpcRendererEvent, filePath: unknown) => callback(filePath);
    ipcRenderer.on('obelisk:skills-updated', listener);
    return () => ipcRenderer.removeListener('obelisk:skills-updated', listener);
  },
  playgroundInfo: () => invoke('playground:info'),
  playgroundRuns: () => invoke('playground:runs'),
  playgroundRun: (runId: string) => invoke('playground:run', runId),
  playgroundScreenshot: (runId: string, file: string) => invoke('playground:screenshot', runId, file),
  playgroundSkillSources: (query: { chainId: number; skillId: string; name?: string | null; fingerprints?: string[] }) => (
    invoke('playground:skill-sources', query)
  ),
  playgroundRevealRecord: (runId: string) => invoke('playground:reveal-record', runId),
  sharesList: () => invoke('shares:list'),
  sharesRecipient: (address: string) => invoke('shares:recipient', address),
  onSharesUpdated: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on('obelisk:shares-updated', listener);
    return () => ipcRenderer.removeListener('obelisk:shares-updated', listener);
  },
  getSettings: () => invoke('settings:get'),
  browseFolder: () => invoke('settings:browseFolder'),
  setSetting: (key: string, value: unknown) => invoke('settings:set', key, value),
  revealPath: (p: string) => invoke('settings:revealPath', p),
  rebuildIndex: () => invoke('settings:rebuildIndex'),
});
