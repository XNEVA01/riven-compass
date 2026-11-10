#!/bin/bash
# CI/本地通用扫描：成功标准 = 退出码 0 且 raw 文件数达标（扫描中途被 403 不中止，
# 会被计成「无效」，所以不能只看退出码）。
# 被 Cloudflare 挑战（金丝雀 403 或全军覆没）时，用 playwright 取 Cookie 后断点续扫。
set -uo pipefail
cd "$(dirname "$0")"

DAY=$(date +%F)
LOG="scan-${DAY}.log"
[ -n "${GITHUB_ENV:-}" ] && echo "DAY=$DAY" >> "$GITHUB_ENV"

ok() { [ -f "raw/$DAY/_scan_meta.json" ] && [ "$(ls raw/$DAY/*.json.gz 2>/dev/null | wc -l)" -ge 400 ]; }
# 扫描输出同时进 Actions 控制台（实时可见）与日志文件
scan() { python3 -u wm_pipeline.py scan --config config.ci.json 2>&1 | tee -a "$LOG"; return "${PIPESTATUS[0]}"; }

if scan && ok; then
  echo "scan ok $(date -Is)" >>"$LOG"
  exit 0
fi

# 令牌失效（200 空载荷）不是浏览器能解决的，直接失败，免得白装 playwright
if grep -q "令牌疑似失效" "$LOG" && ! grep -q "Cloudflare 拦截" "$LOG"; then
  echo "ABORT: sentry-trace token expired, browser fallback won't help $(date -Is)" | tee -a "$LOG"
  exit 1
fi

echo "--- blocked, installing playwright chromium $(date -Is)" | tee -a "$LOG"
npm i --no-save playwright >>"$LOG" 2>&1 || { echo "npm i playwright failed" | tee -a "$LOG"; exit 1; }
npx playwright install --with-deps chromium >>"$LOG" 2>&1 || { echo "chromium install failed" | tee -a "$LOG"; exit 1; }
node get_clearance.mjs > clearance.env 2>>"$LOG" || { echo "clearance failed $(date -Is)" | tee -a "$LOG"; exit 1; }
# shellcheck disable=SC1091
. ./clearance.env
export WM_COOKIE WM_UA
echo "--- clearance collected, resuming scan $(date -Is)" | tee -a "$LOG"
if scan && ok; then
  echo "scan ok after clearance $(date -Is)" >>"$LOG"
  exit 0
fi
echo "scan still failing after clearance $(date -Is)" >>"$LOG"
tail -20 "$LOG"
exit 1
