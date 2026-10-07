// Copyright (C) 2026 tommy0103 and contributors.
// SPDX-License-Identifier: AGPL-3.0-only

/** Command status printed by the Codex exec wrapper; never inferred from stdout. */
export interface CommandEvidence {
  exitCode: number;
  output: string;
}

export function commandEvidence(source: string | null, tool: string | null, content: string): CommandEvidence[] {
  if (source !== 'codex' || !['exec', 'functions.exec'].includes(tool ?? '')) return [];
  try {
    const blocks: unknown = JSON.parse(content);
    if (!Array.isArray(blocks) || !blocks.length) return [];
    const header = blocks[0];
    if (header?.type !== 'input_text' || typeof header.text !== 'string'
      || !/^Script completed\nWall time [\d.]+ seconds\nOutput:\n$/.test(header.text)) return [];
    const result: CommandEvidence[] = [];
    for (const block of blocks.slice(1)) {
      if (block?.type !== 'input_text' || typeof block.text !== 'string') continue;
      let value;
      try { value = JSON.parse(block.text); } catch { continue; }
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      if (typeof value.chunk_id !== 'string' || !Number.isFinite(value.wall_time_seconds)
        || !Number.isInteger(value.exit_code) || typeof value.output !== 'string') continue;
      // Do not recursively inspect output: a command can print arbitrary JSON.
      result.push({ exitCode: value.exit_code, output: value.output });
    }
    return result;
  } catch { return []; }
}
