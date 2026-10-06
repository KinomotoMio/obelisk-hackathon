# Claude Code fixtures

`custom-title-session.jsonl` is an excerpt of a real Claude Code 2.1.260
session captured on 2026-09-15 via:

    CLAUDE_CONFIG_DIR=<isolated dir> claude -p -n "obelisk fixture capture" "Reply with exactly: ok"

Every line is byte-for-byte as written by Claude Code: the `custom-title`
and `agent-name` records it writes at session start when `-n` assigns a
display name, plus the first real user message. The capture's attachment,
queue-operation, and synthetic error-message records were dropped as
parser-irrelevant noise; no retained line was edited.

The provider consumes `custom-title` and ignores `agent-name`; both are
kept to document what real transcripts carry.

`skill-load-session.jsonl` holds the two records Claude Code 2.1.289 wrote
when it loaded `skills/fingerprint-probe/SKILL.md` (copied here unchanged),
captured on 2026-10-07 from a project whose `.claude/skills/` contained only
that Skill:

    claude -p --model haiku "/fingerprint-probe"
    claude -p --model haiku 'Use the Skill tool to run the fingerprint-probe skill with args "alpha beta".'

The first record is the slash-command load, the second the Skill-tool load
with arguments (Claude Code appends `ARGUMENTS: alpha beta`). Only the
capture directory was rewritten to `/tmp/fp-probe`; everything else is
byte-for-byte. They pin the Skill version fingerprint contract
(`packages/core/src/skills.ts`).

`long-skill-load-session.jsonl` is the record Claude Code 2.1.289 wrote when
`claude -p --model haiku "/long-probe"` loaded `skills/long-probe/SKILL.md`
(copied here unchanged), captured on 2026-10-07. The body is longer than the
10,000 characters the index keeps, so it pins recovering truncated Skill loads
from the source record (#22). Only the capture directory was rewritten to
`/tmp/long-probe`.
