# TASK-T11-01E · M12 缺陷修复：导入器层尾排序键饱和（真机验收抓到）

> PM：Hermes ｜ 工程师：CodeBuddy ｜ 前置：T11-D（`9b3e6aa`）已合入
> 严重度：高（真实 Notion 包导入到 253/536 条中断，M12 真机验收 FAIL）

## 0. 故障事实（PM 真机取证，勿重新论证）

- 环境：`electron-vite dev` + 老板真实 Notion zip（592 文件）→ `import:plan` 成功
  （counts 396 页/17 库/123 资产），`import:execute` 在 **253/536** 处失败：
  `E_INVARIANT: 无法在父层生成排序键（01M2F40NE2S86HE11Z4G1J7ZNG）：生成的排序键 'zzzzzzzzzzzzzzzzV' 长度 17 超出上限 16`
- 根因：`apps/desktop/src/main/importer.ts` 的 `nextSortKey()` 对每层只做尾部追加
  （`sortBetween(prev, null)`）。core 算法在 prev 以 'z' 开头时逐次把键加长一字符
  （`z`→`zz`→…→`z…zV`），层内存量 16 个 z 后必炸。大工作区反复导入同一层（本包 396 页大多挂根层）
  必然进入该形态。
- 部分成功状态已验证符合设计：failedAt 后续页未写、已写 253 页的父子边抽查 98 条正确、重跑走断点续传。

## 1. 修复要求（按仓库既有先例，勿发明新机制）

1. **先读**：`apps/desktop/src/main/pages.ts`（createPage/move 的层键分配与 513 行附近
   `sortSequence(ordered.length)` 整层重建口径）、`packages/editor/src/diff.ts` 155-175
   （三级回退 + 整层等间隔重建的注释与实现）。两处是本仓处理该问题的**唯一正统模式**。
2. **改 `nextSortKey`**：`sortBetween` 抛 `InvalidSortRange`（或返回键长度 > 16）时，
   不再 throw 终止导入，改为**该父层整层重建**：
   - 查询该 parent 下全部 alive 页按 sort_key 序 + 新页追加在尾部；
   - 对 `total = 存量+1` 取 `sortSequence(total)` 定宽键；
   - 存量页中键有变化的 → 生成同批 `page.setSort`（或既有等价 op，照 pages.ts 用的那条语句）
     与新页 upsert 一起进**同一个 commitOps batch**（原子性铁律不破）；
   - 重建后清该层游标，后续项正常尾追。
3. **collection 挂层同理**（collection 的宿主页排序也走 nextSortKey 的话一并生效；确认之）。
4. **禁改**：`packages/core/sortkey.ts`（16 上限是全局不变量）、importer 纯逻辑包、git。
5. 每写完测试立即 pnpm 跑；禁占位符。

## 2. 测试底线（`apps/desktop/test/importer-exec.test.ts` 追加）

- **饱和回归**：向同一父层连续导入 >20 页 的夹具，且该层预置 sort_key 全为 `z…z` 加长形态
  （直接往库里种 `z`,`zz`,`zzz`,…≥16 长的兄弟页）→ execute 全 done、failedAt=null、
  整层键合法（长度 ≤16、严格递增序与创建序一致）、import_source 行数 == 页数组。
- **幂等不破**：上述夹具重跑 execute → 0 新增（回归既双层幂等仍成立，重建不复活已删页：
  种 1 个 alive=0 兄弟确认不被重建带回）。
- 存量 141 desktop 测试零破坏。

## 3. DoD（PM 复跑口径）

```
pnpm -r typecheck && pnpm -r test
node packages/ui/tokens/no-magic.mjs
pnpm -C apps/desktop selftest && pnpm -C apps/desktop build
```

报告 `docs/tasks/TASK-T11-01-report-E.md`：根因确认、diff 摘要、饱和回归测试输出原文、DEVIATIONS。
