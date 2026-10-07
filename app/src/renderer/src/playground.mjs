// Copyright (C) 2026 tommy0103 and contributors.
// SPDX-License-Identifier: AGPL-3.0-only

// Display helpers for the 「来源：Playground」 marks (#32). The records are read
// and checked by the main process (app/src/main/playground-runs.ts); a run
// itself is shown on the web (/runs/<id> on the online service).

/** A running run with no new record or event for this long may have stopped. */
export const QUIET_MS = 120_000;

const RUN_STATUS = {
  running: { label: '运行中', tone: 'live' },
  succeeded: { label: '已完成', tone: 'ok' },
  failed: { label: '失败', tone: 'danger' },
  aborted: { label: '已中止', tone: 'warn' },
};

/**
 * The status pill of a run. A running run that has gone quiet says so rather
 * than claiming it is still running.
 */
export function runStatus(record, updatedAt, now = Date.now()) {
  const status = RUN_STATUS[record.run.status] ?? { label: record.run.status, tone: 'dim' };
  if (record.run.status === 'running' && updatedAt && now - updatedAt > QUIET_MS) {
    return { key: 'quiet', label: `${Math.floor((now - updatedAt) / 60_000)} 分钟没有新动静`, tone: 'warn' };
  }
  return { key: record.run.status, ...status };
}

/** The runs behind a Skill for its 「来源：Playground」 note. */
export function sourceSummary(sources) {
  const mintedBy = [...new Set(sources.flatMap(source => source.mintedBy))];
  return {
    runs: sources.length,
    mintedBy,
    roles: sources.reduce((sum, source) => sum + source.roles, 0),
    sessions: sources.reduce((sum, source) => sum + source.sessions, 0),
  };
}
