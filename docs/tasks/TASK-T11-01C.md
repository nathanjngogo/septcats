# TASK-T11-01C · M12 导入器 C 阶段（desktop 执行器 + 向导 UI）

> PM：Hermes ｜ 工程师：CodeBuddy ｜ 前置：T11-A（`004e264`）、T11-B（`99b324b`）已合入 main
> 必读（按序）：
> 1. `docs/tasks/TASK-T11-01.md`（总任务书，§4 执行器 / §5 降级 / §6 测试底线 / §7 DoD）
> 2. `docs/tasks/TASK-T11-01-report-A.md` + `TASK-T11-01-report-B.md` 的「关键裁决」与「未决项」段——**B 报告 §2 的 6 条裁决是 C 的消费契约**（逻辑路径、contentHashOf、buildPlan 包根 re-export 等）
> 3. `packages/importer/src/index.ts`（A+B 出口：`buildPlan(source, files, existingLookup)`、`contentHashOf`、`ImportPlan/ImportItem` 类型、`PlanTooLargeError`）
> 4. `docs/mockups/09-import-wizard.html`（视觉真相，三步向导）
> 5. `apps/desktop/src/main/commit.ts`（commitOps batch 范式：op_ledger.insert + 物化语句同事务）+ `apps/desktop/src/main/pages.ts` + `dbview.ts`（页面/collection 物化形态、sort_key、actor）
> 6. `apps/desktop/src/db/migrations.ts`（迁移注册表；**LATEST_SCHEMA_VERSION 当前=4，本任务加 v5**）+ `apps/desktop/src/db/statements.ts`（白名单语句模式）
> 7. `apps/desktop/src/preload/index.ts`（桥模式）与 renderer `App.tsx` 路由（设置页入口旁加「导入」入口）
>
> 纪律：用 Write/Edit 落盘；**每写完一个测试文件立即 `pnpm` 跑它，绝不交没跑过的测试**；不碰 git（不 commit 不 branch）；禁占位符/TODO 空壳；禁改 packages/importer、packages/editor 的已合入文件（发现契约缺口先写入报告「未决项」，最小适配在 desktop 侧做）。

## 0. 范围裁决（PM 已定）

1. **全部新增代码在 `apps/desktop`**（main + preload + renderer）+ `packages/platform`（layout.attachments 已有，无需改）+ `packages/core` 若需导出补全。`fflate` 是**唯一新增依赖，只进 apps/desktop/package.json**。
2. zip 解压发生在 desktop main（fflate `unzipSync` → `Map<path, Uint8Array|string>` 喂 importer；检测 `.zip` vs 目录 vs `.csv` 三态入口）。
3. 通道协议（总任务书 §4 字面）：
   - `import:plan {zipPath?|dirPath?|csvPath?} → {planId, preview}`（preview = plan 去掉 items 内 bytes，items 截前 50 + total）
   - `import:execute {planId, confirm:true} → {report}`
   - `import:progress {planId}` 轮询 → `{done, total, failedAt?}`
   - `import:cancel {planId}` → 停止后续 batch（当前 batch 原子完成）
   - plan 结果缓存于 main 内存 Map（planId = crypto.randomUUID），重启即失——重新 plan 天然幂等。
4. 执行 = **每页/每 collection 一个 batch**（复用 commitOps 同构：op_ledger + 物化 + 资产落盘前置 + import_source 插入同 batch）。blocks op 数 == plan items 的 blocks 数断言进测试。
5. 失败不自动回滚（upsert 幂等，重跑续）；report = `{planned, done, failedAt|null, errors[], counts}`。
6. `import_source` 表（migration v5，参数化用 LATEST_SCHEMA_VERSION）：
   `(source_path TEXT, content_hash TEXT, page_id TEXT, created_at INT, PRIMARY KEY(source_path, content_hash))`；
   ExistingLookup 实现 = 对该表 SELECT。
7. 资产落盘：plan items 的 `op:'asset'` → `platform.layout.attachments/<hash><ext>`，**先查重（文件在则跳过）**，内容寻址天然幂等。`asset://` renderer 解析：PageView img src 映射到文件协议/自定义协议（照抄现有附件读取通道形态；若 renderer 无现成通道则新增 `asset:resolve {ref} → fileUrl`）。
8. 向导 UI（renderer `ImportWizard.tsx` 或 pages/ 下，对齐 mockup 09）：
   三步 选择→预览→执行→结果；预览页 = counts 摘要 + warnings **折叠列表（全量可见，不藏）** + items 树前 50；
   **warnings 非空时确认按钮文案 = 「继续导入（N 项降级）」**；
   执行页 = 进度条 done/total 轮询；结果页 = report 全文 + 「打开首页」。
   CSS 只准 `var(--sc-*)`，双主题四态（空/加载/错误/成功），图标只从 `@septcats/ui` Icon 出口。
9. E_TOO_LARGE（PlanTooLargeError）在预览前抛出 → 向导错误态显示「共 N 项超过 5000 上限，请分批导入」，不白屏。

## 1. 交付物清单（文件名硬约束）

| 文件 | 内容 |
|---|---|
| `apps/desktop/src/main/importer.ts` | 三态入口检测、fflate 解压、buildPlan 调用、plan 缓存、四通道 handler、batch 执行器、资产落盘、import_source |
| `apps/desktop/src/db/schema.v5.ts` | migration #5：import_source 表 + 索引（自包含语句，仿 schema.v4.ts） |
| `apps/desktop/src/db/migrations.ts` | 注册 v5；LATEST_SCHEMA_VERSION 前进（若它是推导值则确认推导正确） |
| `apps/desktop/src/db/statements.ts` | 白名单补 `import_source.insert` / `import_source.exists` 等 |
| `apps/desktop/src/preload/index.ts` | 补 import 桥四方法 |
| `apps/desktop/src/renderer/src/pages/ImportWizard.tsx` + `.css` | 三步向导，mockup 09 对齐 |
| `apps/desktop/src/renderer/src/App.tsx` | 导入入口接线（与设置入口同级形态） |
| `apps/desktop/test/importer-exec.test.ts` | **真 SQLite**：幂等重跑 0 新增；失败续传（注入第 3 页 throw→重跑成功且 1-2 页不重复）；blocks op 数断言；LATEST_SCHEMA_VERSION 参数化 |
| `apps/desktop/test/import-entry.test.ts` | 三态入口检测 + zip 解压（fflate 内存合成 zip，禁二进制大文件）+ E_TOO_LARGE 透传 |
| `apps/desktop/package.json` | +fflate（dependencies，精确版本） |

## 2. 测试底线（对齐总任务书 §6 的 C 部分）

- 执行器三条硬测试必须在**真 SQLite**（node 运行时）上跑，走现有 db 测试夹具模式（参考 test/ 里 pages/dbview 的真库用例；注意 ABI 守卫——用 `pnpm -C apps/desktop test` 口径跑）。
- UI 不做组件测试硬性要求（真机 CDP 由 PM 验收），但 ImportWizard 的纯逻辑（步骤状态机、按钮文案函数 `confirmLabel(warnings)`）单独导出 + 测 2 条。
- 存量不破：`pnpm -r typecheck`、`pnpm -r test`、`node packages/ui/tokens/no-magic.mjs`、`pnpm -C apps/desktop selftest`、`pnpm -C apps/desktop build` 五条全绿后才算交付；报告里贴每条命令的原文输出尾段。

## 3. 报告

写 `docs/tasks/TASK-T11-01-report-C.md`：交付物清单表、关键裁决（含对 B 契约的任何适配）、验证记录（2 §的 DoD 五条命令输出原文）、SSIM-NOTE（与 mockup 09 屏的对齐点与偏差）、DEVIATIONS、未决项。

## 4. DoD（PM 复跑口径）

```
pnpm -r typecheck && pnpm -r test
pnpm -C apps/desktop selftest
node packages/ui/tokens/no-magic.mjs
pnpm -C apps/desktop build
```
