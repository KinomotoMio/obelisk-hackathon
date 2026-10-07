// Copyright (C) 2026 tommy0103 and contributors.
// SPDX-License-Identifier: AGPL-3.0-only

// Sent-share reads for the Share tab (#12). The CLI writes a record for each
// share it sends; the main process lists them with each share's state from
// the online service (shares:list) and announces new records
// (onSharesUpdated). Opens and expiry happen on chain, not in those files, so
// the Share tab also reloads on a timer while it is shown.

import { reactive } from 'vue';

export const shareState = reactive({
  shares: [],
  network: null,
  loaded: false,
  loading: false,
  /** The listing itself failed (unreadable records, no service configured). */
  error: null,
  /** When the last listing finished, for "updated at". */
  refreshedAt: null,
});

let listRequest = 0;

function errorMessage(error) {
  // ipcRenderer.invoke prefixes the main-process message; keep only the cause.
  return String(error?.message || error).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');
}

/** Reload the sent shares. Overlapping reloads keep the latest. */
export async function loadShares() {
  const request = ++listRequest;
  if (!window.obelisk?.sharesList) {
    shareState.loaded = true;
    return;
  }
  shareState.loading = true;
  try {
    const result = await window.obelisk.sharesList();
    if (request !== listRequest) return;
    shareState.shares = result.shares;
    shareState.network = result.network;
    shareState.error = null;
    shareState.refreshedAt = new Date().toISOString();
  } catch (error) {
    if (request !== listRequest) return;
    shareState.error = errorMessage(error);
  } finally {
    if (request === listRequest) {
      shareState.loaded = true;
      shareState.loading = false;
    }
  }
}

/** Whether a recipient has activated a wallet: activated | not_activated | invalid | unreachable. */
export async function recipientStatus(address) {
  if (!window.obelisk?.sharesRecipient) return { status: 'unreachable', error: null };
  try {
    return await window.obelisk.sharesRecipient(address);
  } catch (error) {
    return { status: 'unreachable', error: errorMessage(error) };
  }
}
