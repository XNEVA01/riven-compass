#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
WM(warframe.market)紫卡挂单管线：scan(拉取原始挂单) + aggregate(聚合为 market.json)

用法：
  python3 wm_pipeline.py scan      --config config.json [--weapons a,b,c] [--date 2026-10-27]
  python3 wm_pipeline.py aggregate --config config.json [--date 2026-10-27]

依赖：仅 Python 3.10+ 标准库。
要点：
  - 请求必须带 sentry-trace 请求头（WM 的防爬门槛，值由服务端签发，不可伪造）
  - 匿名单查询上限 100 条：price_asc + price_desc 两次请求夹逼；不足时按极性再分区
  - 变体武器(Prime/Telos 等)在 WM 合并到基础家族名下：用候选名级联逐一探测
  - 断点续扫：raw/{date}/{weapon}.json.gz 已存在则跳过
  - 金丝雀检测：scan 开始先查 kuva_bramma，空响应即令牌失效，中止并提示重新抓包
  - scan 落 _scan.lock：进程存活期间 aggregate 拒绝写线上 market.json
    （scan 增量落盘，中途聚合会把半成品数据覆盖掉整日线上行情）
  - aggregate 内组合成本预计算：solve.cjs（Node CLI，与前端引擎同一条数学）
    预算每组合行 cost_kuva（从零洗到该组合的期望赤毒）；失败时字段缺席，前端 worker 兜底
"""

import argparse
import atexit
import gzip
import hashlib
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

# 出口被 Cloudflare 挑战时，get_clearance.py 会把浏览器拿到 UA/Cookie 写进环境变量
UA = os.environ.get("WM_UA") or ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36 Edg/156.0.0.0")
POLARITIES = ("madurai", "vazarin", "naramon")  # WM 紫卡拍卖可过滤的三种极性
PARTITION_THRESHOLD = 195  # asc+desc 去重后仍 ≥ 此值 → 判定有遗漏，需按极性分区
DE_ARCHIVE = "https://warframe-weekly-rivens-archive.pages.dev/PC"  # 社区归档镜像的 DE 官方周成交
# 归档源 repo = CloudeaSoft/warframe-weekly-rivens-archive（pages.dev 的构建仓库，每周一随 DE 发布自动 push）。
# 国内 ECS 直连 pages.dev 超时（SNI 阻断），fastly.jsdelivr.net 拉同一 repo 的数据文件可达（缓存 ≤12h，晚一天无妨）。
DE_SOURCES = (
    DE_ARCHIVE + "/{fname}",
    "https://fastly.jsdelivr.net/gh/CloudeaSoft/warframe-weekly-rivens-archive@main/data/PC/{fname}",
)


# ---------------- HTTP ----------------

def http_get_json(url, trace, timeout, retries=2):
    """带 sentry-trace 的 GET，返回 (status, obj)；400 业务错误不重试"""
    req = urllib.request.Request(url, headers={
        "accept": "application/json",
        "platform": "pc",
        "language": "en",
        "crossplay": "true",
        "sentry-trace": trace,
        "user-agent": UA,
        **({"cookie": os.environ["WM_COOKIE"]} if os.environ.get("WM_COOKIE") else {}),
    })
    for attempt in range(retries + 1):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.status, json.load(r)
        except urllib.error.HTTPError as e:
            try:
                e.read()[:256]  # 排空错误体；网络差时这一步自身也可能超时
            except Exception:
                pass  # 在 except 块内抛出的 TimeoutError 不会被兄弟 except 捕获，必须就地吞掉
            if e.code == 400:
                return 400, None  # 参数/武器名不合法
            if e.code == 429 and attempt < retries:
                time.sleep(60)
                continue
            return e.code, None
        except Exception:
            if attempt < retries:
                time.sleep(15)
                continue
            return None, None
    return None, None


def search_auctions(api_base, trace, weapon, sort_by, polarity=None, timeout=25):
    """单次拍卖搜索；返回 (status, auctions_list)"""
    url = (f"{api_base}/v1/auctions/search?type=riven&sort_by={sort_by}"
           f"&weapon_url_name={weapon}")
    if polarity:
        url += f"&polarity={polarity}"
    status, obj = http_get_json(url, trace, timeout)
    if status == 200 and obj:
        payload = obj.get("payload") or {}
        auctions = payload.get("auctions")
        if auctions is None:
            # 200 但无 auctions 字段 → 令牌失效的典型表现（空响应）
            return 200, "EMPTY_PAYLOAD"
        return 200, auctions
    return status, None


# ---------------- 候选名 ----------------

def url_name_candidates(en_name):
    """英文武器名 → 最多 3 个候选 url_name（按优先级）"""
    n = en_name.strip().lower()
    base = re.sub(r"\(.*?\)", " ", n)  # 去括号注记：Vinquibus (Melee) → vinquibus
    c1 = re.sub(r"[^a-z0-9]+", "_", base).strip("_")       # 常规：空格/连字符→下划线
    c2 = re.sub(r"[^a-z0-9]+", "_", base.replace("&", " and ")).strip("_")  # Ack & Brunt → ack_and_brunt
    c3 = re.sub(r"[^a-z0-9]+", "", base)                   # 去所有分隔符
    out, seen = [], set()
    for c in (c1, c2, c3):
        if c and c not in seen:
            seen.add(c)
            out.append(c)
    return out


# ---------------- scan ----------------

def _pid_alive(pid):
    """进程是否存活（os.kill 0 探测；pid 回收误判率可忽略，误判时可手删锁文件）"""
    try:
        pid = int(pid)
    except (TypeError, ValueError):
        return False
    if pid <= 1:
        return False
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True  # 别的用户持有，同样说明活着
    return True


def scan_lock_info(day_dir):
    """读 raw/{date}/_scan.lock：scan 存活返回锁内容，无锁/进程已死返回 None（僵尸锁）"""
    lock = day_dir / "_scan.lock"
    if not lock.exists():
        return None
    try:
        info = json.loads(lock.read_text())
    except Exception:
        return None
    return info if _pid_alive(info.get("pid")) else None


def lock_scan(day_dir):
    """scan 开始写锁；已有存活的 scan 在跑就拒绝。进程退出时自动清锁（含 sys.exit/异常）"""
    old = scan_lock_info(day_dir)
    if old:
        print(f"!! 已有 scan 在进行（pid={old.get('pid')}，自 {old.get('started_at')}）")
        sys.exit(4)
    lock = day_dir / "_scan.lock"
    lock.write_text(json.dumps({"pid": os.getpid(),
                                "started_at": datetime.now(timezone.utc).isoformat()}))
    atexit.register(lambda: lock.unlink(missing_ok=True))


def merge_auctions(*groups):
    """跨查询按 id 去重合并"""
    by_id = {}
    for g in groups:
        if not g:
            continue
        for a in g:
            by_id[a["id"]] = a
    return list(by_id.values())


def fetch_weapon_full(wm, weapon, weapon_meta):
    """对一个 url_name 做 asc+desc (+极性分区) 拉取，返回 (auctions, info)"""
    api, trace, timeout = wm["api_base"], wm["sentry_trace"], wm.get("timeout_seconds", 25)
    requests = 0

    st, asc = search_auctions(api, trace, weapon, "price_asc", timeout=timeout)
    requests += 1
    if st != 200 or asc == "EMPTY_PAYLOAD" or not isinstance(asc, list):
        return None, {"status": st, "requests": requests}

    time.sleep(wm["interval_seconds"])
    st, desc = search_auctions(api, trace, weapon, "price_desc", timeout=timeout)
    requests += 1
    if st != 200 or desc == "EMPTY_PAYLOAD" or not isinstance(desc, list):
        return None, {"status": st, "requests": requests}

    all_auctions = merge_auctions(asc, desc)
    coverage = "full" if len(all_auctions) < PARTITION_THRESHOLD else "partial"
    partitions = []

    if coverage == "partial":
        # asc+desc 各满 100 且几乎不重叠 → 中间有遗漏，按极性再切
        time.sleep(wm["interval_seconds"])
        for pol in POLARITIES:
            st, pasc = search_auctions(api, trace, weapon, "price_asc", polarity=pol, timeout=timeout)
            requests += 1
            time.sleep(wm["interval_seconds"])
            st, pdesc = search_auctions(api, trace, weapon, "price_desc", polarity=pol, timeout=timeout)
            requests += 1
            time.sleep(wm["interval_seconds"])
            if isinstance(pasc, list) or isinstance(pdesc, list):
                parts = merge_auctions(pasc, pdesc)
                partitions.append((pol, len(parts)))
                all_auctions = merge_auctions(all_auctions, parts)
            else:
                partitions.append((pol, -1))

    info = {
        "status": 200,
        "requests": requests,
        "coverage": "full" if len(all_auctions) < PARTITION_THRESHOLD * 3 else "partial",
        "partitions": partitions,
        "n_auctions": len(all_auctions),
    }
    return all_auctions, info


def cmd_scan(cfg, only_weapons, date):
    wm = cfg["wm"]
    raw_root = Path(cfg["raw_dir"])
    day_dir = raw_root / date
    day_dir.mkdir(parents=True, exist_ok=True)
    lock_scan(day_dir)

    # ---- 金丝雀：令牌健康检查 ----
    st, canary = search_auctions(wm["api_base"], wm["sentry_trace"],
                                 wm.get("canary", "kuva_bramma"), "price_asc",
                                 timeout=wm.get("timeout_seconds", 25))
    if st == 403:
        print("!! 金丝雀检测失败：被 Cloudflare 拦截（403），交给浏览器兜底取 Cookie")
        sys.exit(2)
    if st != 200 or canary == "EMPTY_PAYLOAD" or not isinstance(canary, list):
        print("!! 金丝雀检测失败：sentry-trace 令牌疑似失效（200 空载荷或非 200）")
        print("!! 请在浏览器打开 warframe.market 拍卖页重新抓包，更新 config.json 的 sentry_trace")
        sys.exit(2)
    print(f"金丝雀 {wm.get('canary')}: {len(canary)} 条挂单，令牌有效")

    # ---- 候选武器清单 ----
    game = json.load(open(cfg["game_json"]))
    weapons = game["weapons"]
    name_cache_path = raw_root / "_name_cache.json"
    name_cache = read_json(name_cache_path, {})

    todo = []
    for w in weapons:
        en = w["name"]["en"]
        cands = url_name_candidates(en)
        if not cands:
            continue
        resolved = name_cache.get(en)
        if resolved == "":
            continue  # 负缓存：候选名全部 400，WM 无此武器的独立紫卡页（Prime/变体等）
        ordered = ([resolved] if resolved else []) + [c for c in cands if c != resolved]
        todo.append((en, ordered, w))

    if only_weapons:
        want = set(x.strip().lower() for x in only_weapons.split(",") if x.strip())
        todo = [t for t in todo if t[0].lower() in want or t[1][0] in want]

    # 命令行 --weapons 传的是 url_name 时（如 boltor）直接命中候选1；再兜底匹配 en 名
    print(f"待扫描武器：{len(todo)} 个（{date}）")

    t0 = time.time()
    invalid, empty_payload, done = [], [], 0
    for idx, (en, cands, wmeta) in enumerate(todo, 1):
        out_file = day_dir / f"{cands[0]}.json.gz"
        if out_file.exists():
            done += 1
            continue  # 断点续扫
        found = None
        statuses = []
        for cand in cands:
            auctions, info = fetch_weapon_full(wm, cand, wmeta)
            statuses.append(info["status"])
            if auctions is not None:
                found = (cand, auctions, info)
                if cand != name_cache.get(en):
                    name_cache[en] = cand
                    write_json(name_cache_path, name_cache, ensure_ascii=False, indent=1)
                break
            if info["status"] == 200:
                empty_payload.append(en)
                break  # 令牌问题，不再尝试其它候选
            time.sleep(wm["interval_seconds"])
        if not found:
            invalid.append({"en": en, "tried": cands})
            if statuses and all(s == 400 for s in statuses):
                # 全部候选都 400 = 确认无此页（区别于网络失败/令牌失效），写负缓存
                name_cache[en] = ""
                write_json(name_cache_path, name_cache, ensure_ascii=False, indent=1)
        else:
            cand, auctions, info = found
            payload = {
                "fetched_at": datetime.now(timezone.utc).isoformat(),
                "weapon_url_name": cand,
                "weapon": {"en": wmeta["name"]["en"], "zh": wmeta["name"]["zh"],
                           "tc": wmeta["name"]["tc"], "cn": wmeta["name"]["cn"],
                           "cls": wmeta["cls"]},
                "scan_info": info,
                "auctions": auctions,
            }
            with gzip.open(out_file, "wt", encoding="utf-8") as f:
                json.dump(payload, f, ensure_ascii=False)
            done += 1
        if idx % 10 == 0 or idx == len(todo):
            elapsed = time.time() - t0
            rate = idx / max(elapsed, 1)
            eta = (len(todo) - idx) / max(rate, 1e-9) / 60
            print(f"[{idx}/{len(todo)}] 完成={done} 无效={len(invalid)} "
                  f"已用={elapsed/60:.0f}分 预计剩余={eta:.0f}分", flush=True)
        time.sleep(wm["interval_seconds"])

    meta = {
        "finished_at": datetime.now(timezone.utc).isoformat(),
        "date": date,
        "scanned": done,
        "invalid": invalid,
        "empty_payload": empty_payload,
    }
    (day_dir / "_scan_meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1))
    print(f"扫描完成：成功 {done}，无效 {len(invalid)}，空载荷 {len(empty_payload)}")
    if invalid:
        print("无效武器样例：", [x["en"] for x in invalid[:10]])


# ---------------- DE 周成交（社区归档 CDN）----------------
#
# DE 官方每周一 00:00 UTC 发布上周全渠道真实成交（武器 × 洗过/未洗 × pop/median/avg/stddev），
# 旧官方端点已全部下线，社区归档 CDN 持续镜像（PC/2026_W44_weeklyRivensPC.json，2019_W13 起）。
# compatibility 与紫卡同语义：按紫卡本身的名字（基础武器）归档——Nukor/Kohm、
# Kuva Bramma/Dakra Prime 与 market.json 的 name.en 直接对齐（实测 412/415 命中，
# 未中的 3 个全是零挂单行），无需家族挂靠。compatibility=null 是未开紫卡的整类成交，跳过。

def de_week_name(d):
    y, w, _ = d.isocalendar()
    return f"{y}_W{w:02d}_weeklyRivensPC.json"


def write_json(path, data, **kw):
    """原子写 JSON（tmp+replace）：进程中途被杀不再留下截断文件（代码审查 P1）"""
    tmp = path.with_suffix(path.suffix + '.tmp')
    tmp.write_text(json.dumps(data, **kw))
    tmp.replace(path)


def read_json(path, default):
    """读 JSON；不存在给默认，损坏（写入中断的半截文件）打印并重建——缓存坏文件不再杀死整条 cron"""
    try:
        return json.loads(Path(path).read_text())
    except FileNotFoundError:
        return default
    except Exception as e:
        print(f"!! {path} 损坏，忽略并重建：{e}")
        return default


def ensure_de(cfg, force=False):
    """确保 raw/de/ 有最新一周的 DE 数据，幂等；返回文件路径（拉不到返回 None）。
    本周文件尚未发布（周一 00:00 UTC 前）→ 回退上周，周二起的每日 cron 自动换新。"""
    de_dir = Path(cfg["raw_dir"]) / "de"
    de_dir.mkdir(parents=True, exist_ok=True)
    now = datetime.now(timezone.utc)
    for fname in (de_week_name(now), de_week_name(now - timedelta(days=7))):
        out = de_dir / fname
        if out.exists() and not force:
            try:
                json.loads(out.read_text())
                return out
            except Exception:
                print(f"!! {fname} 损坏，重新拉取")  # 写入中断留下的半截文件（代码审查 P1）
        for tpl in DE_SOURCES:
            try:
                with urllib.request.urlopen(tpl.format(fname=fname), timeout=30) as r:
                    data = json.load(r)
            except Exception:
                continue  # 源不通 → 试下一源；本周尚未发布 → 试上周
            write_json(out, data, ensure_ascii=False, separators=(",", ":"))
            print(f"DE 周数据拉取：{fname}（{len(data)} 条，源 {tpl.split('/')[2]}）")
            return out
    return None


def load_de_week(path):
    """最新 DE 周文件 → {week, by_en: {en: {unrolled/rerolled: {pop, median}}}, total}"""
    if not path:
        return None
    m = re.match(r"(\d{4})_W(\d{2})_", path.name)
    by_en, total = {}, 0
    try:
        entries = json.loads(path.read_text())
    except Exception as e:
        print(f"!! DE 周数据损坏（行情缺 DE 维度，前端显示为空）：{e}")
        return None
    for e in entries:
        comp = e.get("compatibility")
        if not comp:
            continue
        key = "rerolled" if e.get("rerolled") else "unrolled"
        by_en.setdefault(comp, {})[key] = {"pop": e.get("pop") or 0,
                                           "median": e.get("median")}
        total += e.get("pop") or 0
    return {"week": f"{m.group(1)}-W{m.group(2)}" if m else path.stem,
            "by_en": by_en, "total": total}


def de_entry(groups):
    """洗过/未洗两组 → 武器级 de 字段；median 为 pop 加权值（DE 只给组内中位）"""
    pop, wsum, out = 0, 0.0, {}
    for key in ("unrolled", "rerolled"):
        g = groups.get(key)
        if not g or not g.get("pop"):
            continue
        out[key] = {"pop": g["pop"], "median": g.get("median")}
        pop += g["pop"]
        if g.get("median"):
            wsum += g["median"] * g["pop"]
    if not pop:
        return None
    out["pop"] = pop
    out["median"] = round(wsum / pop, 1) if wsum else None
    return out


# ---------------- 组合成本预计算（跨武器利润榜）----------------
#
# 行情页利润列要「从零洗到该组合」的期望赤毒（E[赤毒]），前端引擎已有同一条数学
# （costCore + Planner），rolldown 打成零依赖 CLI（solve.cjs，内联同一份 game.json）
# 在这里每日预算进 market.json 的组合行（cost_kuva），行情页直读即达。
# stdin: {"units":[{weaponId,cls,pos,neg}]} → stdout: {"costs":[number|null]} 同序。
# 幂等缓存在 pipeline 目录（cost_cache.json），game 版本/倾向变化自动整体失效（CLI 内部处理）。
# 任何失败都不影响 market.json 产出：cost_kuva 缺席时前端 worker 现算兜底。

def solve_costs(cfg, weapons_out):
    """所有组合行 → E[赤毒]，就地写 c["cost_kuva"]；返回 meta 统计（失败返回 None）"""
    try:
        game = json.loads(Path(cfg["game_json"]).read_text())
        id_by_en = {w["name"]["en"]: w["id"] for w in game["weapons"]}
    except Exception as e:
        print(f"!! game.json 读取失败（组合成本跳过）：{e}")
        return None
    here = Path(__file__).resolve().parent
    s = cfg.get("solve", {})
    node = s.get("node_bin", "/opt/rivenroll/node/bin/node")
    script = s.get("script", str(here / "solve.cjs"))
    cache = s.get("cache", str(here / "cost_cache.json"))
    # 握手（V3d-2 打包流程，spec §9.4）：solve.cjs 内联的 game 数据（--meta.game）必须与本管线
    # 读的 game.json 同指纹——build-data.py 出新数据没重打/上传 bundle 时响亮拒绝，宁缺毋滥
    try:
        probe = subprocess.run([node, script, "--meta"], capture_output=True, text=True, timeout=60)
        bundle_game = json.loads(probe.stdout)["game"]
    except Exception as e:
        print(f"!! solve.cjs --meta 握手失败（前端 worker 兜底）：{e}")
        return None
    game_sha = hashlib.sha256(Path(cfg["game_json"]).read_bytes()).hexdigest()
    if bundle_game != game_sha:
        print(f"!! solve.cjs 内联数据与 game.json 不符：bundle={str(bundle_game)[:16]}… game={game_sha[:16]}…")
        print("   → 本地重跑 scripts/build-solve.sh，并上传 solve.cjs 与 game.json（spec §9.4 V3d-2）")
        return None
    units, refs = [], []
    for entry in weapons_out.values():
        wid = id_by_en.get((entry.get("name") or {}).get("en") or "")
        if not wid or not entry.get("combos"):
            continue
        for c in entry["combos"]:
            units.append({"weaponId": wid, "cls": entry.get("cls"),
                          "pos": c["pos"], "neg": c["neg"]})
            refs.append(c)
    if not units:
        return None
    t0 = time.time()
    try:
        proc = subprocess.run([node, script, cache],
                              input=json.dumps({"units": units}),
                              capture_output=True, text=True,
                              timeout=s.get("timeout_seconds", 300))
    except Exception as e:
        print(f"!! 组合成本求解失败（前端 worker 兜底）：{e}")
        return None
    if proc.returncode != 0:
        print(f"!! solve.cjs 退出码 {proc.returncode}（前端 worker 兜底）")
        if proc.stderr:
            print(proc.stderr[-1500:])
        return None
    if proc.stderr:
        print(proc.stderr.strip().splitlines()[-1])  # CLI 自带的末行统计
    try:
        costs = json.loads(proc.stdout)["costs"]
    except Exception:
        print("!! solve.cjs 输出无法解析（前端 worker 兜底）")
        return None
    if not isinstance(costs, list) or len(costs) != len(units):
        got = len(costs) if isinstance(costs, list) else "?"
        print(f"!! solve.cjs 返回 {got} 行，期望 {len(units)}（跳过回填，前端 worker 兜底）")
        return None
    for c, kuva in zip(refs, costs):
        c["cost_kuva"] = kuva
    meta = {"rows": len(units),
            "costed": sum(1 for v in costs if v is not None),
            "ms": round((time.time() - t0) * 1000)}
    meta["nulls"] = meta["rows"] - meta["costed"]
    m = re.search(r"solved=(\d+) cached=(\d+)", proc.stderr or "")
    if m:
        meta["solved"], meta["cached"] = int(m.group(1)), int(m.group(2))
    return meta


# ---------------- aggregate ----------------

def pct(sorted_vals, p):
    if not sorted_vals:
        return None
    i = min(len(sorted_vals) - 1, max(0, round(p / 100 * (len(sorted_vals) - 1))))
    return sorted_vals[i]


def median(xs):
    xs = sorted(xs)
    return pct(xs, 50)


def parse_age_days(ts, now):
    try:
        t = datetime.fromisoformat(ts)
        if t.tzinfo is None:
            t = t.replace(tzinfo=timezone.utc)
        return (now - t).total_seconds() / 86400
    except Exception:
        return None


def combo_stats(items):
    prices = sorted(x["price"] for x in items)
    ages = sorted(x["age"] for x in items)
    rr = [x["re_rolls"] for x in items if x["re_rolls"] is not None]
    return {
        "count": len(items),
        "median_price": median(prices),
        "min_price": prices[0],
        "max_price": prices[-1],
        "re_rolls_mean": round(sum(rr) / len(rr), 2) if rr else None,
        "age_days_median": median(ages),
    }


def cmd_aggregate(cfg, date, out_path=None):
    raw_root = Path(cfg["raw_dir"])
    day_dir = raw_root / date
    if not day_dir.exists():
        print(f"无原始数据目录：{day_dir}")
        sys.exit(2)
    # 写线上数据前确认 scan 不在进行（--out 测试路径不受限）：
    # scan 增量落盘，中途聚合会把半成品数据覆盖掉整日线上行情
    if out_path is None:
        running = scan_lock_info(day_dir)
        if running:
            print(f"!! scan 正在进行（pid={running.get('pid')}）：拒绝覆盖线上 market.json")
            print("!!   待 scan 结束后重跑；确认误判可删 raw 日期目录下的 _scan.lock")
            sys.exit(4)

    filters = cfg.get("filters", {})
    max_age = filters.get("max_age_days", 30)
    top_combos = filters.get("top_combos", 12)
    combo_min = filters.get("combo_min_count", 2)
    now = datetime.now(timezone.utc)

    weapons_out = {}
    attributes_seen = set()
    n_active_total = n_stale_total = 0

    files = sorted(day_dir.glob("*.json.gz"))
    for fp in files:
        with gzip.open(fp, "rt", encoding="utf-8") as f:
            data = json.load(f)
        auctions = data.get("auctions", [])
        wmeta = data.get("weapon", {})

        active, stale = [], []
        n_private = n_no_price = n_hidden = 0
        for a in auctions:
            if a.get("private"):
                n_private += 1
                continue
            if a.get("visible") is False:
                n_hidden += 1
                continue
            price = a.get("buyout_price") or a.get("top_bid")
            if not price:
                n_no_price += 1
                continue
            age = parse_age_days(a.get("updated", ""), now)
            if age is None:
                continue
            item = a.get("item", {})
            pos, neg = [], []
            for attr in item.get("attributes", []):
                key = attr.get("url_name")
                if not key:
                    continue
                attributes_seen.add(key)
                (pos if attr.get("positive") else neg).append(key)
            rec = {"price": price, "age": age, "re_rolls": item.get("re_rolls"),
                   "pos": tuple(sorted(pos)), "neg": tuple(sorted(neg))}
            if age > max_age:
                stale.append(rec)  # 废单：长期无更新，不参与统计
            else:
                active.append(rec)

        entry = {
            "name": {"en": wmeta.get("en"), "zh": wmeta.get("zh"),
                     "tc": wmeta.get("tc"), "cn": wmeta.get("cn")},
            "cls": wmeta.get("cls"),
            "n_total": len(auctions),
            "n_active": len(active),
            "n_stale": len(stale),       # 废单数（超 max_age_days 未更新）
            "n_private": n_private,
            "n_no_price": n_no_price,
            "n_hidden": n_hidden,
        }
        if active:
            prices = sorted(x["price"] for x in active)
            ages = [x["age"] for x in active]
            rr = [x["re_rolls"] for x in active if x["re_rolls"] is not None]
            entry.update({
                "price": {"median": pct(prices, 50), "p25": pct(prices, 25),
                          "p75": pct(prices, 75), "min": prices[0], "max": prices[-1]},
                "freshness_days": median(ages),  # 有效挂单的挂单时长中位
                "re_rolls_mean": round(sum(rr) / len(rr), 2) if rr else None,
            })
            # 组合聚类：正属性集合 + 负属性集合 为 key
            combos = {}
            for x in active:
                key = (x["pos"], x["neg"])
                combos.setdefault(key, []).append(x)
            combo_list = []
            for (pos, neg), items in combos.items():
                if len(items) >= combo_min:
                    s = combo_stats(items)
                    s["pos"], s["neg"] = list(pos), list(neg)
                    combo_list.append(s)
            combo_list.sort(key=lambda s: (-s["count"], -(s["median_price"] or 0)))
            entry["combos"] = combo_list[:top_combos]
        weapons_out[data["weapon_url_name"]] = entry
        n_active_total += len(active)
        n_stale_total += len(stale)

    # DE 周成交：per-weapon de 字段（拉不到就不带，schema 向后兼容）
    de = load_de_week(ensure_de(cfg))
    n_de = de_trades = 0
    if de:
        for entry in weapons_out.values():
            e = de_entry(de["by_en"].get(entry["name"]["en"], {}))
            if e:
                entry["de"] = e
                n_de += 1
                de_trades += e["pop"]

    # 组合成本预计算：cost_kuva 进每组合行，meta.costs 记覆盖率
    costs_meta = solve_costs(cfg, weapons_out)
    if costs_meta:
        print(f"组合成本：命中 {costs_meta['costed']}/{costs_meta['rows']}"
              f"（null {costs_meta['nulls']}），{costs_meta['ms']}ms")

    market = {
        "meta": {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "scan_date": date,
            "source": "warframe.market",
            "filters": {"max_age_days": max_age, "combo_min_count": combo_min,
                        "top_combos": top_combos},
            "counts": {"weapons": len(weapons_out),
                       "weapons_with_listings": sum(1 for v in weapons_out.values() if v["n_active"] > 0),
                       "listings_active": n_active_total,
                       "listings_stale": n_stale_total},
            "de": {"week": de["week"], "weapons": n_de, "trades": de_trades} if de else None,
            "costs": costs_meta,
        },
        "attributes": sorted(attributes_seen),
        "weapons": weapons_out,
    }
    out = Path(out_path or cfg["out_market"])
    out.parent.mkdir(parents=True, exist_ok=True)
    write_json(out, market, ensure_ascii=False, separators=(",", ":"))
    size = out.stat().st_size
    print(f"聚合完成：{len(weapons_out)} 武器，活跃挂单 {n_active_total}，废单 {n_stale_total}")
    if de:
        print(f"DE 周成交：{de['week']} 命中 {n_de} 武器，周成交 {de['total']} 笔")
    print(f"输出：{out} ({size/1024:.0f} KB)")


# ---------------- 清理过期 raw ----------------

def prune(cfg):
    keep = cfg.get("raw_keep_days", 14)
    raw_root = Path(cfg["raw_dir"])
    cutoff = time.time() - keep * 86400
    removed = 0
    for d in raw_root.iterdir():
        if d.is_dir() and d.name[0].isdigit() and d.stat().st_mtime < cutoff:
            for f in d.iterdir():
                f.unlink()
            d.rmdir()
            removed += 1
    print(f"清理过期 raw：删除 {removed} 天（保留 {keep} 天）")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("command", choices=["scan", "aggregate", "de", "prune"])
    ap.add_argument("--config", required=True)
    ap.add_argument("--weapons", help="逗号分隔：英文武器名或 url_name（扫描子集，用于测试）")
    ap.add_argument("--date", default=datetime.now(timezone(timedelta(hours=8))).strftime("%Y-%m-%d"))
    ap.add_argument("--out", help="覆盖输出路径（aggregate 测试用）")
    args = ap.parse_args()

    cfg = json.loads(Path(args.config).read_text())
    if args.command == "scan":
        cmd_scan(cfg, args.weapons, args.date)
    elif args.command == "aggregate":
        cmd_aggregate(cfg, args.date, args.out)
    elif args.command == "de":
        p = ensure_de(cfg, force=True)
        print(f"DE 周数据：{p}" if p else "DE 周数据拉取失败")
    else:
        prune(cfg)


if __name__ == "__main__":
    main()
