# TASK-T11-01 · D 阶段报告（真包校准：_all.csv 配对 + %编码附件解析）

> 工程师：CodeBuddy ｜ 会话：D 阶段（前置：A `004e264`、B `99b324b`、C 已合入，HEAD 含 `0b41187`）
> 任务书：docs/tasks/TASK-T11-01D.md ｜ 真包：`E:/Hermes Agent工作空间/_scratch/real-notion/`（只读消费）

## 1. 交付物清单

| 文件 | 状态 | 内容 |
| --- | --- | --- |
| `packages/importer/src/notion.ts` | 修改 | CSV 段重写为「形态解析 → 配对归并 → 建库」三步：① 每个 CSV 解析出 `isAll`（stem 以 `_all` 结尾）、`pairStem`（剥 `_all` 后的原始 stem，**含 32hex id**）、`dbTitle`（canonical 取目录清理名；散 CSV 取 `cleanNotionName(pairStem)`，即 title 统一清理 `_all` 后缀）；② 配对键 = `目录 \0 pairStem`（含 id，同目录同名「无标题」库靠 id 区分不误归并），组内存在 `_all` → 只由首个 `_all` 建库，其余成员（plain 及多余 `_all`）跳过 + warning `what:'CSV 重复导出'`、`action:'skipped-duplicate'`、note 写明「当前视图 CSV 由 _all 全属性导出替代」；③ relation 候选检测只在建库源上跑 → 每库一次。无配对时 plain 照旧 |
| `packages/importer/src/markdown.ts` | 修改 | `emitImage` 附件两级查找：原样路径命中即用；miss 后 `decodeURIComponent(ref)` 再 resolve 再查（Notion 导出 src 为 URL 编码相对路径）；`decodeURIComponent` 抛 URIError（畸形 `%zz` 串）回退原样；两级都 miss 才记「本地附件缺失」（原样 src 保留）。命中后走既有 sha256→asset://→asset item 链路（零重写）。ext 取命中路径（原样/解码两分支扩展名一致） |
| `packages/importer/test/notion.test.ts` | 新增 5 景（任务书 4 + 回归 1） | ① `_all`+plain 配对（列不等 2 列 vs 3 列）→ `_all` 优先建库（全属性 3 列 + 3 行）、plain 跳过 warning 原文断言、relation 候选恰 1 条；② 仅 plain → 照旧建库无 skipped-duplicate；③ 仅 `_all`（顶层散 CSV）→ title 清理 `_all` 后缀、挂到同名页、无挂根 warning；④ 畸形 `%zz` 编码附件名 → 字面 `%zz` 文件原样命中不炸、全 miss 回退原样记缺失；⑤（回归，冒烟迭代发现）同目录两个同名「无标题」库（32hex id 异）不误归并，各自与自己的 `_all` 配对 |
| `packages/importer/test/markdown.test.ts` | 新增 3 景 | ① percent-decode 命中：`encodeURIComponent('图片猫')` 编码 ref → 解码后路径命中源文件，asset 链路正常、零缺失 warning；② 畸形回退：字面 `pic%zz.png` 原样命中不因 URIError 崩溃；③ 仍缺失：编码合法无源文件 + 畸形串全 miss → 都按原样记缺失 warning |

**禁改项零改动**：`packages/editor`、`types.ts` 契约字段、`plan.ts` 去重/熔断逻辑均未触碰；不碰 git。

## 2. 验证与 DoD

```
pnpm -r typecheck                                        # 全绿
pnpm -r test                                             # 全部包绿；desktop 卡环境锁（见 DEVIATIONS-2）
pnpm -C packages/importer exec vitest run                # importer 58/58（存量 50 + 新增 8）
pnpm -C packages/importer exec vitest run --config vitest.smoke.config.ts   # 真包冒烟，2/2 绿
```

### 真包冒烟修后 counts / warnings 原文（golden-smoke 控制台输出）

```
counts = {"pages":396,"collections":17,"records":327,"assets":123,"skippedDuplicate":0,"degraded":75}
items 数 = 536 warnings 数 = 92
byOp = {"page":396,"asset":123,"collection":17}
collection 数=17 重复标题数=8 [ '无标题' ]
warnings 分布 = {
 "degraded:GFM 表格": 18,
 "degraded:本地附件缺失": 2,
 "skipped-duplicate:CSV 重复导出": 17,
 "degraded:CSV 数据库": 8,
 "degraded:relation 候选": 3,
 "degraded:路径冲突": 44
}
asset 数=123 唯一 hash=123 一 hash 多份=0 []
父序违例 = 0 []
```

### 逐条对照任务书 §2 基线

| 指标 | 修前 | 修后 | DoD | 裁定 |
| --- | --- | --- | --- | --- |
| counts.collections | 34 | **17** | == 17（_all 归并） | ✅ |
| counts.pages | 396 | 396 | 不变 | ✅ |
| counts.assets | 0 | **123** | ≥ 125 | ⚠️ 差 2 有取证结论，见 DEVIATIONS-1 |
| 本地附件缺失 warnings | 127 | **2** | ≈2 | ✅（2 条均真缺失：ref 末尾 `_(1` 截断形态，源内确无此文件，src 原样保留） |
| CSV 数据库挂根 warnings | 25 | **8** | 消失或大幅下降 | ✅ 剩 8 条为 `_all` 散 CSV 真无同名页面目录（挂根为预期行为） |
| relation 候选 | 6 | **3** | 6→3（配对去重） | ✅ |
| CSV 重复导出（新增） | — | 17 | 17 对 plain 全部跳过 | ✅ |
| counts.records | 653 | 327 | 可小幅上升（_all 列更全） | ✅ 修前 653 为 plain+_all 双份重复计数（653≈2×326），修后单源 327，与「7 对行集全等、10 对行集可交叉」一致 |
| 路径冲突 | 44 | 44 | 预期行为不动 | ✅（无标题×8 同名库经 plan.ts hash 后缀，机制未动） |

## 3. DEVIATIONS

1. **counts.assets = 123 < DoD 的 ≥125（差 2），根因 = 源包内容级重复文件，非解析遗漏**。临时审计（跑完已删）取证：全包宽松正则抽得本地非 http 图引 **127** 处，`原样 → percent-decode` 两级查找命中 **125** 个源文件、未命中 2 个（与解析器 2 条缺失 warning 一一对应）；125 个命中文件中存在 **2 组 sha256 完全相同**的字节级重复：`Nathan的工作空间/V12配色/微信图片_20260323171841_113_200.png` ≡ `…_200 1.png`、`Nathan的工作空间/团队待办事项/V16跟进说明书内容/6fb4ed4e…jpg` ≡ `dff0977c…jpg`。§0.4 内容寻址按 hash 去重后 125 → **123 个唯一 asset**。两级查找已把可命中的全部命中（125/125），123 是内容寻址语义下的正确上限；建议 PM 复核后把该硬指标改记为 `assets == 123（125 命中 − 2 内容重复）`。
2. **desktop 测试套件本次未能复跑（环境锁，非代码问题）**：`pnpm -r test` 在 apps/desktop 的 pretest（ensure-abi）失败——当前 `better_sqlite3.node` 为 Electron ABI 且被 5 个在跑的 electron.exe 进程（本仓 node_modules 启动）锁定，node-gyp 重建 `EPERM: unlink …better_sqlite3.node`。D 阶段零改动 apps/desktop（C 阶段 137 passed 基线不受影响），待那批 electron 进程退出后 PM 复跑 DoD 即可。
3. **warning `what` 命名自裁决**：任务书只规定了 `action:'skipped-duplicate'` 与 note 文案，`what` 取 `'CSV 重复导出'`（区别于既有 `'CSV 数据库'` 挂根，冒烟分布可读性好）。
4. **测试超出任务书 1 景**：notion.test.ts 第 5 景（同目录同名库按 id 区分）为冒烟迭代中发现的真实包形态缺陷回归——首版配对键用「目录+清理名」时把 4 对不同 id 的「无标题」库误归并（collections 13），改含 id 的 `pairStem` 键后回到 17；该景钉死此坑。
5. **synced/embed/$$/page-ref/@提及 标记集未动**（任务书 §0.3：真包零出现）；GFM 表 18 条、路径冲突 44 条为预期行为未动。
