/**
 * 分享链接：把主页会话（武器 + 紫卡 + 洗卡目标 + 赤毒预算 + 倾向）压进 URL 的 ?s= 参数，
 * 收到链接的人确认后导入本机。进度日志（step/total/log/counted）和界面语言是各台设备
 * 自己的事，不进链接；带 v 版本号，结构变化时旧链接按需降级或拒绝，而不是白屏。
 * v2 起武器只写叶子名——完整 /Lotus/ 路径 ~70 字符占链接大头；v1 老链接继续可读。
 */
import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from "lz-string";
import { GAME } from "./engine/data";
import { repairSession, SESSION_VERSION, type Session } from "./state";

/** 分享编码格式的版本：负载结构变化时 +1，decode 只认写过的格式 */
const SHARE_VERSION = 2;

/** 叶子名（id 最后一段）-> 完整路径；重名叶子不进表，编码端宁可写全路径也不写歧义名 */
const BY_LEAF: ReadonlyMap<string, string> = (() => {
  const m = new Map<string, string>();
  for (const w of GAME.weapons) {
    const leaf = w.id.slice(w.id.lastIndexOf("/") + 1);
    m.set(leaf, m.has(leaf) ? "" : w.id);
  }
  return m;
})();

/** 全路径在叶子表里唯一对应时缩成叶子名，否则原样写出（别名等罕见情况） */
function shortWeapon(id: string): string {
  const leaf = id.slice(id.lastIndexOf("/") + 1);
  return BY_LEAF.get(leaf) === id ? leaf : id;
}

/** v2 的 w 还原成完整路径：带 / 的按全路径读（防御），否则查叶子表；认不出给空串 */
function fullWeapon(w: string): string {
  return w.includes("/") ? w : (BY_LEAF.get(w) ?? "");
}

/** 会话里值得分享的部分（version 是 repairSession 读的会话保存版本，别和 v 混了） */
export function encodeSession(s: Session): string {
  const payload = {
    v: SHARE_VERSION,
    version: SESSION_VERSION,
    w: s.weaponId ? shortWeapon(s.weaponId) : null,
    card: s.card,
    target: s.target,
    kuva: s.kuva,
    disposition: s.disposition,
  };
  return compressToEncodedURIComponent(JSON.stringify(payload));
}

/** 分享 URL：?s= 压缩会话 + from= 渠道（nginx 日志可统计各入口的分享打开量），hash 一并保留 */
export function shareUrl(s: Session, from: string): string {
  return `${location.origin}${location.pathname}?s=${encodeSession(s)}&from=${from}${location.hash}`;
}

/**
 * 分享渠道（from= 的真实来源）：链接本身带 from 就续传（转来的再转出去仍算最初渠道）；
 * 否则按 referrer 认 QQ / B 站 / 抖音（微信不传 referrer，只能算 direct）；都看不出就是 direct。
 */
export function shareChannel(): string {
  try {
    const inUrl = new URLSearchParams(location.search).get("from");
    if (inUrl) return inUrl;
    if (document.referrer) {
      const host = new URL(document.referrer).hostname;
      if (/(^|\.)qq\.com$/i.test(host)) return "qq";
      if (/(^|\.)bilibili\.com$/i.test(host) || /(^|\.)b23\.tv$/i.test(host)) return "bili";
      if (/(^|\.)douyin\.com$/i.test(host) || /(^|\.)iesdouyin\.com$/i.test(host)) return "douyin";
    }
  } catch {
    // referrer 不可读或不是 URL：当作直接进入
  }
  return "direct";
}

/** null = 链接读不出来或内容无效（压缩坏、版本太新、武器不认识）；调用方给提示，不白屏 */
export function decodeSession(code: string): Session | null {
  if (!code) return null;
  let saved: unknown;
  try {
    const json = decompressFromEncodedURIComponent(code);
    if (!json) return null;
    saved = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof saved !== "object" || saved === null) return null;
  const payload = saved as { v?: unknown; w?: unknown };
  // v1 写的是完整 weaponId；v2 把武器缩成叶子名放在 w 里，还原成 repairSession 认的字段
  if (payload.v === 2) {
    (saved as Record<string, unknown>).weaponId = typeof payload.w === "string" ? fullWeapon(payload.w) || null : null;
  } else if (payload.v !== 1) return null;
  // repairSession 逐字段防御坏数据；武器是分享的主体，读不出武器就整条作废
  const restored = repairSession(saved);
  return restored.weaponId ? restored : null;
}

/** 尽力复制：剪贴板 API 不可用（权限/非安全上下文）时退回隐藏 textarea 的老办法 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // 落到下面的老办法
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}
