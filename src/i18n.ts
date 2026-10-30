// UI text. Game terms come from the game's own dictionaries (GAME.ui, stat and weapon names):
// 简中 = international client Simplified Chinese, 国服 = China server, 繁中 = international client Traditional
// Chinese, English.
import { GAME, type Lang } from "./engine/data";
import type { Unreachable } from "./engine/diagnose";
import type { CardProblem } from "./state";

const g = (k: string, l: Lang) => GAME.ui[k][l];

/** Each language named in itself (and so in every UI language alike), in full: a menu of endonyms. */
export const LANG_LABEL: Record<Lang, string> = { zh: "简体中文", cn: "国服", tc: "繁體中文", en: "English" };
/** The page's lang attribute: picks the right CJK glyphs and fonts. */
export const HTML_LANG: Record<Lang, string> = { zh: "zh-Hans", cn: "zh-Hans", tc: "zh-Hant", en: "en" };

export function strings(l: Lang) {
  const kuva = g("kuva", l);
  const lock = g("lockTrait", l);
  const splicing = g("splicing", l);
  const splicer = g("splicer", l);
  const cycleFor = (price: string) => g("cycleFor", l).replace("|PRICE|", price);
  const show = g("showRanked", l);

  if (l === "en")
    return {
      title: "RivenCompass",
      nav: { coach: "Coach", build: "Build", market: "Market", ranges: "Stat ranges", guide: "How it works" },
      /** 手机顶栏的短文案：<=720px 页签一行排完靠它 */
      navShort: { coach: "Coach", build: "Build", market: "Market", ranges: "Ranges", guide: "Guide" },
      account: {
        titleLogin: "Sign in",
        titleRegister: "Create an account",
        titleAccount: "Your account",
        email: "E-mail",
        password: "Password",
        currentPassword: "Current password",
        newPassword: "New password",
        loginSubmit: "Sign in",
        registerSubmit: "Create account",
        toRegister: "No account yet? Create one",
        toLogin: "Already have one? Sign in",
        hint: "At least 8 characters.",
        syncHint: "Sign in to sync your progress across devices — the riven you set up at home follows you on your phone.",
        privacy:
          "Your e-mail is stored only for sign-in. While signed in, the server keeps a copy of your session (for the sync) and counts feature usage — that is the foundation for future paid features.",
        logout: "Sign out",
        changePassword: "Change password",
        passwordChanged: "Password changed.",
        planFree: "Free plan",
        synced: "Synced at |T|",
        syncNone: "Not synced yet",
        error: {
          invalid: "E-mail or password is not right.",
          taken: "This e-mail already has an account — sign in instead.",
          weak: "That password is too short (at least 8 characters).",
          email: "That does not look like an e-mail address.",
          banned: "This account has been disabled.",
          rate: "Too many tries — wait a moment and try again.",
          wrong: "The current password is not right.",
          network: "Something went wrong on the network — try again.",
        },
      },
      crash: {
        message: "Something went wrong drawing this page. Your session is saved — trying again usually fixes it.",
        retry: "Try again",
      },
      market: {
        title: "Riven market",
        source: "Listings from warframe.market · refreshed daily",
        loading: "Loading market data…",
        error: "Market data could not be loaded.",
        retry: "Retry",
        freshHours: "Updated |H| h ago",
        freshDays: "Updated |D| d ago",
        sort: { liquidity: "Supply", price: "Median price", fresh: "Freshest", combos: "Combos", turnover: "Turnover", profit: "Profit" },
        all: "All",
        sentinel: "Sentinel",
        search: "Search weapon…",
        listings: "Listings",
        median: "median",
        hot: "Hot stat combos",
        noCombos: "No combo market yet (too few matching listings).",
        perListing: "|N| listings of this combo",
        setTarget: "Set as target",
        fillTarget: "Fill target",
        profitHint: "Rolling it yourself ≈|C| platinum (at your hourly rates, set on the coach page)",
        profitNote: "profit (platinum) = a combo's median − the expected cost to roll it yourself (kuva → platinum at your rates)",
        /** 行级利润列的口径：最优组合的利润 */
        profitRowNote: "Best profit among this weapon's hot combos (platinum): a combo's median − the expected cost to roll it yourself",
        /** 表头两列的单位标注（白金） */
        platProfit: "Profit (plat)",
        platPrice: "Median (plat)",
        /** 首屏渲染上次缓存数据时，新鲜度行旁的提示 */
        updating: "updating in the background…",
        turnoverHint: "Turnover = DE weekly trades |P| ÷ |N| listings — how fast listings actually sell",
        deRow: "|W| DE weekly trades |P| (unrolled |PU| / rerolled |PR|) · all-platform trade median ≈|M|",
        weekRange: "|A| – |B|",
      },
      profit: {
        title: "Roll or buy",
        cost: "Rolling to this target should cost",
        platUnit: "platinum",
        hours: "≈|H| h of Kuva",
        p90: "9 in 10 ≤",
        hit: "|P| within your Kuva",
        save: "Rolling is cheaper: saves ≈|P| platinum",
        buy: "Buying it outright is cheaper",
        noMarket: "No listings market for this weapon yet.",
        noMatch: "No listed combo matches this target.",
        family: "Listings sit under the base weapon |W| (a family shares one riven page)",
        similar: "similar",
        kuvaWage: "Kuva per hour",
        platWage: "Platinum per hour",
        formula: "Cost ≈ E[kuva] ÷ Kuva/h × Platinum/h · Profit = median − cost",
        formulaCalc: "Plugging in: |K| kuva ÷ |KW| kuva/h × |PW| plat/h ≈ |C| platinum",
        est: "Prices are combo medians across all rolls; the cost is exact for your tiers — read the profit as an estimate.",
      },
      contact: "Questions and suggestions: ",
      foot: {
        version: "Game data is from client builds: international |I| · China server |C|",
        thanks: "Based on |P| — with thanks",
        unofficial: "This is an unofficial fan-made tool, not affiliated with Digital Extremes. Warframe and all related names and assets are trademarks of Digital Extremes.",
      },
      disposition: {
        name: "Disposition",
        tip: "Every weapon has 1.2 since 22 October 2026. Change it only if the game changes it again, or for a screenshot from before.",
        reset: "Back to 1.2",
      },
      theme: { label: "Theme", auto: "follow the system", light: "light", dark: "dark" },
      build: {
        needWeapon: "Choose a weapon on the Coach page first.",
        riven: "Riven (read from the Coach page)",
        noRiven: "No riven recorded: bare-weapon math.",
        enemy: "Enemy",
        level: "Level",
        strip: "Armor strip",
        preset: "Archetype",
        slots: "Suggested slots",
        slotsManual: "Manual build",
        autoHint: "Following the suggestion: switching the enemy or archetype re-picks the mods. Click a mod in the pool below to take over.",
        manualHint: "Manual build: switching the enemy only recalculates damage.",
        optimize: "Optimize",
        follow: "Follow suggestion",
        clear: "Clear",
        pool: "Mod pool (click to slot / again to remove)",
        poolSearch: "Search mods",
        remove: "Remove",
        up: "Move up",
        down: "Move down",
        panel: "Damage panel",
        perShot: "Per shot",
        panelNote: "Per shot counts multishot and enemy mitigation; the type list below is raw per-projectile damage before mitigation.",
        dps: { burst: "Burst DPS", sustain: "Sustained DPS (w/ status)" },
        ttk: "Time to kill",
        enemyBody: { health: "Health", armor: "Armor", shield: "Shield" },
        marginal: "Marginal value",
        tiers: {
          title: "Tier comparison",
          none: "No riven",
          yours: "Your riven",
          expected: "Wanted riven",
          god: "God riven",
          uplift: "+|P|% vs no riven",
          expectedUp: "+|P|% vs your riven",
          reach: "|P|% of god",
        },
        /** 伤害面板前的四档结论行 */
        verdict: { yours: "Your riven: kills in |Y| (|N| bare)", expected: "wanted |E|", god: "god |G|" },
        godStats: "God stats",
        expected: { stats: "Wanted stats (from the cycling target)", missing: "No usable cycling target on the Coach page: nothing to compare against." },
        statMarginal: "Stat marginal",
        statHint: "Score change if the stat were removed: negative = removing it makes the build worse (it is pulling its weight); positive = the build scores better without it.",
        stat: { cc: "Crit chance", cd: "Crit damage", sc: "Status", ms: "Multishot", fr: "Fire rate", mag: "Magazine", rl: "Reload" },
        killStacks: "kill stacks",
        stackKill: "on kill: +|P|% |S| per stack, max |M|",
        stackBase: "on activation +|P|% |S|, ",
        condNote: "conditional bonus not counted",
        variants: "Variant",
        variantNote: "Rivens are shared across the family — the panel follows the variant picked here.",
        form: { base: "Standard", incarnon: "Incarnon" },
        formNote: "Incarnon form: numbers are per beam/projectile; the form's magazine is fixed (magazine mods do not apply); innate beams are folded into the multishot base.",
        directNote:
          "Direct damage + steady-state status: DoTs (bleed / heat / toxin / gas / blast), Viral, armor strip (Corrosive / Heat) and Magnetic (shields) are all counted in sustained DPS and time to kill. Not counted: Electricity chains (needs nearby enemies), crowd-control procs, status duration, weakpoint bonuses.",
        status: {
          procs: "Procs |N|/s",
          dot: "DoT |D|/s",
          dotDetail: "bleed |A| · heat |B| · toxin |C| · gas |D| · blast |E|",
          viral: "Viral |S| stacks, ×|M| (health)",
          magnetic: "Magnetic |S| stacks, ×|M| (shields)",
          strip: "Armor stripped: |L|",
          steadyNote: "Steady-state approximation: stacks = proc rate × window length — short fights ramp up more slowly in practice.",
        },
        weakNote: "Weakpoint crit / weakpoint damage are conditional (weakpoint hits only) and not counted.",
      },
      category: { core: "Core", element: "Elements", physical: "Physical", faction: "Faction", utility: "Utility", spliced: "Spliced" },
      search: "Search",
      noMatch: "No match",
      done: "Done",
      anyOf: "Pick several: any one of them counts.",
      undo: { label: "Undo", missed: "Counted a cycle with no luck", demo: "Loaded the example", clear: "Cleared", keep: "Kept a riven" },
      share: {
        button: "Share",
        copied: "Link copied",
        fail: "Copy did not go through — try again.",
        askTitle: "Import the shared session?",
        askBody: "The link carries a weapon, a riven, its target and the Kuva budget. Importing replaces what this page has on this device.",
        import: "Import",
        cancel: "Cancel",
        imported: "Imported the shared session",
        bad: "That share link could not be read — it may be broken, or from a newer page.",
      },
      card: {
        title: "Riven",
        weapon: "Choose weapon",
        paste: "Paste screenshot",
        pasteHint: "Ctrl+V or drop it anywhere",
        /** 触屏（pointer: coarse）的贴图提示语 */
        pasteHintTouch: "Tap to pick a screenshot, or long-press to paste",
        range: (lo: string, hi: string) => `Range ${lo} to ${hi}`,
        oldOnly: "Old rivens only: no longer rolls here",
        another: "Another",
        zoom: "Screenshot",
        loading: "Loading reader (first time, ~20 MB)…",
        reading: "Reading…",
        readIn: (sec: string) => `Read in ${sec} s`,
        failed: "Couldn't read it. Fill it in below.",
        noCard: "No riven found in that screenshot.",
        load: "The reader didn't load. Check the connection and paste again.",
        pickStat: "Stat",
        add: "Add",
        addPos: "Add a positive trait",
        addNeg: "Add a negative trait",
        remove: "Remove",
        cycles: "Cycles",
        kuvaLeft: "Left",
        invalid: `Not possible here. Is “${show}” ticked?`,
        demo: "Example",
        clear: "Clear",
      },
      target: {
        title: "Target",
        add: "Add a wanted stat",
        addAlt: "Another target",
        quick: {
          label: "Type a target",
          placeholder: "Type a target, e.g. dmg ms fr any neg",
          apply: "Fill in",
          help: "What you can type",
          rules: [
            ["dmg ms fr · cc cd", "Damage, Multishot, Fire Rate, crit chance and damage: official names and short forms"],
            ["corrosive or viral · corr/viral", "either one"],
            ["; or a new line", "another target"],
            ["hi ms · ms 110 · tox 1.05", "tier, shown value, roll"],
            ["any neg · no neg · neg zoom", "negatives"],
            ["3+1", "layout"],
          ] as [string, string][],
          unknown: "Not understood",
          // punctuation around what was read: "Not understood: aa, bb", "Damage (can't roll on this weapon)"
          colon: ": ",
          list: ", ",
          note: (why: string) => ` (${why})`,
          negAny: "Any negative",
          negList: "Accept",
          why: { class: "not on this class", weapon: "can't roll on this weapon", full: "3 per target", spliced: "one spliced trait per riven", sets: "4 targets at most" },
        },
        or: "or",
        removeSet: "Remove this target",
        preset: { any: "Any", mid: "Mid", hi: "High" },
        roll: "Roll ≥",
        value: "Value",
        never: "out of reach",
        negatives: "Negative",
        noNeg: "None wanted",
        accept: "Accept",
        all: "All",
        none: "None",
        layouts: "Layout",
        more: "Tiers & count",
        tiers: "Tiers",
        atLeast: "At least",
        reach: "reach",
        atLeastNote: (ks: [string, number][], tier: string) => `Also: at least ${ks.map(([set, k]) => (set ? `${k} in ${set}` : k)).join(", ")} of the wanted stats reach ${tier}`,
        range: (text: string) => `Range ${text}`,
        oneSpliced: "A riven holds one spliced trait; another row has one.",
      },
      routes: {
        title: "Next move",
        sort: { kuva: `Least ${kuva}`, budget: "Within budget", cycles: "Fewest cycles" },
        sortTip: {
          kuva: `Lowest average ${kuva} first`,
          cycles: "Fewest cycles on average first",
          budget: `Highest chance to finish with the ${kuva} you have first`,
        },
        perCycle: (p: string, n: string) => `${p} per cycle, about ${n} cycles`,
        cycles: (n: string) => `≈ ${n} cycles`,
        totalCycles: (n: string) => `${n} cycles`,
        spreadCycles: (n: string) => n,
        totalTip: { kuva: "Average total Kuva to finish, later steps included", cycles: "Average total cycles to finish, later steps included" },
        p90: "90%",
        median: "median",
        within: "within budget",
        rec: "Best",
        none: "Cycle, no lock",
        keepSpliced: (x: string) => `Cycle, ${x} stays locked`,
        drop: (x: string) => `Unlock ${x}, cycle`,
        dropAnd: (x: string, then: string) => `Unlock ${x} · ${then}`,
        lock: (x: string) => `${lock}: ${x}`,
        lockNeg: (x: string) => `${lock}: −${x}`,
        splice: (a: string, b: string, r: string) => `${splicing}: ${a} + ${b} → ${r}`,
        keepWhen: "Keep new on",
        negOk: "accepted negative",
        negBecomesOk: "an accepted negative instead",
        betterMix: "a better mix",
        anyOf: (n: number) => `any ${n} of`,
        restCompare: "anything else: paste it to compare",
        allCompare: "paste the new riven to compare",
        computing: "Working out routes…",
        failed: (code: string) =>
          code === "start-failed"
            ? "The calculator did not start. Try again or reload the page."
            : code === "too-complex"
              ? "This target needs too much calculation and was stopped. Use fewer alternatives, fewer stats per row or lower bars."
              : code === "timeout"
                ? "The calculation ran over 30 seconds and was stopped. Try again."
                : "The calculation stopped. Try again.",
        retry: "Try again",
        reload: "Reload page",
        done: "This riven already meets the target.",
        why: (r: Unreachable, name: (tag: string) => string) => {
          switch (r.kind) {
            case "barTooHigh":
              return `The bar for ${r.tags.map(name).join(" / ")} is above the best roll (1.10) in the chosen layouts.`;
            case "tooMany":
              return `The target wants ${r.need} stats; the chosen layouts have at most ${r.max} positives.`;
            case "noNegative":
              return "Every chosen layout has a negative, but no negative is accepted.";
            case "cannotRoll": {
              const x = r.tags.map(name).join(" / ");
              if (r.onCard === "none") return `${x} cannot roll on this weapon.`;
              if (r.onCard === "bar") return `${x} no longer rolls on this weapon; the one on the riven is kept, but it is under the bar.`;
              return `${x} no longer rolls on this weapon; the one on the riven is kept, but the target does not take its ${r.layout[0]}+${r.layout[1]} layout, and changing the layout would cycle it away.`;
            }
            default:
              return "This target can't be reached with these settings.";
          }
        },
        needWeapon: "Paste a screenshot or choose a weapon.",
        needGroups: "Add a wanted stat.",
        needCard: "Finish the riven above.",
        cardProblem: (p: CardProblem, name: (tag: string) => string, value: (tag: string, n: number) => string) => {
          switch (p.kind) {
            case "cycles":
              return "Cycles done must be 0 or a whole number.";
            case "duplicate":
              return `${name(p.tag)} is on the riven twice; each stat appears once.`;
            case "notPositive":
              return `${name(p.tag)} can't be a positive trait.`;
            case "notNegative":
              return `${name(p.tag)} can't be a negative trait.`;
            case "twoSpliced":
              return "A riven holds only one spliced trait.";
            case "impossible":
              return `${name(p.tag)} can't show ${value(p.tag, p.shown)} on a ${p.layout.pos}+${p.layout.neg} riven. Check the number and its sign, and that “${show}” is ticked in game.`;
            default:
              return "Finish the riven above.";
          }
        },
        splicers: splicer,
      },
      steps: {
        unlock: `Unlock any locked trait`,
        keepSpliced: (x: string) => `Keep only ${x} locked`,
        dropSpliced: (x: string) => `Click ${x} to remove its lock (it no longer helps the target; this spends no splicer)`,
        lock: (x: string) => `${lock} → ${x}`,
        alsoKept: (x: string) => ` (${x} keeps its own lock and stays)`,
        cycle: (price: string) => cycleFor(price),
        splice: (a: string, b: string, r: string) => `${splicing}: ${a} + ${b} → ${r}`,
        missed: "Missed · kept old",
        paste: "Paste new screenshot",
        step: "This step",
        spent: `Step ${kuva}`,
        total: "Total",
        of: (n: string) => `/ ≈${n}`,
      },
      compare: {
        title: "Old or new?",
        old: "Old",
        new: "New",
        keep: (w: string) => `Keep ${w}`,
        better: "better",
        saves: (n: string) => `saves ≈ ${n}`,
        cycles: (n: string) => `${n} cycles`,
        savesCycles: (n: string) => `saves ≈ ${n} cycles`,
      },
      ranges: {
        title: "Stat ranges",
        view: { class: "By weapon class", layout: "By layout" },
        sign: "Positive or negative",
        weapon: "Filter by weapon",
        stat: "Stat",
        neg: "Negative",
        cannot: "can't roll",
        roll: "roll",
        out: "out of range",
        value: "Value",
        checkHint: "Click a stat and type a value to see its roll",
        note: "Max-rank values, roll 0.90–1.10,",
      },
      kuva,
    };

  if (l === "tc")
    return {
      title: "紫卡羅盤",
      nav: { coach: "助手", build: "配卡", market: "行情", ranges: "詞條範圍", guide: "機制說明" },
      /** 手机顶栏的短文案：<=720px 页签一行排完靠它 */
      navShort: { coach: "助手", build: "配卡", market: "行情", ranges: "詞條", guide: "機制" },
      account: {
        titleLogin: "登入",
        titleRegister: "註冊帳號",
        titleAccount: "我的帳號",
        email: "信箱",
        password: "密碼",
        currentPassword: "目前密碼",
        newPassword: "新密碼",
        loginSubmit: "登入",
        registerSubmit: "註冊",
        toRegister: "還沒有帳號？註冊一個",
        toLogin: "已經有了？登入",
        hint: "至少 8 個字元。",
        syncHint: "登入後進度自動雲端同步——在家配好的紫卡，換台裝置開啟網頁接著算。",
        privacy: "註冊即表示同意：信箱僅用於登入；登入後伺服器會保存一份你的會話（用於雲同步），並統計功能使用次數——這是將來收費功能的底層資料。",
        logout: "登出",
        changePassword: "修改密碼",
        passwordChanged: "密碼已修改。",
        planFree: "免費版",
        synced: "已同步 |T|",
        syncNone: "尚未同步",
        error: {
          invalid: "信箱或密碼不正確。",
          taken: "這個信箱已註冊過，請直接登入。",
          weak: "密碼太短（至少 8 個字元）。",
          email: "這看起來不像一個信箱地址。",
          banned: "此帳號已被停用。",
          rate: "嘗試太頻繁了，休息一下再試。",
          wrong: "目前密碼不正確。",
          network: "網路出了點問題，請重試。",
        },
      },
      crash: { message: "頁面繪製出錯了，你的進度已保存——重試通常就能恢復。", retry: "重試" },
      market: {
        title: "紫卡行情",
        source: "掛單資料來自 warframe.market · 每日更新",
        loading: "正在載入行情資料…",
        error: "行情資料載入失敗。",
        retry: "重試",
        freshHours: "|H| 小時前更新",
        freshDays: "|D| 天前更新",
        sort: { liquidity: "在架量", price: "中位價", fresh: "最新鮮", combos: "組合數", turnover: "週轉", profit: "利潤" },
        all: "全部",
        sentinel: "同伴武器",
        search: "搜尋武器…",
        listings: "在架掛單",
        median: "中位",
        hot: "熱門詞條組合",
        noCombos: "暫無組合行情（同類掛單樣本不足）。",
        perListing: "同款掛單 |N| 條",
        setTarget: "設為目標",
        fillTarget: "填入目標",
        profitHint: "自己洗到它期望 ≈|C| 白金（按你的時薪，主頁可調整）",
        profitNote: "利潤（白金）= 組合中位 − 自己洗到它的期望成本（赤毒按助手頁時薪折算白金）",
        /** 行級利潤列的口徑：最優組合的利潤 */
        profitRowNote: "該武器熱門組合中的最優利潤（白金）：組合中位 − 洗到它的期望成本",
        /** 表頭兩列的單位標註（白金） */
        platProfit: "利潤（白金）",
        platPrice: "中位（白金）",
        /** 首屏渲染上次快取資料時，新鮮度行旁的提示 */
        updating: "正在背景更新…",
        turnoverHint: "週轉 = DE 週成交 |P| 筆 ÷ 在架 |N| 條——掛出去多快能出手",
        deRow: "|W| DE 週成交 |P| 筆（未洗 |PU| / 洗過 |PR|）· 全服成交中位 ≈|M|",
        weekRange: "|A|至|B|",
      },
      profit: {
        title: "洗還是買",
        cost: "自己洗到這個目標的期望成本",
        platUnit: "白金",
        hours: "≈|H| 小時",
        p90: "九成 ≤",
        hit: "現有赤毒內命中 |P|",
        save: "自己洗更划算：期望省 ≈|P| 白金",
        buy: "直接買更划算",
        noMarket: "該武器暫無在架行情。",
        noMatch: "該目標暫無相近的在架組合。",
        family: "掛單都在基礎武器 |W| 名下（同族變體共用一個紫卡頁）",
        similar: "相似",
        kuvaWage: "赤毒時薪",
        platWage: "白金時薪",
        formula: "期望成本 ≈ E[赤毒] ÷ 赤毒時薪 × 白金時薪 · 期望利潤 = 組合中位 − 期望成本",
        formulaCalc: "代入：|K| 赤毒 ÷ |KW| 赤毒/時 × |PW| 白金/時 ≈ |C| 白金",
        est: "價格為組合中位（各檔位數值混合）；成本按目標檔位精確算，利潤為約數。",
      },
      contact: "問題與建議：",
      foot: {
        version: "遊戲數據對應客戶端構建：國際服 |I| · 國服 |C|",
        thanks: "項目基於 |P| 改造，特別致謝",
        unofficial: "本工具為玩家自製的非官方工具，與 Digital Extremes 無關；Warframe 及相關名稱與素材的版權歸 Digital Extremes 所有。",
      },
      disposition: { name: "傾向", tip: "2026 年 10 月 22 日起所有武器統一為 1.2。遊戲再次調整、或看更早的截圖時才需要修改。", reset: "恢復 1.2" },
      theme: { label: "主題", auto: "跟隨系統", light: "淺色", dark: "深色" },
      build: {
        needWeapon: "先在「助手」頁選一把武器。",
        riven: "紫卡（讀取助手頁）",
        noRiven: "未錄卡：按裸武器計算。",
        enemy: "敵人",
        level: "等級",
        strip: "剝甲",
        preset: "流派",
        slots: "推薦卡槽",
        slotsManual: "手動配卡",
        autoHint: "跟隨推薦：切換敵人或流派會自動重配卡。點擊下方 Mod 庫即可轉為手動。",
        manualHint: "手動配卡：切換敵人只重算傷害，不再自動重配卡。",
        optimize: "一鍵最優",
        follow: "跟隨推薦",
        clear: "清空",
        pool: "Mod 庫（點擊裝載 / 再點移除）",
        poolSearch: "搜尋 Mod 名稱",
        remove: "移除",
        up: "上移",
        down: "下移",
        panel: "傷害面板",
        perShot: "單發傷害",
        panelNote: "單發傷害已計入多重與對敵減傷；下方分屬性為單彈丸、未計減傷的面板值。",
        dps: { burst: "爆發 DPS", sustain: "持續 DPS（含異常）" },
        ttk: "擊殺耗時",
        enemyBody: { health: "生命", armor: "護甲", shield: "護盾" },
        marginal: "邊際價值",
        tiers: {
          title: "檔位對比",
          none: "無紫卡",
          yours: "你的紫卡",
          expected: "期望紫卡",
          god: "最優紫卡",
          uplift: "較無紫卡 +|P|%",
          expectedUp: "較當前卡 +|P|%",
          reach: "達成 |P|%",
        },
        /** 傷害面板前的四檔結論行 */
        verdict: { yours: "你的紫卡：擊殺 |Y|（無紫卡 |N|）", expected: "期望 |E|", god: "最優 |G|" },
        godStats: "最優詞條",
        expected: { stats: "期望詞條（按洗卡目標折算）", missing: "主頁未設定可用的洗卡目標：暫無期望紫卡可比。" },
        statMarginal: "詞條邊際",
        statHint: "按移除該詞條後的得分變化：負值 = 去掉它你會變差（它在幹活）；正值 = 有它反而虧。",
        stat: { cc: "暴擊率", cd: "暴擊傷害", sc: "觸發", ms: "多重", fr: "射速", mag: "彈匣", rl: "裝填" },
        killStacks: "擊殺層",
        stackKill: "擊殺：每層 +|P|% |S|，最高 |M| 層",
        stackBase: "啟動 +|P|% |S|，",
        condNote: "條件詞條不計入計算",
        variants: "版本",
        variantNote: "紫卡按家族通用——面板隨此處所選版本切換。",
        form: { base: "基礎形態", incarnon: "靈化形態" },
        formNote: "靈化形態：數值為每光束／彈丸口徑；形態彈匣固定，彈匣MOD不生效；固有光束數已併入多重射擊基數。",
        directNote:
          "直傷＋異常穩態建模：流血／灼燒／中毒／毒氣／爆炸DoT、病毒增傷、腐蝕／火焰剝甲、磁力破盾均已計入持續DPS與擊殺時間；未計入：電擊鏈（需周圍敵人）、控制類觸發、觸發時長、弱點部位加成。",
        status: {
          procs: "異常觸發 |N|/s",
          dot: "異常DoT |D|/s",
          dotDetail: "流血 |A| · 灼燒 |B| · 中毒 |C| · 毒氣 |D| · 爆炸 |E|",
          viral: "病毒 |S| 層 ×|M|（生命）",
          magnetic: "磁力 |S| 層 ×|M|（護盾）",
          strip: "剝甲：|L|",
          steadyNote: "穩態近似：疊層＝觸發率×窗口時長，短戰鬥爬升期實際略低。",
        },
        weakNote: "弱點暴擊／弱點傷害為條件詞條（僅命中弱點生效），未計入。",
      },
      category: { core: "核心", element: "元素", physical: "物理", faction: "派系", utility: "其他", spliced: "拼接" },
      search: "搜尋",
      noMatch: "沒有符合的項目",
      done: "完成",
      anyOf: "可以選多個，出現任何一個都算。",
      undo: { label: "復原", missed: "已記一次沒出", demo: "已換成範例", clear: "已清除", keep: "已選好卡" },
      share: {
        button: "分享",
        copied: "連結已複製",
        fail: "複製沒有成功，請再試一次。",
        askTitle: "匯入分享的會話？",
        askBody: "連結帶著一把武器、一張紫卡、它的目標和赤毒預算。匯入會蓋掉這台裝置目前的內容，不影響對方。",
        import: "匯入",
        cancel: "取消",
        imported: "已匯入分享的會話",
        bad: "這條分享連結讀不出來——可能連結壞了，或來自較新的頁面。",
      },
      card: {
        title: "目前",
        weapon: "選擇武器",
        paste: "貼上截圖",
        pasteHint: "Ctrl+V 或拖曳到頁面任意處",
        /** 觸屏（pointer: coarse）的貼圖提示語 */
        pasteHintTouch: "點這裡選相簿截圖，或長按貼上",
        range: (lo: string, hi: string) => `範圍 ${lo} ~ ${hi}`,
        oldOnly: "現在洗不出（舊卡才有）",
        another: "換一張",
        zoom: "截圖",
        loading: "首次載入辨識模型（約 20 MB）…",
        reading: "辨識中…",
        readIn: (sec: string) => `辨識 ${sec} 秒`,
        failed: "沒認出來，請在下方手動填寫。",
        noCard: "截圖裡沒有找到特性。",
        load: "辨識模型沒有載入成功，請檢查網路後再貼一次。",
        pickStat: "特性",
        add: "新增",
        addPos: "加一條正面特性",
        addNeg: "加一條負面特性",
        remove: "刪除",
        cycles: "已循環",
        kuvaLeft: "剩餘",
        invalid: `這個數值不可能，請確認已勾選「${show}」`,
        demo: "範例",
        clear: "清除",
      },
      target: {
        title: "目標",
        add: "想要的特性",
        addAlt: "另一組目標",
        quick: {
          label: "打字設定目標",
          placeholder: "打字設定目標，如：基多射 負任意",
          apply: "填入",
          help: "可以怎麼寫",
          rules: [
            ["基多射 · 雙暴", "官方名稱和常見簡稱都認得；雙暴 = 暴擊機率 + 暴擊傷害"],
            ["腐蝕或病毒 · 腐/病", "出一個就行"],
            ["分號或換行", "另一組目標"],
            ["高雙暴 · 多重110 · 毒1.05", "檔位、數值、浮動係數"],
            ["負任意 · 不要負 · 負變焦", "負面"],
            ["3+1", "布局"],
          ] as [string, string][],
          unknown: "沒認出",
          colon: "：",
          list: "、",
          note: (why: string) => `（${why}）`,
          negAny: "負面任意",
          negList: "可接受的負面",
          why: { class: "這類武器沒有", weapon: "這把武器出不了", full: "一組最多 3 條", spliced: "每張卡只能有一條拼接特性", sets: "最多 4 組目標" },
        },
        or: "或",
        removeSet: "刪除這組目標",
        preset: { any: "不限", mid: "中", hi: "高" },
        roll: "浮動 ≥",
        value: "數值",
        never: "達不到",
        negatives: "負面",
        noNeg: "不要負面",
        accept: "可接受",
        all: "全部",
        none: "清除",
        layouts: "布局",
        more: "檔位與數量",
        tiers: "檔位",
        atLeast: "至少",
        reach: "條達到",
        atLeastNote: (ks: [string, number][], tier: string) => `另有規則：想要的特性裡${ks.map(([set, k]) => `${set ? `${set} 組` : ""}至少 ${k} 條`).join("、")}達到${tier}`,
        range: (text: string) => `範圍 ${text}`,
        oneSpliced: "每張卡只能有一條拼接特性，別的行已經選了。",
      },
      routes: {
        title: "下一步",
        sort: { kuva: `省${kuva}`, budget: `${kuva}夠用`, cycles: "省次數" },
        sortTip: {
          kuva: `平均${kuva}最少的排前面`,
          cycles: "平均循環次數最少的排前面",
          budget: `用現有${kuva}完成機率最高的排前面`,
        },
        perCycle: (p: string, n: string) => `每次循環 ${p}，平均約 ${n} 次`,
        cycles: (n: string) => `≈ ${n} 次`,
        totalCycles: (n: string) => `${n} 次`,
        spreadCycles: (n: string) => `${n} 次`,
        totalTip: { kuva: "完成平均總共花費的赤毒（含後面的步驟）", cycles: "完成平均總共循環的次數（含後面的步驟）" },
        p90: "90%",
        median: "中位",
        within: `現有${kuva}內完成`,
        rec: "薦",
        none: "不鎖定，循環",
        keepSpliced: (x: string) => `循環（「${x}」保持鎖定）`,
        drop: (x: string) => `取消「${x}」的鎖定，循環`,
        dropAnd: (x: string, then: string) => `取消「${x}」的鎖定 · ${then}`,
        lock: (x: string) => `${lock}「${x}」`,
        lockNeg: (x: string) => `${lock}「−${x}」`,
        splice: (a: string, b: string, r: string) => `${splicing}「${a}」+「${b}」→「${r}」`,
        keepWhen: "出現就選新的",
        negOk: "負面可接受",
        negBecomesOk: "負面換成可接受的",
        betterMix: "更好的組合",
        anyOf: (n: number) => `其中 ${n} 條`,
        restCompare: "其他情況：貼截圖比較",
        allCompare: "新卡好不好：貼截圖比較",
        computing: "計算中…",
        failed: (code: string) =>
          code === "start-failed"
            ? "計算模組啟動失敗，請重試或重新整理頁面。"
            : code === "too-complex"
              ? "目前目標的計算量過大，已停止。請減少「或」的組合、一行裡的可選特性或門檻再試。"
              : code === "timeout"
                ? "計算超過 30 秒，已停止。請重新計算。"
                : "計算中斷，請重新計算。",
        retry: "重新計算",
        reload: "重新整理頁面",
        done: "已經達成目標了。",
        why: (r: Unreachable, name: (tag: string) => string) => {
          switch (r.kind) {
            case "barTooHigh":
              return `「${r.tags.map(name).join("」或「")}」的門檻超過了最大浮動 1.10，在所選布局下出不來。`;
            case "tooMany":
              return `目標有 ${r.need} 條特性，所選布局最多只有 ${r.max} 條正面。`;
            case "noNegative":
              return "所選布局都帶負面，但可接受的負面一個都沒選。";
            case "cannotRoll": {
              const x = `「${r.tags.map(name).join("」或「")}」`;
              if (r.onCard === "none") return `${x}這把武器洗不出來。`;
              if (r.onCard === "bar") return `${x}這把武器已經洗不出來了，卡上原有的會保留，但達不到門檻。`;
              return `${x}這把武器已經洗不出來了，卡上原有的會保留，但它在 ${r.layout[0]}+${r.layout[1]} 的卡上，目標沒選這個布局：換布局會把它洗掉。`;
            }
            default:
              return "按照目前的設定達不到這個目標。";
          }
        },
        needWeapon: "貼一張截圖，或先選擇武器。",
        needGroups: "加一條想要的特性。",
        needCard: "把目前的卡填完整。",
        cardProblem: (p: CardProblem, name: (tag: string) => string, value: (tag: string, n: number) => string) => {
          switch (p.kind) {
            case "cycles":
              return "已循環次數要填 0 或正整數。";
            case "duplicate":
              return `「${name(p.tag)}」出現了兩次，一張卡上每種特性只有一條。`;
            case "notPositive":
              return `「${name(p.tag)}」不能作為正面特性。`;
            case "notNegative":
              return `「${name(p.tag)}」不能作為負面特性。`;
            case "twoSpliced":
              return "一張卡只能有一條拼接特性。";
            case "impossible":
              return `${p.layout.pos}+${p.layout.neg} 的卡上「${name(p.tag)}」不可能是 ${value(p.tag, p.shown)}：檢查數字和正負號，以及遊戲裡是否勾選了「${show}」。`;
            default:
              return "把目前的卡填完整。";
          }
        },
        splicers: splicer,
      },
      steps: {
        unlock: "如有鎖定，先取消",
        keepSpliced: (x: string) => `只保留「${x}」的鎖定`,
        dropSpliced: (x: string) => `點「${x}」取消它的鎖定（它對目標已經沒用，取消不會再花${splicer}）`,
        lock: (x: string) => `點「${lock}」→「${x}」`,
        alsoKept: (x: string) => `（「${x}」自帶鎖定，也會保留）`,
        cycle: (price: string) => `點「${cycleFor(price)}」`,
        splice: (a: string, b: string, r: string) => `「${splicing}」：「${a}」+「${b}」→「${r}」`,
        missed: "沒出 · 保留舊的",
        paste: "貼新截圖",
        step: "本步",
        spent: `本步${kuva}`,
        total: "累計",
        of: (n: string) => `/ ≈${n}`,
      },
      compare: {
        title: "留新的還是舊的",
        old: "舊",
        new: "新",
        keep: (w: string) => `留${w}的`,
        better: "更好",
        saves: (n: string) => `少花約 ${n}`,
        cycles: (n: string) => `${n} 次`,
        savesCycles: (n: string) => `少循環約 ${n} 次`,
      },
      ranges: {
        title: "詞條範圍",
        view: { class: "按武器類型", layout: "按詞條分布" },
        sign: "正面或負面",
        weapon: "按武器篩選",
        stat: "特性",
        neg: "負面",
        cannot: "出不了",
        roll: "浮動",
        out: "超出範圍",
        value: "數值",
        checkHint: "點特性名稱，輸入數值看浮動係數",
        note: "滿級數值，浮動 0.90–1.10，",
      },
      kuva,
    };

  return {
    title: "紫卡罗盘",
    nav: { coach: "助手", build: "配卡", market: "行情", ranges: "词条范围", guide: "机制说明" },
    /** 手机顶栏的短文案：<=720px 页签一行排完靠它 */
    navShort: { coach: "助手", build: "配卡", market: "行情", ranges: "词条", guide: "机制" },
    account: {
      titleLogin: "登录",
      titleRegister: "注册账号",
      titleAccount: "我的账号",
      email: "邮箱",
      password: "密码",
      currentPassword: "当前密码",
      newPassword: "新密码",
      loginSubmit: "登录",
      registerSubmit: "注册",
      toRegister: "还没有账号？注册一个",
      toLogin: "已经有了？登录",
      hint: "至少 8 个字符。",
      syncHint: "登录后进度自动云端同步——在家配好的紫卡，换台设备打开网页接着算。",
      privacy: "注册即表示同意：邮箱仅用于登录；登录后服务器会保存一份你的会话（用于云同步），并统计功能使用次数——这是将来收费功能的底层数据。",
      logout: "退出登录",
      changePassword: "修改密码",
      passwordChanged: "密码已修改。",
      planFree: "免费版",
      synced: "已同步 |T|",
      syncNone: "尚未同步",
      error: {
        invalid: "邮箱或密码不正确。",
        taken: "这个邮箱已注册过，请直接登录。",
        weak: "密码太短（至少 8 个字符）。",
        email: "这看起来不像一个邮箱地址。",
        banned: "此账号已被停用。",
        rate: "尝试太频繁了，休息一下再试。",
        wrong: "当前密码不正确。",
        network: "网络出了点问题，请重试。",
      },
    },
    crash: { message: "页面绘制出错了，你的进度已保存——重试通常就能恢复。", retry: "重试" },
    market: {
      title: "紫卡行情",
      source: "挂单数据来自 warframe.market · 每日更新",
      loading: "正在载入行情数据…",
      error: "行情数据载入失败。",
      retry: "重试",
      freshHours: "|H| 小时前更新",
      freshDays: "|D| 天前更新",
      sort: { liquidity: "在架量", price: "中位价", fresh: "最新鲜", combos: "组合数", turnover: "周转", profit: "利润" },
      all: "全部",
      sentinel: "同伴武器",
      search: "搜索武器…",
      listings: "在架挂单",
      median: "中位",
      hot: "热门词条组合",
      noCombos: "暂无组合行情（同类挂单样本不足）。",
      perListing: "同款挂单 |N| 条",
      setTarget: "设为目标",
      fillTarget: "填入目标",
      profitHint: "自己洗到它期望 ≈|C| 白金（按你的时薪，主页可调整）",
      profitNote: "利润（白金）= 组合中位 − 自己洗到它的期望成本（赤毒按主页时薪折算白金）",
      /** 行级利润列的口径：最优组合的利润 */
      profitRowNote: "该武器热门组合中的最优利润（白金）：组合中位 − 洗到它的期望成本",
      /** 表头两列的单位标注（白金） */
      platProfit: "利润（白金）",
      platPrice: "中位价（白金）",
      /** 首屏渲染上次缓存数据时，新鲜度行旁的提示 */
      updating: "正在后台更新…",
      turnoverHint: "周转 = DE 周成交 |P| 笔 ÷ 在架 |N| 条——挂出去多快能出手",
      deRow: "|W| DE 周成交 |P| 笔（未洗 |PU| / 洗过 |PR|）· 全服成交中位 ≈|M|",
      weekRange: "|A|至|B|",
    },
    profit: {
      title: "洗还是买",
      cost: "自己洗到这个目标的期望成本",
      platUnit: "白金",
      hours: "≈|H| 小时",
      p90: "九成 ≤",
      hit: "现有赤毒内命中 |P|",
      save: "自己洗更划算：期望省 ≈|P| 白金",
      buy: "直接买更划算",
      noMarket: "该武器暂无在架行情。",
      noMatch: "该目标暂无相近的在架组合。",
      family: "挂单都在基础武器 |W| 名下（同族变体共用一个紫卡页）",
      similar: "相似",
      kuvaWage: "赤毒时薪",
      platWage: "白金时薪",
      formula: "期望成本 ≈ E[赤毒] ÷ 赤毒时薪 × 白金时薪 · 期望利润 = 组合中位 − 期望成本",
      formulaCalc: "代入：|K| 赤毒 ÷ |KW| 赤毒/时 × |PW| 白金/时 ≈ |C| 白金",
      est: "价格为组合中位（各档位数值混合）；成本按目标档位精确算，利润为约数。",
    },
    contact: "问题和建议：",
    foot: {
      version: "游戏数据对应客户端构建：国际服 |I| · 国服 |C|",
      thanks: "项目基于 |P| 改造，特别致谢",
      unofficial: "本工具为玩家自制的非官方工具，与 Digital Extremes 无关；Warframe 及相关名称与素材的版权归 Digital Extremes 所有。",
    },
    disposition: { name: "倾向", tip: "2026 年 10 月 22 日起所有武器统一 1.2。游戏再改、或者看更早的截图时才需要改。", reset: "恢复 1.2" },
    theme: { label: "主题", auto: "跟随系统", light: "浅色", dark: "深色" },
    build: {
      needWeapon: "先在「助手」页选一把武器。",
      riven: "紫卡（读自助手页）",
      noRiven: "未录卡：按裸武器计算。",
      enemy: "敌人",
      level: "等级",
      strip: "剥甲",
      preset: "流派",
      slots: "推荐卡槽",
      slotsManual: "手动配卡",
      autoHint: "跟随推荐：切换敌人或流派会自动重配卡。点击下方 Mod 库即可转为手动。",
      manualHint: "手动配卡：切换敌人只重算伤害，不再自动重配卡。",
      optimize: "一键最优",
      follow: "跟随推荐",
      clear: "清空",
      pool: "Mod 库（点击装载 / 再点移除）",
      poolSearch: "搜索 Mod 名称",
      remove: "移除",
      up: "上移",
      down: "下移",
      panel: "伤害面板",
      perShot: "单发伤害",
      panelNote: "单发伤害已计入多重与对敌减伤；下方分属性为单弹丸、未计减伤的面板值。",
      dps: { burst: "爆发 DPS", sustain: "持续 DPS（含异常）" },
      ttk: "击杀耗时",
      enemyBody: { health: "生命", armor: "护甲", shield: "护盾" },
      marginal: "边际价值",
      tiers: {
        title: "档位对比",
        none: "无紫卡",
        yours: "你的紫卡",
        expected: "期望紫卡",
        god: "最优紫卡",
        uplift: "较无紫卡 +|P|%",
        expectedUp: "较当前卡 +|P|%",
        reach: "达成 |P|%",
      },
      /** 伤害面板前的四档结论行 */
      verdict: { yours: "你的紫卡：击杀 |Y|（无紫卡 |N|）", expected: "期望 |E|", god: "最优 |G|" },
      godStats: "最优词条",
      expected: { stats: "期望词条（按洗卡目标折算）", missing: "主页未设置可用的洗卡目标：暂无期望紫卡可比。" },
      statMarginal: "词条边际",
      statHint: "按移除该词条后的得分变化：负值 = 去掉它你会变差（它在干活）；正值 = 有它反而亏。",
      stat: { cc: "暴击率", cd: "暴击伤害", sc: "触发", ms: "多重", fr: "射速", mag: "弹匣", rl: "装填" },
      killStacks: "击杀层",
      stackKill: "击杀：每层 +|P|% |S|，最高 |M| 层",
      stackBase: "激活 +|P|% |S|，",
      condNote: "条件词条不计入计算",
      variants: "版本",
      variantNote: "紫卡按家族通用——面板随此处所选版本切换。",
      form: { base: "基础形态", incarnon: "灵化形态" },
      formNote: "灵化形态：数值为每光束/弹丸口径；形态弹匣固定，弹匣MOD不生效；固有光束数已并入多重射击基数。",
      directNote:
        "直伤+异常稳态建模：流血/灼烧/中毒/毒气/爆炸DoT、病毒增伤、腐蚀/火焰剥甲、磁力破盾均已计入持续DPS与击杀时间；未计入：电击链（需周围敌人）、控制类触发、触发时长、弱点部位加成。",
      status: {
        procs: "异常触发 |N|/s",
        dot: "异常DoT |D|/s",
        dotDetail: "流血 |A| · 灼烧 |B| · 中毒 |C| · 毒气 |D| · 爆炸 |E|",
        viral: "病毒 |S| 层 ×|M|（生命）",
        magnetic: "磁力 |S| 层 ×|M|（护盾）",
        strip: "剥甲：|L|",
        steadyNote: "稳态近似：叠层=触发率×窗口时长，短战斗爬升期实际略低。",
      },
      weakNote: "弱点暴击/弱点伤害为条件词条（仅命中弱点时生效），未计入计算。",
    },
    category: { core: "核心", element: "元素", physical: "物理", faction: "派系", utility: "其他", spliced: "熔接" },
    search: "搜索",
    noMatch: "没有匹配",
    done: "完成",
    anyOf: "可以选多个，出现任何一个都算。",
    undo: { label: "撤销", missed: "已记一次没出", demo: "已换成示例", clear: "已清空", keep: "已选好卡" },
    share: {
      button: "分享",
      copied: "链接已复制",
      fail: "复制没有成功，请再试一次。",
      askTitle: "导入分享的会话？",
      askBody: "链接带着一把武器、一张紫卡、它的洗卡目标和赤毒预算。导入会覆盖本机当前的内容，不影响对方。",
      import: "导入",
      cancel: "取消",
      imported: "已导入分享的会话",
      bad: "这条分享链接读不出来——可能链接坏了，或来自较新的页面。",
    },
    card: {
      title: "当前",
      weapon: "选择武器",
      paste: "贴截图",
      pasteHint: "Ctrl+V 或拖到页面任意处",
      /** 触屏（pointer: coarse）的贴图提示语 */
      pasteHintTouch: "点这里选相册截图，或长按粘贴",
      range: (lo: string, hi: string) => `范围 ${lo} ~ ${hi}`,
      oldOnly: "现在洗不出（旧卡才有）",
      another: "换一张",
      zoom: "截图",
      loading: "首次加载识别模型（约 20 MB）…",
      reading: "识别中…",
      readIn: (sec: string) => `识别 ${sec} 秒`,
      failed: "没认出来，在下面手动填。",
      noCard: "截图里没有找到属性。",
      load: "识别模型没加载成功，检查网络后再贴一次。",
      pickStat: "属性",
      add: "添加",
      addPos: "加一条正面属性",
      addNeg: "加一条负面属性",
      remove: "删除",
      cycles: "已循环",
      kuvaLeft: "剩余",
      invalid: `这个数值不可能，确认勾选了「${show}」`,
      demo: "示例",
      clear: "清空",
    },
    target: {
      title: "目标",
      add: "想要的属性",
      addAlt: "另一组目标",
      quick: {
        label: "打字设目标",
        placeholder: "打字设目标，如：基多射 负任意",
        apply: "填入",
        help: "可以怎么写",
        rules: [
          ["基多射 · 双暴", "官方名称和常见简称都认；双暴 = 暴击几率 + 暴击伤害"],
          ["腐蚀或病毒 · 腐/病", "出一个就行"],
          ["分号或换行", "另一组目标"],
          ["高双暴 · 多重110 · 毒1.05", "档位、数值、浮动系数"],
          ["负任意 · 不要负 · 负变焦", "负面"],
          ["3+1", "布局"],
        ] as [string, string][],
        unknown: "没认出",
        colon: "：",
        list: "、",
        note: (why: string) => `（${why}）`,
        negAny: "负面任意",
        negList: "可接受负面",
        why: { class: "这类武器没有", weapon: "这把武器出不了", full: "一组最多 3 条", spliced: "每张卡只能有一条熔接", sets: "最多 4 组目标" },
      },
      or: "或",
      removeSet: "删除这组目标",
      preset: { any: "不限", mid: "中", hi: "高" },
      roll: "浮动 ≥",
      value: "数值",
      never: "达不到",
      negatives: "负面",
      noNeg: "不要负面",
      accept: "可接受",
      all: "全部",
      none: "清空",
      layouts: "布局",
      more: "档位与数量",
      tiers: "档位",
      atLeast: "至少",
      reach: "条达到",
      atLeastNote: (ks: [string, number][], tier: string) => `另有规则：想要的属性里${ks.map(([set, k]) => `${set ? `${set} 组` : ""}至少 ${k} 条`).join("、")}达到${tier}`,
      range: (text: string) => `范围 ${text}`,
      oneSpliced: "每张卡只能有一条熔接属性，别的行已经选了。",
    },
    routes: {
      title: "下一步",
      sort: { kuva: `省${kuva}`, budget: `${kuva}够用`, cycles: "省次数" },
      sortTip: {
        kuva: `平均${kuva}最少的排前面`,
        cycles: "平均循环次数最少的排前面",
        budget: `用现有${kuva}做完的概率最高的排前面`,
      },
      perCycle: (p: string, n: string) => `每次循环 ${p}，平均约 ${n} 次`,
      cycles: (n: string) => `≈ ${n} 次`,
      totalCycles: (n: string) => `${n} 次`,
      spreadCycles: (n: string) => `${n} 次`,
      totalTip: { kuva: "做完平均总共花的赤毒（含后面的步骤）", cycles: "做完平均总共循环的次数（含后面的步骤）" },
      p90: "90%",
      median: "中位",
      within: `现有${kuva}内完成`,
      rec: "荐",
      none: "不锁定，循环",
      keepSpliced: (x: string) => `循环（「${x}」保持锁定）`,
      drop: (x: string) => `取消「${x}」的锁定，循环`,
      dropAnd: (x: string, then: string) => `取消「${x}」的锁定 · ${then}`,
      lock: (x: string) => `${lock}「${x}」`,
      lockNeg: (x: string) => `${lock}「−${x}」`,
      splice: (a: string, b: string, r: string) => `${splicing}「${a}」+「${b}」→「${r}」`,
      keepWhen: "出现就选新的",
      negOk: "负面可接受",
      negBecomesOk: "负面换成可接受的",
      betterMix: "更好的组合",
      anyOf: (n: number) => `其中 ${n} 条`,
      restCompare: "其他情况：贴截图比较",
      allCompare: "新卡好不好：贴截图比较",
      computing: "计算中…",
      failed: (code: string) =>
        code === "start-failed"
          ? "计算模块启动失败，请重试或刷新页面。"
          : code === "too-complex"
            ? "当前目标计算量过大，已停止。请减少「或」的组合、一行里的可选属性或门槛再试。"
            : code === "timeout"
              ? "计算超过 30 秒，已停止。请重新计算。"
              : "计算中断，请重新计算。",
      retry: "重新计算",
      reload: "刷新页面",
      done: "已经达到目标了。",
      why: (r: Unreachable, name: (tag: string) => string) => {
        switch (r.kind) {
          case "barTooHigh":
            return `「${r.tags.map(name).join("」或「")}」的门槛超过了最大浮动 1.10，在所选布局下出不来。`;
          case "tooMany":
            return `目标有 ${r.need} 条属性，所选布局最多只有 ${r.max} 条正面。`;
          case "noNegative":
            return "所选布局都带负面，但可接受的负面一个都没选。";
          case "cannotRoll": {
            const x = `「${r.tags.map(name).join("」或「")}」`;
            if (r.onCard === "none") return `${x}这把武器洗不出来。`;
            if (r.onCard === "bar") return `${x}这把武器已经洗不出来了，卡上原有的会保留，但达不到门槛。`;
            return `${x}这把武器已经洗不出来了，卡上原有的会保留，但它在 ${r.layout[0]}+${r.layout[1]} 的卡上，目标没选这个布局：换布局会把它洗掉。`;
          }
          default:
            return "按现在的设置达不到这个目标。";
        }
      },
      needWeapon: "贴一张截图，或者先选武器。",
      needGroups: "加一条想要的属性。",
      needCard: "把当前的卡填完整。",
      cardProblem: (p: CardProblem, name: (tag: string) => string, value: (tag: string, n: number) => string) => {
        switch (p.kind) {
          case "cycles":
            return "已循环次数要填 0 或正整数。";
          case "duplicate":
            return `「${name(p.tag)}」出现了两次，一张卡上每个属性只有一条。`;
          case "notPositive":
            return `「${name(p.tag)}」不能作为正面属性。`;
          case "notNegative":
            return `「${name(p.tag)}」不能作为负面属性。`;
          case "twoSpliced":
            return "一张卡只能有一条熔接属性。";
          case "impossible":
            return `${p.layout.pos}+${p.layout.neg} 的卡上「${name(p.tag)}」不可能是 ${value(p.tag, p.shown)}：检查数字和正负号，以及游戏里是否勾选了「${show}」。`;
          default:
            return "把当前的卡填完整。";
        }
      },
      splicers: splicer,
    },
    steps: {
      unlock: "如有锁定，先取消",
      keepSpliced: (x: string) => `只保留「${x}」的锁定`,
      dropSpliced: (x: string) => `点「${x}」取消它的锁定（它对目标已经没用，取消不会再花熔接器）`,
      lock: (x: string) => `点「${lock}」→「${x}」`,
      alsoKept: (x: string) => `（「${x}」自带锁定，也会保留）`,
      cycle: (price: string) => `点「${cycleFor(price)}」`,
      splice: (a: string, b: string, r: string) => `「${splicing}」：「${a}」+「${b}」→「${r}」`,
      missed: "没出 · 保留旧的",
      paste: "贴新截图",
      step: "本步",
      spent: `本步${kuva}`,
      total: "累计",
      of: (n: string) => `/ ≈${n}`,
    },
    compare: {
      title: "留新的还是旧的",
      old: "旧",
      new: "新",
      keep: (w: string) => `留${w}的`,
      better: "更好",
      saves: (n: string) => `少花约 ${n}`,
      cycles: (n: string) => `${n} 次`,
      savesCycles: (n: string) => `少循环约 ${n} 次`,
    },
    ranges: {
      title: "词条范围",
      view: { class: "按武器类型", layout: "按词条分布" },
      sign: "正面或负面",
      weapon: "按武器筛选",
      stat: "属性",
      neg: "负面",
      cannot: "出不了",
      roll: "浮动",
      out: "超出范围",
      value: "数值",
      checkHint: "点属性名，输入数值看浮动系数",
      note: "满级数值，浮动 0.90–1.10，",
    },
    kuva,
  };
}

export type Strings = ReturnType<typeof strings>;

/** "141 万" / "141 萬" / "1.41M"; `fine` keeps one decimal of 万 even for large totals. */
export function fmtKuva(n: number, l: Lang, fine = false): string {
  if (!Number.isFinite(n)) return "—";
  if (l === "en") return n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(Math.round(n));
  if (n >= 1e4) return `${n >= 1e6 && !fine ? Math.round(n / 1e4) : (n / 1e4).toFixed(1)} ${l === "tc" ? "萬" : "万"}`;
  return Math.round(n).toLocaleString("zh-CN");
}

export function fmtPct(p: number): string {
  if (p >= 0.995) return "> 99%";
  if (p < 0.001) return "< 0.1%";
  return `${(p * 100).toFixed(p < 0.1 ? 2 : 1)}%`;
}
