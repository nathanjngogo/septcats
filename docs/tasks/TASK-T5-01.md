# TASK-T5-01 · M4 编辑器（块编辑核心 + v1 九块型 + 输入规则 + 手柄/斜杠菜单）

> PM：Hermes ｜ 工程师：CodeBuddy ｜ 仓库：E:\Hermes Agent工作空间\Septcats
> 前置：T4（packages/ui + tokens）已合入。必读：docs/schema-v1.md（块类型词汇表=契约）、docs/PROJECT_PLAN.md §7 M4、docs/mockups/01-editor.html（视觉与交互基准）、docs/decisions/SPIKE-G2-01-editor.md（选型=Tiptap v3）。
> 纪律：只 Write/Edit；不跑终端命令、不碰 git。本任务量大，拆两阶段交付：**5a=模型与数据链路（packages/editor 无 React 依赖可测）**，**5b=React 视图与交互**。两阶段的文件都要写全。

## 0. 架构铁律（违反=打回）
1. **真相是 M3 块模型**：编辑器内部状态是 `BlockDoc = { pageId, blocks: Block[] }`（schema-v1 §3/§4 形状）。ProseMirror 文档是它的**投影**；每次 PM 事务 → 差分 → 生成 Op（upsert/patch/move/reorder）→ 经注入的 `commit(ops)` 回调外发。编辑器**永不**直接写 fs/db。
2. `packages/editor` 依赖：`@tiptap/core`、`@tiptap/pm`、`@septcats/core`（sortkey/Op/lamport 复用，禁止重写）。React 视图在 `packages/editor/src/react/`（peer react）。**不依赖 packages/ui**（视图组件自己引 tokens.css 变量即可，UI 包组件在 apps 层组装）。
3. IPC 提交形态（apps 层接线，编辑器包只暴露回调）：一次用户「编辑轮次」（debounce 300ms 或 blur）→ 一次 batch：`opLedger.insert` × N + 物化 `*.upsert` × M，**同事务**（计划书 §8.1）。undo 栈=逆 op（schema-v1 §5.3）。
4. CJK：IME 组合期间（compositionstart/end）**不生成 Op、不触发输入规则**（ProseMirror 原生处理 composition，但规则插件要在 `view.composing` 时跳过）。测试模拟 composition 事件序列。

## 1. 包结构
```
packages/editor/
  package.json      # deps: @tiptap/core@^3 @tiptap/pm@^3 @septcats/core(work)；peer react@^18；devDeps 同 desktop 模式
  tsconfig.json vitest.config.ts（node env；react 测试文件 environment jsdom + @testing-library，配置拆两个 project 或单 jsdom 全收——你定，报告说明）
  src/
    index.ts
    model.ts        # BlockDoc/Block zod（复用 core 的 TargetTable 语义）、blocks↔PMdoc 双向映射 toPMdoc/fromPMdoc（纯函数，重测区）
    diff.ts         # 两轮 BlockDoc diff → Op[]（字段级：props/content/sort_key/parent/alive；用 patch 或 upsert 由字段占比决定：>50% 字段变化→upsert）
    types/          # 9 个 Tiptap Node 规格：paragraph heading list(todo/ordered/bullet 合二) quote(code 特殊:content 纯文本) divider image
    marks.ts        # bold italic strike code link(白名单校验 href) mention(_conflict 隐藏 mark 不做)
    rules/
      inputRules.ts # "# "→h1.. 等（CJK 标点安全：只认半角井号+空格）；[] [x] →todo；``` →code
      slashMenu.ts  # 纯状态机：query→候选块型（中文名，拼音首字母匹配表内置 9 项）；不含 UI
      markdownPaste.ts # text/plain 粘贴→PM doc（子集：标题/列表/待办/代码围栏/粗斜/链接/分隔线；解析器 200 行内自写，不引依赖）
    history.ts      # OpUndoStack：push(ops)→逆 ops 计算（字段快照法），undo()/redo() 返回 Op[]；深度 100
    seq.ts          # 编辑轮次聚合器：ingest(docSnapshot)→debounce→emit Op[]（注入 clock）
    react/
      Editor.tsx        # useEditor 装配 + onChange 桥 + 主题容器 class
      BlockControls.tsx # 手柄（⋮⋮ 用 Icon 位；点击菜单：删除/复制/转为…9 项/颜色）+ hover 显形
      SlashMenu.tsx     # 浮层 UI（对齐 mockup .menu：分类/键盘导航/选中条），受控于 slashMenu 状态机
      SelectionToolbar.tsx # 对齐 mockup .floating：B I U code link，位置随选区（selectionRect 纯函数可测）
      dnd.ts            # 块拖拽→reorder/sort_key 计算（sortBetween 调用点；失败降级=整层重平衡批次）
  test/
    model.test.ts diff.test.ts rules.test.ts history.test.ts seq.test.ts react.test.tsx
    fixtures/  # schema-v1 §6 承诺的黄金样例：每块型 1 个 {blocks, pmJson} 对照 + 3 段「真实编辑序列→期望 Op 流」
```

## 2. 关键纯函数契约（签名级，PM 逐条测）
```ts
// model.ts
export function blocksToPMDoc(doc: BlockDoc): PMDocJSON          // 确定性：同输入同输出
export function pmDocToBlocks(json: PMDocJSON, prev: BlockDoc, clock: () => Lamport): BlockDoc  // 保持 block id：按 id 匹配旧块，新插入生成 ulid
// diff.ts
export function diffBlocks(before: BlockDoc, after: BlockDoc, ctx: { actor: string; now: number }): Op[]
// 语义：未变块 0 op；content 变→patch{content}；props 变→patch{props}；type 变→upsert 整块；删除→delete；顺序变→reorder{sort_key}（最小集合：只给位置变了且与邻居无空位的块发 reorder，能 sortBetween 就只发 1 条）
// history.ts
export class OpUndoStack { apply(ops: Op[]): void; undo(): Op[] | null; redo(): Op[] | null; }
// 逆 op 规则：upsert→反向 patch 旧字段快照；delete→upsert 复活；reorder→反向 reorder（旧 sort_key 快照）
// seq.ts
export class EditSession { constructor(opts:{actor:string, commit:(ops:Op[])=>void|Promise<void>, debounceMs?:number, now:()=>number}); onDocChange(doc:BlockDoc):void; flush():Promise<void> }
// 行为：coalesce 连续编辑（同字段 500ms 内只留最后一版）；flush 强制出；错误 commit reject→onError 回调（不吞）
// slashMenu.ts
export function filterSlashCommands(query: string): SlashItem[]   // 中文/拼音/英文三通道匹配，稳定排序
```

## 3. 测试底线（无浏览器 jsdom 也要跑真 PM）
- model 双向映射：**每块型 roundtrip 恒等**（fixture 驱动）；未知 type 块降级 paragraph+_raw（schema-v1 §3）。
- diff：9 种编辑动作（输入/换型/删除/拖序/撤销…）→ 断言**期望 Op 序列逐条相等**（fixture「编辑序列→Op 流」）。
- 收敛：diff 产出的 Op 经 core.replay 应用→与 after 投影一致（用 core 的 Projection，把编辑器与同步正确性焊死）。
- rules：输入规则在 IME composing=true 时零触发；markdownPaste 子集 20 例。
- history：apply→undo→redo 幂等链 ×50 随机操作（复用 core test/helpers 的 mulberry32）。
- react：Editor 渲染冒烟 + SlashMenu 键盘导航（ArrowDown×2 Enter 触发 insertBlock 回调断言）。

## 4. apps/desktop 接线（薄，10 文件内）
- renderer 新增 `pages/PageView.tsx`：Editor + BlockControls + SlashMenu + SelectionToolbar 组装；假数据本地内存（`memorySession`：commit=console + 内存数组，**不接 db IPC**——T6 接线）。
- preload 增 `blocks` API 通道常量但暂不实现 main 侧（shared/ipc.ts 占位，防漂移）。
- App.tsx 壳的内容区挂 PageView（一页假文档，含 9 块型各一）。

## 5. 依赖白名单
`@tiptap/core@^3.31`、`@tiptap/pm@^3.31`、（react peer）。**不要 @tiptap/starter-kit**（它捆 20 个扩展，我们用显式子集：paragraph/text-document/history 自己装配）。测试用 jsdom/@testing-library/react 已在 desktop devDeps，editor 包自加同款 devDeps。

## 6. DoD（PM 复跑）
```
pnpm install && pnpm -r typecheck && pnpm -r test
node -e "无"（PM 手测真机交互）
pnpm -C apps/desktop build
```
报告含 SSIM-NOTE（与 01 mockup 对齐说明）+ 未决项清单。先复述（≤5 行）再动笔；写不完的在报告 DEVIATIONS 明说，禁占位符。
