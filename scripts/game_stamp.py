#!/usr/bin/env python3
"""重写 src/pipeline/game.stamp.ts（game.json 的 sha256）——solve.cjs 版本键与管线握手的锚点。

build-data.py 写完 game.json、scripts/build-solve.sh 打包前都会跑它；幂等，内容不变不重写。
"""
from __future__ import annotations

import hashlib
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
GAME = ROOT / "src/data/game.json"
STAMP = ROOT / "src/pipeline/game.stamp.ts"


def main() -> None:
    sha = hashlib.sha256(GAME.read_bytes()).hexdigest()
    text = (
        "/** 由 scripts/game_stamp.py 从 src/data/game.json 的 sha256 生成"
        "（build-data.py / build-solve.sh 自动重写，勿手改）*/\n"
        f'export const GAME_SHA256 = "{sha}";\n'
    )
    if not STAMP.exists() or STAMP.read_text(encoding="utf-8") != text:
        STAMP.write_text(text, encoding="utf-8")
        print(f"game.stamp.ts -> {sha[:16]}…")
    else:
        print(f"game.stamp.ts 不变（{sha[:16]}…）")


if __name__ == "__main__":
    sys.exit(main())
