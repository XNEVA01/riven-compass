#!/bin/bash
# 服务器每日扫描（CF 兜底版）：被 Cloudflare 挑战时用 playwright 浏览器取 Cookie 后续扫。
# 由 daily_scan_publish.sh 调用；服务器上部署为 /opt/rivenroll/pipeline/scan_with_fallback.sh。
# 注意：阿里云等数据中心 IP 可能拿到交互式挑战，无头浏览器过不了时会失败
# （2026-11-12 实测 47.114.77.4 无法自动放行），此时改走沙箱扫描 + publish_via_server.sh。
set -uo pipefail
cd /opt/rivenroll/pipeline
DAY=$(TZ=Asia/Shanghai date +%F)
LOG="scan-$DAY.log"

scan() { python3 -u wm_pipeline.py scan --config config.json >>"$LOG" 2>&1; }

if scan; then
  echo "scan ok $(date -Is)" >>"$LOG"
  exit 0
fi

if ! grep -q "Cloudflare 拦截" "$LOG"; then
  echo "scan failed for a non-Cloudflare reason $(date -Is)" >>"$LOG"
  exit 1
fi

# 令牌失效（200 空载荷）不是浏览器能解决的，直接失败，免得白装浏览器
if grep -q "令牌疑似失效" "$LOG" && ! grep -q "Cloudflare 拦截" "$LOG"; then
  echo "ABORT: sentry-trace token expired, browser fallback won't help $(date -Is)" >>"$LOG"
  exit 1
fi

echo "--- blocked, ensuring playwright chromium $(date -Is)" >>"$LOG"
sudo apt-get install -y -qq nodejs npm >>"$LOG" 2>&1
npm i --no-save playwright@1.52.0 >>"$LOG" 2>&1 || { echo "npm i playwright failed" >>"$LOG"; exit 1; }
if [ -d "$HOME/.cache/ms-playwright" ] && ls "$HOME/.cache/ms-playwright/" | grep -q chromium; then
  echo "chromium present" >>"$LOG"
else
  npx playwright install chromium >>"$LOG" 2>&1 || { echo "chromium install failed" >>"$LOG"; exit 1; }
fi
node get_clearance.mjs > clearance.env 2>>"$LOG" || { echo "clearance failed $(date -Is)" >>"$LOG"; exit 1; }
# shellcheck disable=SC1091
. ./clearance.env
export WM_COOKIE WM_UA
echo "--- clearance collected, resuming scan $(date -Is)" >>"$LOG"
if scan; then
  echo "scan ok after clearance $(date -Is)" >>"$LOG"
  exit 0
fi
echo "scan still blocked after clearance $(date -Is)" >>"$LOG"
exit 1
