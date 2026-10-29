#!/usr/bin/env python3
"""api/app.py 全链路自测：RR_API_DEV=1 + 临时库，test_client 模拟浏览器。
跑法：python3 selftest.py  （无需网络与外部依赖，有 flask 即可）"""
import os
import re
import sys
import tempfile
from pathlib import Path

os.environ["RR_API_DEV"] = "1"
os.environ["RR_API_DB"] = str(Path(tempfile.mkdtemp()) / "selftest.db")

sys.path.insert(0, str(Path(__file__).resolve().parent))
import app as api  # noqa: E402

c = api.app.test_client()
PASS = []


def ok(name, cond, extra=""):
    if not cond:
        print(f"FAIL {name} {extra}")
        sys.exit(1)
    PASS.append(name)


def jget(path, **kw):
    r = c.get(path, **kw)
    return r, (r.get_json(silent=True) or {})


def jpost(path, body=None, **kw):
    r = c.post(path, json=body or {}, **kw)
    return r, (r.get_json(silent=True) or {})


# ---- 基础 ----
r, j = jget("/api/healthz")
ok("healthz", r.status_code == 200 and j.get("ok") is True)

# ---- 注册 ----
r, j = jpost("/api/auth/register", {"email": "A@Example.com", "password": "password123"})
ok("register", r.status_code == 200 and j["user"]["email"] == "a@example.com", str(j))
r, j = jpost("/api/auth/register", {"email": "a@example.com", "password": "password123"})
ok("register duplicate -> email_taken", r.status_code == 409 and j["error"] == "email_taken")
r, j = jpost("/api/auth/register", {"email": "bad", "password": "password123"})
ok("register bad email", r.status_code == 400 and j["error"] == "bad_email")
r, j = jpost("/api/auth/register", {"email": "b@example.com", "password": "short"})
ok("register weak password", r.status_code == 400 and j["error"] == "weak_password")
cb = api.app.test_client()  # 独立客户端注册 b，别把 c 的会话顶掉
r = cb.post("/api/auth/register", json={"email": "b@example.com", "password": "password123"})
j = r.get_json(silent=True) or {}
ok("register second user", r.status_code == 200 and j["user"]["id"] == 2, str(j))

# ---- me / 登出 / 登录 ----
r, j = jget("/api/auth/me")
ok("me after register", j.get("user", {}).get("email") == "a@example.com")
r, j = jpost("/api/auth/logout")
ok("logout", r.status_code == 200)
r, j = jget("/api/auth/me")
ok("me after logout null", j.get("user") is None)
r, j = jpost("/api/auth/login", {"email": "A@EXAMPLE.COM", "password": "wrong-password"})
ok("login wrong -> invalid_credentials", r.status_code == 401 and j["error"] == "invalid_credentials")
r, j = jpost("/api/auth/login", {"email": "a@example.com", "password": "password123"})
ok("login (大小写不敏感)", r.status_code == 200 and j["user"]["email"] == "a@example.com")

# ---- 会话云同步 ----
r, j = jget("/api/me/state")
ok("state empty at first", j.get("data") is None and j.get("updated_at") is None)
state = {"version": 2, "lang": "zh", "weaponId": "Acceltra"}
r = c.put("/api/me/state", json={"data": state})
j = r.get_json(silent=True) or {}
ok("state put", r.status_code == 200 and "updated_at" in j)
r, j = jget("/api/me/state")
ok("state roundtrip", isinstance(j.get("data"), dict) and j["data"]["weaponId"] == "Acceltra")
r = c.put("/api/me/state", json={"data": "not a dict"})
ok("state rejects non-object", r.status_code == 400)
r = c.put("/api/me/state", json={"data": {"blob": "x" * 200_000}})
j = r.get_json(silent=True) or {}
ok("state rejects oversized", r.status_code == 400 and j["error"] == "state_too_large")

# ---- 计量 ----
r, j = jpost("/api/me/events", {"events": [{"type": "page", "route": "market"}, {"type": "ocr"}, {"type": "hack"}]})
ok("events whitelist", r.status_code == 200 and j["accepted"] == 2, str(j))
r, j = jget("/api/me/state")
ok("events endpoint keeps state intact", j["data"]["weaponId"] == "Acceltra")

# ---- 未登录守卫 ----
c2 = api.app.test_client()
r = c2.get("/api/me/state")
ok("state requires login", r.status_code == 401 and (r.get_json(silent=True) or {}).get("error") == "unauthorized")
r = c2.post("/api/me/events", json={"events": [{"type": "page"}]})
ok("events requires login", r.status_code == 401)

# ---- 改密互踢：设备 B 改密后，设备 A 的 cookie 立即失效 ----
ra = api.app.test_client()
rb = api.app.test_client()
jpost_login = lambda cl: cl.post("/api/auth/login", json={"email": "a@example.com", "password": "password123"})  # noqa: E731
ok("A logs in", jpost_login(ra).status_code == 200)
ok("B logs in", jpost_login(rb).status_code == 200)
r = rb.post("/api/me/password", json={"current": "password123", "next": "password456"})
ok("B changes password", r.status_code == 200)
r = ra.get("/api/auth/me")
j = r.get_json(silent=True) or {}
ok("A kicked after password change", r.status_code == 200 and j.get("user") is None)
r = rb.get("/api/auth/me")
j = r.get_json(silent=True) or {}
ok("B still logged in", j.get("user") is not None)
r = rb.post("/api/me/password", json={"current": "wrong", "next": "password789"})
j = r.get_json(silent=True) or {}
ok("wrong current password", r.status_code == 401 and j["error"] == "wrong_password")

# ---- 封禁 ----
r, j = jpost("/api/auth/login", {"email": "a@example.com", "password": "password456"})
assert r.status_code == 200
conn = api.sqlite3.connect(os.environ["RR_API_DB"])
conn.execute("UPDATE users SET banned=1 WHERE email='a@example.com'")
conn.commit()
conn.close()
r = c.post("/api/auth/login", json={"email": "a@example.com", "password": "password456"})
j = r.get_json(silent=True) or {}
ok("banned -> 403", r.status_code == 403 and j["error"] == "banned")
r = c.get("/api/auth/me")
ok("banned session invalidated", (r.get_json(silent=True) or {}).get("user") is None)
conn = api.sqlite3.connect(os.environ["RR_API_DB"])
conn.execute("UPDATE users SET banned=0 WHERE email='a@example.com'")
conn.commit()
conn.close()

# ---- 后台权限 ----
r = c.get("/admin/")
ok("admin denied for non-admin (403)", r.status_code == 403)
conn = api.sqlite3.connect(os.environ["RR_API_DB"])
conn.execute("UPDATE users SET is_admin=1 WHERE email='a@example.com'")
conn.commit()
conn.close()
r = c.post("/api/auth/login", json={"email": "a@example.com", "password": "password456"})
assert r.status_code == 200
# 会话刚建立、还没打开过后台页面（session 尚无 csrf）：不带 token 的 POST 也必须 400，不能 None==None 放行
r = c.post("/admin/users/2/ban", data={"q": ""})
ok("admin POST before first page load rejected (no session csrf yet)", r.status_code == 400)
r = c.get("/admin/")
ok("admin dashboard renders", r.status_code == 200 and "仪表盘" in r.get_data(as_text=True))
r = c.get("/admin/users")
html = r.get_data(as_text=True)
ok("admin users page renders", r.status_code == 200 and "a@example.com" in html)
csrf = re.search(r'name="csrf" value="([0-9a-f]+)"', html).group(1)

# CSRF 负向
r = c.post("/admin/users/1/ban", data={"csrf": "deadbeef"})
ok("admin CSRF rejected", r.status_code == 400)
# 封禁 → 解封 → 重置密码 → plan
r = c.post("/admin/users/2/ban", data={"csrf": csrf, "q": ""}, follow_redirects=True)
ok("admin ban user", r.status_code == 200 and "已封禁" in r.get_data(as_text=True))
r = c.post("/admin/users/2/unban", data={"csrf": csrf, "q": ""}, follow_redirects=True)
ok("admin unban user", "已解封" in r.get_data(as_text=True))
r = c.post("/admin/users/2/reset-password", data={"csrf": csrf, "q": ""}, follow_redirects=True)
page = r.get_data(as_text=True)
temp = re.search(r"临时密码：([A-Za-z0-9_-]{10,16})", page)
ok("admin reset-password shows temp once", temp is not None)
r = c2.post("/api/auth/login", json={"email": "b@example.com", "password": temp.group(1)})
ok("login with temp password works", r.status_code == 200)
r = c.post("/admin/users/2/plan", data={"csrf": csrf, "plan": "pro", "q": ""}, follow_redirects=True)
ok("admin set plan pro", "套餐改为 pro" in r.get_data(as_text=True))

# ---- 搜索转义 ----
r = c.get("/admin/users?q=100%25")
ok("admin search with % escapes cleanly", r.status_code == 200)

# ---- 分享短链（公开端点，无需登录） ----
r, j = jpost("/api/share", {"url": "https://xneva-ai.com/?s=AbCdEfGh1234&from=direct"})
share_code = j.get("code") or ""
ok("share create", r.status_code == 200 and re.fullmatch(r"[0-9a-z]{6}", share_code) is not None, str(j))
r, j = jpost("/api/share", {"url": "https://evil.example.com/?s=abc"})
ok("share rejects foreign host", r.status_code == 400)
r, j = jpost("/api/share", {"url": "https://xneva-ai.com/"})
ok("share rejects url without session", r.status_code == 400)
r = c.get(f"/s/{share_code}")
page = r.get_data(as_text=True)
ok("share page carries og tags and target", r.status_code == 200 and 'property="og:image"' in page and "s=AbCdEfGh1234" in page)
r = c.get("/s/zzzzzz")
ok("share unknown code 404", r.status_code == 404)
r = c.get("/s/short1")
ok("share bad-shaped code 404", r.status_code == 404)

# ---- 限流（独立 IP 打登录） ----
rl = api.app.test_client()
hits = [rl.post("/api/auth/login", json={"email": "x@y.z", "password": "nope"}, headers={"X-Forwarded-For": "9.9.9.9"}) for _ in range(21)]
ok("rate limit kicks in", hits[-1].status_code == 429 and hits[0].status_code == 401)

print(f"selftest: {len(PASS)} 项全部通过")
for p in PASS:
    print(f"  ✓ {p}")
