# Codex apply_patch fixture

`codex-apply-patch.jsonl` is a minimal excerpt of a real Codex rollout captured
on 2026-09-06: session metadata, a `custom_tool_call`, and its matching
`custom_tool_call_output`. Event types, timestamps, call status, patch line
boundaries and markers retain their captured shape. IDs and paths were replaced,
patch prose was masked, and the result text was sanitized. Unrelated events and
private session metadata were omitted. No production transcript is read by tests.

The larger patch in the regression test is deliberately generated stress data;
it is not presented as a captured transcript.

# Codex Skill load fixture

`codex/skill-load-rollout.jsonl` is an excerpt of a real Codex CLI 0.160.0
rollout captured on 2026-10-07 by running `codex exec '$fingerprint-probe'` in a
project whose `.agents/skills/` contained only
`claude/skills/fingerprint-probe/SKILL.md`. It keeps the user's `$` mention, the
`<skill>` message Codex injected with the full SKILL.md, and the reply, byte for
byte except the capture directory, rewritten to `/tmp/fp-probe`. The session
metadata line keeps only `id`, `timestamp`, `cwd`, `originator`, `cli_version`,
and `source`; private instructions and unrelated events were omitted. It pins
the Codex half of the Skill version fingerprint contract
(`packages/core/src/skills.ts`).
