#!/bin/bash
# 服务器本地扫描并发布：scan_with_fallback（含 Cloudflare Cookie 兜底）→ 聚合校验 → 原子替换上线
set -uo pipefail
cd /opt/rivenroll/pipeline
DAY="${1:-$(TZ=Asia/Shanghai date +%F)}"
LOG="daily-$DAY.log"
echo "=== daily scan started $(date -Is) day=$DAY ===" >>"$LOG"

bash scan_with_fallback.sh >>"$LOG" 2>&1
N=$(ls "raw/$DAY/"*.json.gz 2>/dev/null | wc -l)
echo "scan exited, raw files: $N" >>"$LOG"
if [ "$N" -lt 400 ]; then
  echo "ABORT: incomplete scan ($N files)" >>"$LOG"
  exit 1
fi

OUT=/var/www/rivenroll/shared/data/market.json
TMP="${OUT%.json}.pending.json"
python3 -u wm_pipeline.py aggregate --config config.json --date "$DAY" --out "$TMP" >>"$LOG" 2>&1 \
  && python3 -c "
import json
d = json.load(open('$TMP'))
assert len(d['weapons']) >= 300, 'too few weapons'
assert d['meta']['scan_date'] == '$DAY'
print('validated:', len(d['weapons']), 'weapons')" >>"$LOG" 2>&1 \
  || { echo "ABORT: aggregate/validate failed" >>"$LOG"; rm -f "$TMP"; exit 1; }
mv "$TMP" "$OUT"
echo "published $(ls -l "$OUT") $(date -Is)" >>"$LOG"
echo "=== done $(date -Is) ===" >>"$LOG"
