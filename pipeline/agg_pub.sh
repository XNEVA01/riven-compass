#!/bin/bash
# 服务器端聚合并发布（供沙箱把 raw 传上来后调用）
set -euo pipefail
cd /opt/rivenroll/pipeline
DAY="$1"
OUT=/var/www/rivenroll/shared/data/market.json
TMP="${OUT%.json}.pending.json"
python3 -u wm_pipeline.py aggregate --config config.json --date "$DAY" --out "$TMP" >> "daily-$DAY.log" 2>&1
python3 -c "
import json
d = json.load(open('$TMP'))
assert len(d['weapons']) >= 300, 'too few weapons'
assert d['meta']['scan_date'] == '$DAY'
print('validated:', len(d['weapons']), 'weapons')" >> "daily-$DAY.log" 2>&1
mv "$TMP" "$OUT"
echo "published $(ls -l "$OUT") $(date -Is)" >> "daily-$DAY.log"
