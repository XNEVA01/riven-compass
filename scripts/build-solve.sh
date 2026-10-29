#!/bin/sh
# solve.cjs 打包 + 自检（spec §9.4 V3d-2，行情组合成本预计算的引擎 CLI）：
#   ① game_stamp.py 重写版本戳（game.json 的 sha256，幂等）
#   ② rolldown 打零依赖单文件（服务器只需 Node）
#   ③ 自检：--meta 指纹必须等于 game.json 的 sha256；空跑输出 {"costs":[]}
# 产物：dist-pipeline/solve.cjs；与 game.json 一起上传 /opt/rivenroll/pipeline/。
# 忘了重打/上传 → 服务器端握手（wm_pipeline.py solve_costs）会响亮拒绝预算，宁缺毋滥。
set -e
cd "$(dirname "$0")/.."

python3 scripts/game_stamp.py
npx rolldown src/pipeline/solve.ts --format cjs --platform node --file dist-pipeline/solve.cjs

python3 - <<'PY'
import hashlib, json, subprocess
sha = hashlib.sha256(open("src/data/game.json", "rb").read()).hexdigest()
meta = json.loads(subprocess.run(["node", "dist-pipeline/solve.cjs", "--meta"], capture_output=True, text=True, check=True).stdout)
assert meta["game"] == sha, f"!! solve.cjs 内联指纹 {meta['game'][:16]}… != game.json {sha[:16]}…"
empty = json.loads(subprocess.run(["node", "dist-pipeline/solve.cjs"], input='{"units":[]}', capture_output=True, text=True, check=True).stdout)
assert empty == {"costs": []}, empty
print(f"自检通过：--meta 指纹 {sha[:16]}… 与 game.json 一致；空跑 OK")
PY

ls -l dist-pipeline/solve.cjs
echo "上传：rsync -av -e 'ssh -F /workspace/.ssh/config' dist-pipeline/solve.cjs riven:/opt/rivenroll/pipeline/"
