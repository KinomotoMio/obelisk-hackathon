#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_DIR="${1:-}"
ARTIFACT_DIR="${2:-$ROOT_DIR/dist/obelisk-skill}"
# Standalone docs-only skills built next to the obelisk skill artifact.
STANDALONE_DIR="${3:-$(dirname "$ARTIFACT_DIR")/agent-skills}"

if [ -z "$TARGET_DIR" ]; then
  echo "Usage: packaging/stage-skill-repo.sh <target-repo> [skill-artifact] [standalone-skills-dir]" >&2
  exit 1
fi

if [ "$TARGET_DIR" = "/" ] || [ "$TARGET_DIR" = "." ] || [ "$TARGET_DIR" = "$ROOT_DIR" ]; then
  echo "Error: refusing to replace unsafe target directory: $TARGET_DIR" >&2
  exit 1
fi

for required in SKILL.md package.json references; do
  if [ ! -e "$ARTIFACT_DIR/$required" ]; then
    echo "Error: skill artifact missing $required at $ARTIFACT_DIR" >&2
    exit 1
  fi
done

STANDALONE_SKILLS=()
if [ -d "$STANDALONE_DIR" ]; then
  for skill in "$STANDALONE_DIR"/*/; do
    [ -f "$skill/SKILL.md" ] || continue
    name="$(basename "$skill")"
    if [ "$name" = "obelisk" ]; then
      echo "Error: standalone skill name collides with the obelisk skill: $skill" >&2
      exit 1
    fi
    STANDALONE_SKILLS+=("$name")
  done
fi

mkdir -p "$TARGET_DIR"
find "$TARGET_DIR" -mindepth 1 \
  ! -path "$TARGET_DIR/.git" \
  ! -path "$TARGET_DIR/.git/*" \
  -delete

mkdir -p "$TARGET_DIR/skills/obelisk"
cp -R "$ARTIFACT_DIR"/. "$TARGET_DIR/skills/obelisk/"
for name in "${STANDALONE_SKILLS[@]+"${STANDALONE_SKILLS[@]}"}"; do
  mkdir -p "$TARGET_DIR/skills/$name"
  cp -R "$STANDALONE_DIR/$name"/. "$TARGET_DIR/skills/$name/"
done
cp "$ROOT_DIR/packaging/skill-README.md" "$TARGET_DIR/README.md"
cp "$ROOT_DIR/packaging/skill-LICENSE" "$TARGET_DIR/LICENSE"
