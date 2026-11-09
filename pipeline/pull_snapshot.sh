#!/bin/bash
# 从 GitHub Actions 发布的每日快照 tag 拉取 market.json，校验后原子替换线上文件。
# 快照由 GitHub Actions 每天 03:20(北京) 开扫，约 06:40-07:10 完成并打 tag snap-YYYY-MM-DD；
# 本脚本每天 07:05 由 cron 启动，tag 还没出来就隔 SLEEP 秒再试，最多 ATTEMPTS 次。
# 手动补发：bash pull_snapshot.sh 2026-11-09
set -uo pipefail
cd /opt/rivenroll/pipeline

DAY="${1:-$(TZ=Asia/Shanghai date +%F)}"
ATTEMPTS="${ATTEMPTS:-8}"
SLEEP="${SLEEP:-900}"
LOG="pull-${DAY}.log"
OUT=/var/www/rivenroll/shared/data/market.json
TMP="${OUT%.json}.pending.json"
URLS=(
  "https://fastly.jsdelivr.net/gh/XNEVA01/riven-compass@snap-${DAY}/market.json"
  "https://cdn.jsdelivr.net/gh/XNEVA01/riven-compass@snap-${DAY}/market.json"
)

echo "=== pull started $(date -Is) day=${DAY} ===" >>"$LOG"
ok=0
for i in $(seq 1 "$ATTEMPTS"); do
  for u in "${URLS[@]}"; do
    if curl -fsSL --max-time 120 -o "$TMP" "$u" 2>>"$LOG"; then
      W=$(python3 -c "import json;d=json.load(open('$TMP'));print(len(d['weapons']), d['meta'].get('scan_date'))" 2>>"$LOG") || { echo "parse fail $u $(date -Is)" >>"$LOG"; continue; }
      WN=${W%% *}
      SD=${W#* }
      echo "attempt $i: $WN weapons scan_date=$SD ($u) $(date -Is)" >>"$LOG"
      if [ "$WN" -ge 300 ] && [ "$SD" = "$DAY" ]; then
        mv "$TMP" "$OUT"
        echo "published: $(ls -l "$OUT")" >>"$LOG"
        ok=1
        break 2
      fi
    else
      echo "attempt $i: fetch fail $u $(date -Is)" >>"$LOG"
    fi
  done
  [ "$ok" = 1 ] && break
  [ "$i" -lt "$ATTEMPTS" ] && sleep "$SLEEP"
done

if [ "$ok" != 1 ]; then
  echo "ABORT: no valid snapshot for $DAY, keeping the live one" >>"$LOG"
  rm -f "$TMP"
  exit 1
fi
echo "=== done $(date -Is) ===" >>"$LOG"
