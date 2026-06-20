#!/usr/bin/env bash
# TokenLift 설치 스크립트 (macOS / Linux)
# - tokenlift CLI 전역 등록(npm link, 실패 허용)
# - 스킬/서브에이전트를 ~/.claude 로 배포(기존 파일 백업)
# - 환경 점검 및 훅 등록 안내
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CLAUDE_HOME="$HOME/.claude"
SKILLS_DIR="$CLAUDE_HOME/skills"
AGENTS_DIR="$CLAUDE_HOME/agents"
# 백업은 skills/agents 스캔 범위 "밖"에 둔다.
# (skills/ 안에 *.bak 디렉토리를 두면 그 안의 SKILL.md 때문에 중복 스킬로 인식됨)
BACKUP_DIR="$CLAUDE_HOME/.tokenlift-backup"

echo "== TokenLift 설치 =="
echo "저장소: $REPO_ROOT"

# 사용법: backup_if_exists <원본경로> <백업이름>
backup_if_exists() {
  if [ -e "$1" ]; then
    mkdir -p "$BACKUP_DIR"
    local dest="$BACKUP_DIR/$2"
    echo "  기존 항목 백업: $dest"
    rm -rf "$dest"
    cp -r "$1" "$dest"
  fi
}

mkdir -p "$SKILLS_DIR" "$AGENTS_DIR"

# 2) 스킬 배포
SKILL_DST="$SKILLS_DIR/tokenlift"
backup_if_exists "$SKILL_DST" "skills-tokenlift"
rm -rf "$SKILL_DST"
cp -r "$REPO_ROOT/skills/tokenlift" "$SKILL_DST"
echo "  스킬 배포 완료 → $SKILL_DST"

# 3) 서브에이전트 배포 (agents/*.md 전체)
for agent_src in "$REPO_ROOT"/agents/*.md; do
  agent_name="$(basename "$agent_src")"
  agent_dst="$AGENTS_DIR/$agent_name"
  backup_if_exists "$agent_dst" "$agent_name"
  cp "$agent_src" "$agent_dst"
  echo "  서브에이전트 배포 완료 → $agent_dst"
done

# 4) CLI 전역 등록 (실패해도 계속)
echo ""
echo "== tokenlift 전역 명령 등록(npm link) =="
if (cd "$REPO_ROOT" && npm link); then
  echo "  npm link 완료. 'tokenlift' 명령 사용 가능."
else
  echo "  npm link 실패(권한/환경). 대신 직접 실행하세요:"
  echo "    node \"$REPO_ROOT/bin/tokenlift.mjs\" <command>"
fi

# 5) 환경 점검
echo ""
echo "== 환경 점검(doctor) =="
node "$REPO_ROOT/bin/tokenlift.mjs" doctor || true

# 6) 훅 등록 안내(선택)
HOOK_PATH="$REPO_ROOT/hooks/suggest-delegation.mjs"
echo ""
echo "== (선택) 자동 감지 훅 등록 =="
echo "~/.claude/settings.json 의 hooks.UserPromptSubmit 에 추가:"
cat <<EOF
  {
    "hooks": {
      "UserPromptSubmit": [
        { "hooks": [ { "type": "command",
          "command": "node \"$HOOK_PATH\"" } ] }
      ]
    }
  }
EOF

echo ""
echo "설치 완료."
