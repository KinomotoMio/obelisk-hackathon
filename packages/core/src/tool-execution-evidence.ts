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

/** Keep complete command status envelopes when verbose stdout exceeds the index limit.
 * Output text is bounded across commands; status fields are never cut mid-JSON.
 * Small and unrecognized results retain their original representation.
 */
export function compactCommandOutput(content: string, limit = 10000): string {
  if (content.length <= limit) return content;
  const commands = commandEvidence('codex', 'exec', content);
  if (!commands.length) return content.slice(0, limit);
  const blocks = JSON.parse(content) as { type: string; text: string }[];
  const textBudget = Math.min(400, Math.floor(limit / 2 / commands.length));
  const compact = [blocks[0]];
  for (const block of blocks.slice(1)) {
    if (block?.type !== 'input_text' || typeof block.text !== 'string') continue;
    let value;
    try { value = JSON.parse(block.text); } catch { continue; }
    // Apply the same structural contract as the evidence reader.
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || typeof value.chunk_id !== 'string' || !Number.isFinite(value.wall_time_seconds)
      || !Number.isInteger(value.exit_code) || typeof value.output !== 'string') continue;
    compact.push({ type: 'input_text', text: JSON.stringify({
      chunk_id: value.chunk_id,
      wall_time_seconds: value.wall_time_seconds,
      exit_code: value.exit_code,
      output: value.output.length > textBudget ? `${value.output.slice(0, textBudget)}…[output truncated]` : value.output,
    }) });
  }
  compact.push({ type: 'input_text', text: '[Indexed command evidence only; full output remains in the native transcript.]' });
  return JSON.stringify(compact);
}
