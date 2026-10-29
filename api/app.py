#!/usr/bin/env python3
"""riven-roll 账号后端：邮箱+密码注册登录、会话云同步、使用计量（收费数据底座）、服务器渲染管理后台。

单文件 Flask + SQLite（WAL）。gunicorn 跑 127.0.0.1:8100，nginx 把 /api 与 /admin 反代过来。
可选登录：游客完全不经这里；登录用户获得跨设备云同步，行为计数从现在开始积累。

本地自测：RR_API_DEV=1 python3 selftest.py
"""
import html
import json
import os
import re
import secrets
import sqlite3
import time
from datetime import datetime, timedelta, timezone
from functools import wraps
from pathlib import Path

from flask import (Flask, abort, flash, g, jsonify, redirect, render_template, request, session, url_for)
from werkzeug.middleware.proxy_fix import ProxyFix
from werkzeug.security import check_password_hash, generate_password_hash

BASE = Path(__file__).resolve().parent
DEV = os.environ.get("RR_API_DEV") == "1"
DB_PATH = Path(os.environ.get("RR_API_DB", BASE / "rivenroll.db"))
SECRET_PATH = Path(os.environ.get("RR_API_SECRET", BASE / "secret_key"))

# config.json 可选：{"admin_emails": ["you@example.com"]}——名单内邮箱登录即自动提权为管理员
ADMIN_EMAILS: set[str] = set()
_cfg = BASE / "config.json"
if _cfg.exists():
    try:
        ADMIN_EMAILS = {e.strip().lower() for e in json.loads(_cfg.read_text()).get("admin_emails", []) if e.strip()}
    except Exception as e:  # 配置坏了不拦服务
        print(f"!! config.json 解析失败，忽略：{e}")

CST = timezone(timedelta(hours=8))
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
EVENT_TYPES = {"page", "ocr", "plan", "compare", "login", "register"}
EVENT_BATCH_MAX = 100
STATE_MAX_BYTES = 100_000

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  pw_version INTEGER NOT NULL DEFAULT 1,
  plan TEXT NOT NULL DEFAULT 'free',
  banned INTEGER NOT NULL DEFAULT 0,
  is_admin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  last_login_at TEXT
);
CREATE TABLE IF NOT EXISTS user_state (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  route TEXT,
  at TEXT NOT NULL,
  day TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_day ON events(day, type);
CREATE INDEX IF NOT EXISTS idx_events_user ON events(user_id, day);
CREATE TABLE IF NOT EXISTS share_links (
  code TEXT PRIMARY KEY,
  target TEXT NOT NULL,
  created_at TEXT NOT NULL
);
"""

app = Flask(__name__)
app.config.update(
    SESSION_COOKIE_NAME="rr_sess",
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    PERMANENT_SESSION_LIFETIME=timedelta(days=30),
    MAX_CONTENT_LENGTH=512 * 1024,
)
if DEV:  # 本地 http 自测：不加 Secure，否则浏览器拒收 cookie
    app.config.update(SECRET_KEY="dev-secret", SESSION_COOKIE_SECURE=False, TESTING=True)
else:
    app.config.update(SESSION_COOKIE_SECURE=True)
    if not SECRET_PATH.exists():
        SECRET_PATH.write_text(secrets.token_hex(32))
        SECRET_PATH.chmod(0o600)
    app.config.update(SECRET_KEY=SECRET_PATH.read_text().strip())
# nginx 终结 HTTPS：认一个 X-Forwarded-* 层，Secure cookie 与真实 IP 才对
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1)


def now() -> str:
    return datetime.now(CST).isoformat(timespec="seconds")


def db() -> sqlite3.Connection:
    if "db" not in g:
        conn = sqlite3.connect(DB_PATH, timeout=10)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA busy_timeout=5000")
        conn.execute("PRAGMA foreign_keys=ON")
        g.db = conn
    return g.db


@app.teardown_appcontext
def _close_db(_exc):
    conn = g.pop("db", None)
    if conn is not None:
        conn.close()


def init_db() -> None:
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.executescript(SCHEMA)
    conn.commit()
    conn.close()


# ---------------- 内存限流（固定窗口，worker 各自近似即可） ----------------
_hits: dict[str, tuple[float, int]] = {}


def rate_ok(key: str, limit: int, window: float) -> bool:
    if len(_hits) > 4096:  # 防字典无界增长：粗暴清掉过半
        _hits.clear()
    t = time.monotonic()
    start, n = _hits.get(key, (t, 0))
    if t - start > window:
        start, n = t, 0
    n += 1
    _hits[key] = (start, n)
    return n <= limit


def client_ip() -> str:
    return request.remote_addr or "?"


# ---------------- 认证 ----------------
def current_user() -> sqlite3.Row | None:
    """session 里的 uid+pw_version 必须与库里当前值一致：改密/重置后所有旧 cookie 立即失效。"""
    uid = session.get("uid")
    if uid is None:
        return None
    row = db().execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
    if row is None or row["banned"] or row["pw_version"] != session.get("pv"):
        return None
    return row


def login_session(row: sqlite3.Row) -> None:
    session.clear()
    session["uid"] = row["id"]
    session["pv"] = row["pw_version"]
    session.permanent = True


def user_json(row: sqlite3.Row) -> dict:
    return {"id": row["id"], "email": row["email"], "plan": row["plan"], "is_admin": bool(row["is_admin"])}


def api_auth_required(f):
    @wraps(f)
    def wrapper(*a, **kw):
        if current_user() is None:
            return jsonify(error="unauthorized"), 401
        return f(*a, **kw)

    return wrapper


def bad_request(msg: str):
    return jsonify(error=msg), 400


# ---------------- JSON API：认证 ----------------
@app.post("/api/auth/register")
def api_register():
    if not rate_ok(f"reg:{client_ip()}", 5, 3600):
        return jsonify(error="rate_limited"), 429
    body = request.get_json(silent=True) or {}
    email = str(body.get("email") or "").strip().lower()
    password = str(body.get("password") or "")
    if not EMAIL_RE.fullmatch(email) or len(email) > 254:
        return bad_request("bad_email")
    if not (8 <= len(password) <= 128):
        return bad_request("weak_password")
    try:
        cur = db().execute(
            "INSERT INTO users (email, password_hash, created_at) VALUES (?,?,?)",
            (email, generate_password_hash(password), now()),
        )
    except sqlite3.IntegrityError:
        return jsonify(error="email_taken"), 409
    db().execute("INSERT INTO events (user_id, type, at, day) VALUES (?,?,?,?)", (cur.lastrowid, "register", now(), now()[:10]))
    db().commit()
    row = db().execute("SELECT * FROM users WHERE id=?", (cur.lastrowid,)).fetchone()
    login_session(row)
    return jsonify(user=user_json(row))


@app.post("/api/auth/login")
def api_login():
    if not rate_ok(f"login:{client_ip()}", 20, 900):
        return jsonify(error="rate_limited"), 429
    body = request.get_json(silent=True) or {}
    email = str(body.get("email") or "").strip().lower()
    password = str(body.get("password") or "")
    row = db().execute("SELECT * FROM users WHERE email=?", (email,)).fetchone()
    if row is None or not check_password_hash(row["password_hash"], password):
        return jsonify(error="invalid_credentials"), 401
    if row["banned"]:
        return jsonify(error="banned"), 403
    if email in ADMIN_EMAILS and not row["is_admin"]:  # config.json 名单自动提权
        db().execute("UPDATE users SET is_admin=1 WHERE id=?", (row["id"],))
        row = db().execute("SELECT * FROM users WHERE id=?", (row["id"],)).fetchone()
    db().execute("UPDATE users SET last_login_at=? WHERE id=?", (now(), row["id"]))
    db().execute("INSERT INTO events (user_id, type, at, day) VALUES (?,?,?,?)", (row["id"], "login", now(), now()[:10]))
    db().commit()
    login_session(row)
    return jsonify(user=user_json(row))


@app.post("/api/auth/logout")
def api_logout():
    session.clear()
    return jsonify(ok=True)


@app.get("/api/auth/me")
def api_me():
    u = current_user()
    return jsonify(user=user_json(u) if u else None)


# ---------------- JSON API：会话云同步 ----------------
@app.get("/api/me/state")
@api_auth_required
def state_get():
    u = current_user()
    row = db().execute("SELECT data, updated_at FROM user_state WHERE user_id=?", (u["id"],)).fetchone()
    if row is None:
        return jsonify(data=None, updated_at=None)
    try:  # 存的是序列化文本，读回来还原成对象给前端
        data = json.loads(row["data"])
    except ValueError:
        return jsonify(data=None, updated_at=None)
    return jsonify(data=data, updated_at=row["updated_at"])


@app.put("/api/me/state")
@api_auth_required
def state_put():
    u = current_user()
    if not rate_ok(f"state:{u['id']}", 120, 60):
        return jsonify(error="rate_limited"), 429
    body = request.get_json(silent=True) or {}
    data = body.get("data")
    if not isinstance(data, dict):
        return bad_request("bad_request")
    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    if len(payload) > STATE_MAX_BYTES:
        return bad_request("state_too_large")
    ts = now()
    db().execute(
        "INSERT INTO user_state (user_id, data, updated_at) VALUES (?,?,?) "
        "ON CONFLICT(user_id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at",
        (u["id"], payload, ts),
    )
    db().commit()
    return jsonify(updated_at=ts)


# ---------------- JSON API：使用计量 ----------------
@app.post("/api/me/events")
@api_auth_required
def events_post():
    u = current_user()
    if not rate_ok(f"events:{u['id']}", 60, 60):
        return jsonify(ok=True)  # 计量尽力而为：超限静默丢弃，不与前端为难
    body = request.get_json(silent=True) or {}
    items = body.get("events")
    if not isinstance(items, list):
        return bad_request("bad_request")
    rows = []
    for it in items[:EVENT_BATCH_MAX]:
        if not isinstance(it, dict):
            continue
        typ = str(it.get("type") or "")
        if typ not in EVENT_TYPES:
            continue
        route = str(it.get("route") or "")[:64]
        rows.append((u["id"], typ, route or None, now(), now()[:10]))
    if rows:
        db().executemany("INSERT INTO events (user_id, type, route, at, day) VALUES (?,?,?,?,?)", rows)
        db().commit()
    return jsonify(ok=True, accepted=len(rows))


@app.post("/api/me/password")
@api_auth_required
def password_change():
    u = current_user()
    body = request.get_json(silent=True) or {}
    current = str(body.get("current") or "")
    nxt = str(body.get("next") or "")
    if not check_password_hash(u["password_hash"], current):
        return jsonify(error="wrong_password"), 401
    if not (8 <= len(nxt) <= 128):
        return bad_request("weak_password")
    pv = u["pw_version"] + 1  # 旧设备全部下线，当前会话续发新 cookie
    db().execute("UPDATE users SET password_hash=?, pw_version=? WHERE id=?", (generate_password_hash(nxt), pv, u["id"]))
    db().commit()
    session["pv"] = pv
    return jsonify(ok=True)


@app.get("/api/healthz")
def healthz():
    return jsonify(ok=True)


# ---------------- 分享短链：会话链 900+ 字符，微信/QQ 对超长 URL 不抓卡片 ----------------
SHARE_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz"  # 去 0/1/o/i/l 等易混字符，31^6≈8.9 亿
SHARE_CODE_LEN = 6
# 只收本站自己的会话链（防开放重定向）；s 参数限 URL 安全字符集，hash 同理——尖括号根本进不来
SHARE_TARGET_RE = re.compile(
    r"^https://xneva-ai\.com/(preview/)?\?s=[A-Za-z0-9+_.~%-]{1,3000}"
    r"(&from=(direct|qq|bili|douyin))?(#[A-Za-z0-9_.~%-]{0,64})?$"
)


@app.post("/api/share")
def api_share_create():
    if not rate_ok(f"share:{client_ip()}", 30, 3600):
        return jsonify(error="rate_limited"), 429
    target = str((request.get_json(silent=True) or {}).get("url") or "")
    if not SHARE_TARGET_RE.fullmatch(target):
        return bad_request("bad_request")
    for _ in range(5):  # 码空间 8.9 亿，撞码重试足矣
        code = "".join(secrets.choice(SHARE_ALPHABET) for _ in range(SHARE_CODE_LEN))
        try:
            db().execute("INSERT INTO share_links (code, target, created_at) VALUES (?,?,?)", (code, target, now()))
            db().commit()
            return jsonify(code=code)
        except sqlite3.IntegrityError:
            continue
    return jsonify(error="busy"), 503


@app.get("/s/<code>")
def share_redirect(code):
    if len(code) != SHARE_CODE_LEN or any(c not in SHARE_ALPHABET for c in code):
        abort(404)
    row = db().execute("SELECT target FROM share_links WHERE code=?", (code,)).fetchone()
    if row is None:
        abort(404)
    target = row["target"]
    safe = html.escape(target, quote=True)  # 正则白名单之外的双保险
    # 中转页而不做 302：OG 标签静态写死在这里，爬虫把它当最终页面读。跳转只靠 JS——
    # meta refresh 会被爬虫当重定向跟随，落到 900+ 字符长链上，微信/QQ 又不抓超长 URL 的卡片
    return f"""<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <title>紫卡罗盘 · 裂罅洗卡与行情规划器</title>
    <meta name="description" content="贴一张紫卡截图，算出每一步该锁哪条、还要洗多少次、要烧多少赤毒；同时算清配卡伤害、击杀耗时与行情利润。" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="紫卡罗盘" />
    <meta property="og:locale" content="zh_CN" />
    <meta property="og:title" content="紫卡罗盘 · 裂罅洗卡与行情规划器" />
    <meta property="og:description" content="贴一张紫卡截图，算出每一步该锁哪条、还要洗多少次、要烧多少赤毒；配卡伤害与行情利润一并算清。" />
    <meta property="og:url" content="https://xneva-ai.com/" />
    <meta property="og:image" content="https://xneva-ai.com/og-cover.jpg" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:alt" content="紫卡罗盘：裂罅洗卡与行情规划器" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="紫卡罗盘 · 裂罅洗卡与行情规划器" />
    <meta name="twitter:description" content="贴一张紫卡截图，算出每一步该锁哪条、还要洗多少次、要烧多少赤毒；配卡伤害与行情利润一并算清。" />
    <meta name="twitter:image" content="https://xneva-ai.com/og-cover.jpg" />
  </head>
  <body>
    正在打开分享的紫卡……<noscript>浏览器不支持自动跳转，<a href="{safe}">点这里</a>手动打开。</noscript>
    <script>location.replace({json.dumps(target)});</script>
  </body>
</html>"""


# ---------------- 管理后台（服务器渲染，单管理员场景） ----------------
def admin_required(f):
    @wraps(f)
    def wrapper(*a, **kw):
        u = current_user()
        if u is None:
            abort(401)
        if not u["is_admin"]:
            abort(403)
        if request.method == "POST":  # 表单 CSRF：会话令牌 + 隐藏域。会话还没有令牌时（刚登录、未开过后台页面）一律拒绝，不给 None==None 放行
            if not session.get("csrf") or request.form.get("csrf") != session["csrf"]:
                abort(400)
        return f(*a, **kw)

    return wrapper


def ensure_csrf() -> str:
    if "csrf" not in session:
        session["csrf"] = secrets.token_hex(16)
    return session["csrf"]


@app.get("/admin")
def admin_root():
    return redirect("/admin/")


@app.get("/admin/")
@admin_required
def admin_dashboard():
    d = db()
    today = now()[:10]
    week_ago = (datetime.now(CST) - timedelta(days=6)).strftime("%Y-%m-%d")
    stats = {
        "users_total": d.execute("SELECT COUNT(*) c FROM users").fetchone()["c"],
        "users_7d": d.execute("SELECT COUNT(*) c FROM users WHERE created_at>=?", (week_ago,)).fetchone()["c"],
        "logins_today": d.execute("SELECT COUNT(*) c FROM events WHERE type='login' AND day=?", (today,)).fetchone()["c"],
        "synced": d.execute("SELECT COUNT(*) c FROM user_state").fetchone()["c"],
    }
    by_day = d.execute(
        "SELECT day, type, COUNT(*) c FROM events WHERE day>=? GROUP BY day, type ORDER BY day DESC, c DESC", (week_ago,)
    ).fetchall()
    recent = d.execute(
        "SELECT u.*, (SELECT COUNT(*) FROM events e WHERE e.user_id=u.id AND e.day>=?) ev7 "
        "FROM users u ORDER BY u.id DESC LIMIT 10",
        (week_ago,),
    ).fetchall()
    return render_template("dashboard.html", u=current_user(), stats=stats, by_day=by_day, recent=recent, csrf=ensure_csrf())


@app.get("/admin/users")
@admin_required
def admin_users():
    q = (request.args.get("q") or "").strip()
    week_ago = (datetime.now(CST) - timedelta(days=6)).strftime("%Y-%m-%d")
    if q:  # LIKE 转义：用户输入里的 % _ \ 不当通配符
        esc = q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        rows = db().execute(
            "SELECT u.*, (SELECT COUNT(*) FROM events e WHERE e.user_id=u.id AND e.day>=?) ev7, "
            "(SELECT updated_at FROM user_state s WHERE s.user_id=u.id) synced_at "
            "FROM users u WHERE u.email LIKE ? ESCAPE '\\' ORDER BY u.id DESC LIMIT 100",
            (week_ago, f"%{esc}%"),
        ).fetchall()
    else:
        rows = db().execute(
            "SELECT u.*, (SELECT COUNT(*) FROM events e WHERE e.user_id=u.id AND e.day>=?) ev7, "
            "(SELECT updated_at FROM user_state s WHERE s.user_id=u.id) synced_at "
            "FROM users u ORDER BY u.id DESC LIMIT 100",
            (week_ago,),
        ).fetchall()
    return render_template("users.html", u=current_user(), rows=rows, q=q, csrf=ensure_csrf())


@app.post("/admin/users/<int:uid>/<action>")
@admin_required
def admin_action(uid: int, action: str):
    d = db()
    row = d.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
    if row is None:
        abort(404)
    back = url_for("admin_users", q=request.form.get("q") or "")
    if action == "ban":
        d.execute("UPDATE users SET banned=1 WHERE id=?", (uid,))
        flash(f"{row['email']} 已封禁")
    elif action == "unban":
        d.execute("UPDATE users SET banned=0 WHERE id=?", (uid,))
        flash(f"{row['email']} 已解封")
    elif action == "reset-password":
        temp = secrets.token_urlsafe(9)  # 12 字符，显示一次
        d.execute("UPDATE users SET password_hash=?, pw_version=pw_version+1 WHERE id=?", (generate_password_hash(temp), uid))
        flash(f"{row['email']} 的临时密码：{temp}（只显示这一次，请转告用户尽快修改）")
    elif action == "plan":
        plan = request.form.get("plan") or "free"
        if plan not in ("free", "pro"):
            plan = "free"
        d.execute("UPDATE users SET plan=? WHERE id=?", (plan, uid))
        flash(f"{row['email']} 套餐改为 {plan}")
    else:
        abort(404)
    d.commit()
    return redirect(back)


@app.errorhandler(401)
@app.errorhandler(403)
def _admin_denied(err):
    if request.path.startswith("/api/"):
        return jsonify(error="forbidden"), err.code
    return render_template("denied.html", code=err.code), err.code


@app.errorhandler(404)
def _not_found(err):
    if request.path.startswith("/api/"):
        return jsonify(error="not_found"), 404
    return "<h1>404</h1>", 404


if __name__ == "__main__":
    init_db()
    app.run(host="127.0.0.1", port=8100, debug=False)
else:
    if DB_PATH.parent.exists():
        init_db()  # import 即建表（gunicorn/自测共用）
