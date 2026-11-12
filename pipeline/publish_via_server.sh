#!/bin/bash
# 沙箱扫描 → raw 传服务器 → 服务器聚合发布（完全绕开 Cloudflare 挑战与 GitHub）
# 用法：bash publish_via_server.sh 2026-11-12
DATE="${1:?usage: publish_via_server.sh YYYY-MM-DD}"
cd /workspace/pipeline-run
SCAN_LOG="scan-$DATE.log"
LOG="watch-$DATE.log"
echo "watcher started $(date -Is)" >>"$LOG"

# 等扫描结束（scan 结束时会追加 exit 标记；被强杀无标记则一直等）
while ! grep -q "scan exit=" "$SCAN_LOG" 2>/dev/null; do sleep 30; done
echo "scan finished $(date -Is)" >>"$LOG"

N=$(ls "raw/$DATE/"*.json.gz 2>/dev/null | wc -l)
echo "raw files: $N" >>"$LOG"
if [ "$N" -lt 400 ]; then echo "ABORT: incomplete scan ($N files)" >>"$LOG"; exit 1; fi

ssh -F /workspace/.ssh/config riven "mkdir -p /opt/rivenroll/pipeline/raw/$DATE"
echo "transferring $N files $(date -Is)" >>"$LOG"
scp -F /workspace/.ssh/config "raw/$DATE/"*.json.gz "riven:/opt/rivenroll/pipeline/raw/$DATE/" >>"$LOG" 2>&1 \
  || { echo "ABORT: scp failed" >>"$LOG"; exit 1; }
echo "transfer done $(date -Is)" >>"$LOG"

ssh -F /workspace/.ssh/config riven "bash /opt/rivenroll/pipeline/agg_pub.sh $DATE" >>"$LOG" 2>&1 \
  || { echo "ABORT: server aggregate/publish failed" >>"$LOG"; exit 1; }
echo "=== published via server $(date -Is) ===" >>"$LOG"
