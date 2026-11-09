// 出口被 Cloudflare 挑战时的兜底：用真实浏览器打开 warframe.market，等挑战通过，
// 把 Cookie（含 cf_clearance）与浏览器 UA 输出成环境变量，供 wm_pipeline.py 复用。
// Cookie 与 UA 绑定同一个浏览器指纹，保证 cf_clearance 校验一致。
// CI 里运行前需：npm i --no-save playwright && npx playwright install --with-deps chromium
// 用法：node get_clearance.mjs > clearance.env
import fs from "node:fs";
import { chromium } from "playwright";

const cfg = JSON.parse(fs.readFileSync(new URL("./config.ci.json", import.meta.url), "utf8"));
const trace = cfg.wm.sentry_trace;

const browser = await chromium.launch({
  channel: "chromium", // 完整 Chromium 的新无头模式，过挑战成功率远高于 headless shell
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-blink-features=AutomationControlled"],
});
const ctx = await browser.newContext({ locale: "en-US", viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await page.goto("https://warframe.market/auctions", { waitUntil: "domcontentloaded", timeout: 90000 });

let passed = false;
for (let i = 0; i < 30; i++) {
  await page.waitForTimeout(2000);
  try {
    const title = (await page.title()).toLowerCase();
    const body = (await page.innerText("body")).slice(0, 300).toLowerCase();
    if (!title.includes("just a moment") && !body.includes("just a moment")) {
      passed = true;
      break;
    }
  } catch {
    // 页面正在跳转
  }
}
if (!passed) {
  console.error("cloudflare challenge did not clear");
  await browser.close();
  process.exit(1);
}

// 让页面自己调一次接口，确保 api 域名的 Cookie（如有）也落下来
try {
  await page.evaluate(async (tok) => {
    const r = await fetch(
      "https://api.warframe.market/v1/auctions/search?type=riven&sort_by=price_asc&weapon_url_name=kuva_bramma",
      {
        headers: { accept: "application/json", platform: "pc", language: "en", crossplay: "true", "sentry-trace": tok },
      },
    );
    return r.status;
  }, trace);
} catch {
  // 接口调用失败不影响 Cookie 收集
}

const jar = new Map();
for (const c of await ctx.cookies()) jar.set(c.name, c.value);
const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
const ua = await page.evaluate(() => navigator.userAgent);
await browser.close();

if (!cookie) {
  console.error("no cookies collected");
  process.exit(1);
}
console.log(`export WM_COOKIE='${cookie}'`);
console.log(`export WM_UA='${ua}'`);
console.error(`cookies: ${[...jar.keys()].sort().join(", ")}`);
