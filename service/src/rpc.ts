// Copyright (C) 2026 tommy0103 and contributors.
// SPDX-License-Identifier: AGPL-3.0-only

// The JSON-RPC transport for one Worker request.
//
// Concurrent reads go out as one JSON-RPC batch: a usage or lineage read makes
// dozens of view calls, and each HTTP request counts against the Worker's
// subrequest limit. BOT Chain's RPC accepts batches.
//
// viem queues batched calls in a module-level map keyed by the RPC URL (and
// the request's abort signal), so without a signal of their own, requests the
// Worker serves at the same time in one isolate would join the same batch:
// one request's fetch would answer another's calls, and the runtime cancels
// the waiting request as hung ("Worker's code had hung"). A signal per
// transport gives each Worker request its own queue.

import { http, type HttpTransportConfig, type Transport } from 'viem';

export function requestScopedHttp(url: string, config: HttpTransportConfig = {}): Transport {
  const transport = http(url, { ...config, batch: config.batch ?? { batchSize: 100, wait: 0 } });
  const signal = new AbortController().signal;
  return (args) => {
    const inner = transport(args);
    const request: typeof inner.request = (body, options) => inner.request(body, { ...options, signal: options?.signal ?? signal });
    return { ...inner, request };
  };
}
