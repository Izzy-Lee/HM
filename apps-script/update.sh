#!/bin/bash
# ──────────────────────────────────────────────────────────────
#  헬로미추 Apps Script 자동 배포
#
#  최신 코드를 GitHub 에서 내려받아 → 구글에 올리고 → 새 버전으로 배포한다.
#  편집기에 붙여넣거나 [배포 관리] 를 누를 필요가 없다.
#
#  쓰는 법:  ./update.sh
#  준비:     같은 폴더에 .clasp.json 이 있어야 한다 (clasp clone 으로 생긴다)
#            배포 ID 는 아래 DEPLOY_ID 에 적어두거나 인자로 넘긴다
# ──────────────────────────────────────────────────────────────
set -e

# 배포 ID — clasp deployments 로 확인해서 여기에 붙여넣으세요 (AKfycb... 로 시작)
DEPLOY_ID="${1:-${HM_DEPLOY_ID:-}}"

RAW="https://raw.githubusercontent.com/Izzy-Lee/HM/main/apps-script"

echo "▶ 최신 코드 내려받는 중..."
curl -fsSL "$RAW/Code.gs"          -o Code.js
curl -fsSL "$RAW/slot-capacity.gs" -o slot-capacity.js
echo "  받았습니다."

echo "▶ 구글에 올리는 중..."
clasp push -f

if [ -z "$DEPLOY_ID" ]; then
  echo ""
  echo "⚠ 배포 ID가 없어서 코드만 올렸습니다. 아직 사이트에는 반영되지 않았습니다."
  echo "  아래 목록에서 배포 ID(AKfycb...)를 찾아 이 파일의 DEPLOY_ID 에 적어주세요."
  echo ""
  clasp deployments
  exit 0
fi

echo "▶ 새 버전으로 배포하는 중..."
clasp deploy -i "$DEPLOY_ID" -d "$(date '+%Y-%m-%d %H:%M') 업데이트"

echo ""
echo "✅ 배포 완료. 잠시 뒤 아래 주소에서 확인하세요."
echo "   https://script.google.com/macros/s/$DEPLOY_ID/exec"
