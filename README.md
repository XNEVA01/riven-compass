# 紫卡罗盘 · 裂罅洗卡与行情规划器 (RivenCompass)

> 当前版本 V1.0 · 线上：https://xneva-ai.com/

Warframe 裂罅 Mod（国服：裂隙振幅晶体）洗卡与行情规划器。贴一张循环界面的截图，选好想要的词条，网站会列出下一步所有可走的路线：每次成功率、预计循环次数、全程赤毒（平均、中位、90% 把握），选哪条由你决定。每循环一次再贴一次截图，它会告诉你保留新的还是旧的，并重新计算。

## 本版新增

- **行情选品**：聚合 DE 官方周度紫卡成交与 [warframe.market](https://warframe.market) 挂单（服务器每日更新），给出每武器热门词条组合的中位价、在架量、周转与「自己洗 vs 直接买」的利润对比（国际服开放；国服无 WM，不开放）
- **配卡伤害**：伤害面板与击杀耗时，四档对比（无紫卡 / 你的紫卡 / 期望 / 最优），词条边际价值标出谁在干活
- **移动端适配**：<=720px 下行情表变卡片、词条范围表变单属性手风琴、页签短文案一行排完
- **账号系统**：`api/`（Flask + SQLite），跨设备同步会话
- **体验优化**：行情本地缓存秒开 + 骨架屏、OG 分享卡（QQ / 微信 / B 站）、深浅色主题

## 继承自上游

- 四种语言：简体中文（国际服，默认）、国服、繁體中文、English，术语全部取自游戏字典
- 可以设多组目标（满足任意一组即可），比如「伤害 + 多重 + 腐蚀/病毒」或「多重 + 暴伤 + 弹药效率/异常状态伤害」
- 目标可以直接打字：「基多射 负任意」「腐蚀或病毒」「多重110」「3+1」，认不出的部分会标出来
- 词条范围页：同类武器比不同词条分布，或同一词条分布比不同类武器；点属性名输入数值即可看浮动系数
- 武器图片来自官方 Public Export CDN，伤害类型等小图标取自游戏文件
- 截图识别在浏览器里完成，图片不会上传
- 路线由动态规划求出最省赤毒（或最省次数）的走法，分布由模拟得出

## 开发

需要 Node.js 26。

```bash
npm install
npm run dev      # 本地开发
npm test         # 单元测试
npm run build    # 生产构建；部署在子路径时设 BASE_PATH，如 BASE_PATH=/preview/ npm run build
```

行情数据由服务器管线每日聚合，挂到站点 `/data/market.json`（DE 周度成交 × WM 挂单）；本仓库不含该数据产物。

## 更新游戏数据

`src/data/game.json` 由 Python 3.10+ 的 `scripts/build-data.py` 生成，读取 Warframe-Algorithm 的四个数据仓库（`warframe-packages-data(-cn)`、`warframe-export-data(-cn)`；私有仓库，未公开）。把它们克隆到同一个文件夹，游戏更新后：

```bash
python scripts/build-data.py --data-dir /path/to/Warframe-Algorithm
```

也可设置 `WF_DATA_DIR` 后运行 `npm run data`。生成器保留每个属性的舍入模式；遇到未支持的倾向或舍入配置会停止，避免生成错误数据。

## 目录

- `src/engine/` 公式、可出词条、求解器（`solver.ts`）及测试
- `src/damage/` 配卡伤害引擎（mod、敌人、配装求解）
- `src/ocr/` 截图识别（PaddleOCR PP-OCRv6 tiny，Apache-2.0）和解析
- `src/market/` 行情数据装载与本地缓存
- `src/ui/` 界面
- `api/` 账号系统（Flask + SQLite）
- `public/models/` 识别模型

## 致谢与许可

- 本项目基于 [wxhn1225/riven-roll](https://github.com/wxhn1225/riven-roll) 二次开发并定名「紫卡罗盘」，已获原作者同意——感谢原作者的开源与慷慨
- 行情数据来自 [warframe.market](https://warframe.market) 与 Warframe 官方周度成交数据
- 代码以 [MIT](LICENSE) 开源；上游仓库当时未附许可证，经原作者同意后在此声明
- 玩家自制，与 Digital Extremes 无关
