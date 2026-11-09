#!/bin/bash
# 把校验通过的快照发布到服务器：先 scp 到 /tmp 临时文件，服务器端二次校验
# 武器数 ≥300 后才原子替换线上 market.json，失败保旧快照。
set -euo pipefail
cd "$(dirname "$0")"

DAY="${DAY:?DAY not set}"
OUT="out/market.json"
REMOTE_PENDING="/tmp/market.pending-${DAY}.json"
REMOTE_OUT="/var/www/rivenroll/shared/data/market.json"
# host/user 非敏感，直接给默认值；只有 SSH 私钥走 secrets
SSH_HOST="${SSH_HOST:-47.114.77.4}"
SSH_USER="${SSH_USER:-trae}"

mkdir -p ~/.ssh
printf '%s\n' "$SSH_KEY" > ~/.ssh/id_ed25519
chmod 600 ~/.ssh/id_ed25519
ssh-keyscan -H "$SSH_HOST" >> ~/.ssh/known_hosts 2>/dev/null
[ -s ~/.ssh/known_hosts ] || { echo "ssh-keyscan got nothing (port 22 unreachable?)"; exit 1; }

SSH_OPTS=(-i ~/.ssh/id_ed25519 -o IdentitiesOnly=yes)

scp "${SSH_OPTS[@]}" "$OUT" "${SSH_USER}@${SSH_HOST}:${REMOTE_PENDING}"

ssh "${SSH_OPTS[@]}" "${SSH_USER}@${SSH_HOST}" bash -s <<REMOTE
set -e
python3 - <<'PY'
import json
d = json.load(open("$REMOTE_PENDING"))
w = len(d["weapons"])
print("pending weapons:", w)
assert w >= 300, "pending snapshot has too few weapons"
PY
mv "$REMOTE_PENDING" "$REMOTE_OUT"
ls -l "$REMOTE_OUT"
REMOTE
echo "published $(date -Is)"
