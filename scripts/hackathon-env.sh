#!/bin/sh
# Set up (or refresh) an isolated environment for trying the hackathon build.
#
#   sh scripts/hackathon-env.sh          # build this checkout and (re)install the env
#   source ~/.obelisk-hackathon/env.sh   # enter it as role A (default)
#   source ~/.obelisk-hackathon/env.sh b # enter it as role B (a second user)
#
# Everything lives under ~/.obelisk-hackathon. An installed obelisk CLI,
# ~/.obelisk, and the installed Obelisk App are never touched. Each role has
# its own data directory, so its own index, Skill library and wallet.
set -e

REPO=$(cd "$(dirname "$0")/.." && pwd)
H="$HOME/.obelisk-hackathon"

cd "$REPO"
echo "== Building the CLI and skills from $REPO"
npm ci
npm run build:core
npm run build:cli
npm run build:skill
rm -rf dist/obelisk-skill-repo
bash packaging/stage-skill-repo.sh dist/obelisk-skill-repo

echo "== Installing App dependencies"
(cd app && npm ci)

mkdir -p "$H/bin" "$H/home" "$H/home-b" "$H/workspace/.claude/skills" "$H/workspace/.agents/skills"

cat > "$H/bin/obelisk" <<EOF
#!/bin/sh
# Obelisk hackathon build ($REPO), not an installed obelisk.
exec node "$REPO/packages/cli/dist/cli/src/obelisk.js" "\$@"
EOF
chmod +x "$H/bin/obelisk"

cat > "$H/env.sh" <<'EOF'
# source ~/.obelisk-hackathon/env.sh [a|b] [testnet|mainnet]
# Only this shell (and what it starts, e.g. claude or the App) uses the
# hackathon build and the role's own data directory. Open a new terminal to
# leave.
case "${2:-testnet}" in
  testnet) _obelisk_base="$HOME/.obelisk-hackathon"; export OBELISK_SERVICE_URL="https://obelisk-service.kinomotomiovo.workers.dev" ;;
  mainnet) _obelisk_base="$HOME/.obelisk-hackathon/mainnet"; export OBELISK_SERVICE_URL="https://obelisk-service-mainnet.kinomotomiovo.workers.dev" ;;
  *) echo "Expected network testnet or mainnet" >&2; return 1 ;;
esac
case "${1:-a}" in
  b|B) export OBELISK_HOME="$_obelisk_base/home-b"; _obelisk_role="hackathon:${2:-testnet}:b" ;;
  *)   export OBELISK_HOME="$_obelisk_base/home";   _obelisk_role="hackathon:${2:-testnet}:a" ;;
esac
case ":$PATH:" in
  *":$HOME/.obelisk-hackathon/bin:"*) ;;
  *) export PATH="$HOME/.obelisk-hackathon/bin:$PATH" ;;
esac
export OBELISK_HACKATHON=1
if [ -n "$ZSH_VERSION" ]; then
  PROMPT="[$_obelisk_role] ${PROMPT#\[hackathon*\] }"
else
  PS1="[$_obelisk_role] ${PS1#\[hackathon*\] }"
fi
unset _obelisk_role _obelisk_base
EOF

# Project-level skills, so neither ~/.claude nor ~/.codex is touched: Claude
# Code reads <project>/.claude/skills, Codex reads <project>/.agents/skills
# (the layout `npx skills add -a codex` uses for a project install).
echo "== Installing the Obelisk skills into $H/workspace for Claude Code and Codex"
for d in dist/obelisk-skill-repo/skills/*/; do
  name=$(basename "$d")
  for dir in "$H/workspace/.claude/skills" "$H/workspace/.agents/skills"; do
    rm -rf "$dir/$name"
    cp -R "$d" "$dir/$name"
  done
done
ls "$H/workspace/.agents/skills"

cat <<EOF

Done. Next:
  source ~/.obelisk-hackathon/env.sh   # role A; add "b" for role B
  obelisk --build                      # first time per role: index your history
  cd ~/.obelisk-hackathon/workspace && claude   # or: codex
EOF
