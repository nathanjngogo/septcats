# TASK-T11-01D · M12 导入器 D 阶段（真包校准：_all.csv 配对 + %编码附件解析）

> PM：Hermes ｜ 工程师：CodeBuddy ｜ 前置：T11-A/B/C 已合入（HEAD 含 `0b41187`）
> 背景：老板真实 Notion 导出包（「Nathan的工作空间」，592 文件/396 md/34 csv）已由 PM 冒烟。
> **零崩溃**，但暴露 2 个合成夹具永远测不出的真包形态缺陷。本任务 = 修这两处 + 回归。
>
> 取证位置（必读）：
> - 真包解压目录：`E:/Hermes Agent工作空间/_scratch/real-notion/`（只读消费，禁改动/禁提交）
> - PM 冒烟脚本（现成回归工具）：`packages/importer/test-real/golden-smoke.test.ts` + `golden-detail.test.ts`，
>   跑法：`pnpm -C packages/importer exec vitest run --config vitest.smoke.config.ts`
> - PM 冒烟基线（修前）：counts={pages:396, collections:34, records:653, **assets:0**, degraded:220}，
>   warnings：本地附件缺失 127 / CSV 数据库 25 / 路径冲突 44 / GFM 表 18 / relation 候选 6

## 0. PM 取证结论（已验证，直接照此实现，不要重新论证）

1. **`_all.csv` 配对**：Notion 对每个 database 导出两份 CSV：`库名 <32hex>.csv`（**当前视图**，仅可见列——
   实测「团队待办事项」plain 只有 `名称` 1 列）+ `库名 <32hex>_all.csv`（**全属性**，同表 6 列）。
   17 对：7 对行集全等、10 对 plain 列⊂_all 列（行集可交叉）。
   **裁决 = `_all` 优先**：配对存在时 collection 用 `_all` 那份建（列全、不丢属性），
   plain 那份**跳过**并记 warning `action:'skipped-duplicate'`（note 写明"当前视图 CSV 由 _all 全属性导出替代"）；
   无配对时 plain 照旧。title 统一清理掉 `_all` 后缀（两源同库同名）。
   relation 候选检测随之每库只报一次。
2. **图片链接 %编码**：Notion 导出 md 内图片 src 是 URL 编码的相对路径
   （`CR209%E8%B0%83%E6%95%B4/IMG_x.jpg`），A 阶段按字面路径查源 → 127 图**全判缺失**、assets=0。
   实测 `decodeURIComponent` 后 125/127 命中源文件（2 真缺失，保留原样 warning 正确）。
   裁决：附件解析改两级查找——**原样路径先查，miss 再查 percent-decode 后的路径**
   （decode 用 `decodeURIComponent`，对 `decodeURIComponent` 抛 URIError 的畸形串回退原样；
   都 miss 才记「本地附件缺失」）。命中后走既有 sha256→asset://→asset item 链路（A 已实现，零重写）。
3. §5 降级标记集（:::synced/:::embed/$$/page-ref/@提及/callout）真包**零出现**——不动。
4. 路径冲突 44 条、GFM 表 18 条为预期行为——不动。

## 1. 交付物

| 文件 | 改动 |
|---|---|
| `packages/importer/src/notion.ts` | `_all` 配对识别（含 32hex 名与 `_all` 后缀的清理归一）、_all 优先建库、plain 跳过+warning、relation 去重 |
| `packages/importer/src/markdown.ts` | 附件两级查找（原样→decode）；仅此一点，其余勿动 |
| `packages/importer/test/notion.test.ts` | 新夹具：`_all`+plain 配对（列不等）、仅 plain、仅 `_all`、畸形 `%zz` 编码名 4 景断言 |
| `packages/importer/test/markdown.test.ts` | %编码图引 decode 命中/畸形回退/仍缺失 3 景断言 |

禁改：`packages/editor`、`types.ts` 契约字段、plan.ts 去重/熔断逻辑。不碰 git。
**每写完一个测试文件立即 pnpm 跑，绝不交没跑过的测试。**

## 2. 验收（PM 亲跑，DoD）

```
pnpm -r typecheck && pnpm -r test                          # 存量 importer 50 内新增项全绿
pnpm -C packages/importer exec vitest run --config vitest.smoke.config.ts   # 真包冒烟
```

真包冒烟修后基线（PM 会逐条核对）：
- `counts.collections == 17`（34→17，_all 归并）；`counts.pages == 396` 不变
- `counts.assets ≥ 125`（0→≥125）；「本地附件缺失」warnings 降到 ≈2
- 「CSV 数据库」挂根 warning 消失或大幅下降；relation 候选 6→3（配对去重）
- records 总数可小幅上升（_all 列更全属预期，PM 核对差值合理性）

## 3. 报告

`docs/tasks/TASK-T11-01-report-D.md`：交付表 + 真包冒烟修后 counts/warnings 原文 + DEVIATIONS。
