# TASK-M0+M2a · 工程骨架 + 纯逻辑核心（Milestone 1）

> 发件人：Hermes（PM）· 收件人：CodeBuddy（代码工程师）
> 仓库：`E:\Hermes Agent工作空间\Septcats`（pnpm monorepo）
> SSOT：`docs/PROJECT_PLAN.md` v0.2（本任务书与其冲突时以计划书为准，并在报告里指出冲突）
> 你只写代码和测试；**不执行 git commit/push**（提交由 PM 负责）。

## 0. 目标（一句话）
搭起可运行的 Electron + pnpm monorepo 骨架，并把**纯 TS 领域核心**（事件/时钟/排序键/分段编解码/重放）做实——这部分是未来同步正确性的地基，宁可慢不可假。

## 1. 硬性约束（违反即打回）
1. `packages/core` **零运行时依赖**，除 `zod`；**禁止 import `electron` / `node:fs` / `node:crypto` 之外任何 Node 内建**（fs/crypto 仅限段文件 IO 辅助，核心逻辑必须可在纯内存跑）。
2. TypeScript `strict: true` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`。
3. 测试全部用 `vitest`；`packages/core` 的测试必须能在纯 Node 下跑（不依赖 Electron）。
4. 包管理只允许 pnpm（本机 9.15.9 已装）；Node 22。Windows 路径注意 `$PLUGINSDIR` 类特殊名不适用本仓库，无风险，但**文件路径一律 POSIX 风格拼接（`path.join`）**。
5. 代码内**禁止 emoji**；注释用中文或英文均可，但不得为空占位（如 `// TODO` 出现在交付代码中即打回；写不了的接口留 `throw new Error('not implemented: <原因>')` 并在报告中列出）。
6. 不碰 `docs/`；不改 `PROJECT_PLAN.md`；`.gitignore` 已有内容不删。

## 2. 目录结构（必须完全一致）
```
septcats/
├─ package.json              # root, private, "packageManager": "pnpm@9.15.9"
├─ pnpm-workspace.yaml
├─ tsconfig.base.json        # strict 共享配置
├─ vitest.config.ts          # projects 模式串起各包
├─ README.md                 # 环境要求 + 三条命令（pnpm i / pnpm dev / pnpm test）
├─ .editorconfig
├─ packages/
│  ├─ core/                  # @septcats/core 纯逻辑
│  │  ├─ package.json        # exports "./src/index.ts" 直出（本仓不产 dist，dev 期 Vite 直编）
│  │  ├─ tsconfig.json
│  │  ├─ src/
│  │  │  ├─ index.ts
│  │  │  ├─ op.ts            # Op/Block/Page/Collection/Record 类型 + zod schema
│  │  │  ├─ clock.ts         # LamportClock
│  │  │  ├─ sortkey.ts       # LexoRank 风格字符串序
│  │  │  ├─ segment.ts       # JSONL 分段编解码
│  │  │  ├─ projection.ts    # 内存投影（Map 存实体）
│  │  │  ├─ replay.ts        # replay(ops, entities?) + convergence
│  │  │  ├─ snapshot.ts      # snapshot/delta 序列化
│  │  │  └─ util/ulid.ts     # 自写 Crockford base32 ULID（不引依赖）
│  │  └─ test/               # clock/sortkey/segment/replay/convergence/util 各一
│  └─ schema/                # @septcats/schema zod→JSON Schema 生成 + DESIGN 常量
│     ├─ package.json tsconfig.json
│     ├─ src/index.ts        # export const SCHEMA_VERSION=1; export blockTypes; export function generateJsonSchema()
│     └─ test/schema.test.ts
├─ apps/
│  └─ desktop/               # Electron（electron-vite）
│     ├─ package.json        # scripts: dev/build/typecheck/test；devDeps: electron, electron-vite, vite, @vitejs/plugin-react, typescript, vitest
│     ├─ electron.vite.config.ts
│     ├─ tsconfig.json (+ tsconfig.node.json / tsconfig.web.json)
│     ├─ src/
│     │  ├─ main/index.ts    # BrowserWindow(sandbox:true, contextIsolation:true, nodeIntegration:false)、单实例锁、whenReady→createWindow、window-all-closed(mac 外 quit)、日志目录 ~/.septcats/logs/main.log（自写 20 行 logger，不引 electron-log）
│     │  ├─ preload/index.ts # contextBridge.exposeInMainWorld('septcats', api)：api 只有 ping():Promise<string> 和 appMeta():Promise<{name,version,schemaVersion}>
│     │  ├─ renderer/
│     │  │  ├─ index.html
│     │  │  └─ src/{main.tsx,App.tsx,styles/tokens.placeholder.css}
│     │  └─ types/window.d.ts
│     ├─ src/db/             # 本阶段**只建空目录 + README.md 一句**（DbServer 属下一阶段 T2，防你顺手开写）
│     └─ resources/icon.svg  # 简单占位 SVG 猫轮廓即可（品牌稿另评）
└─ .github/workflows/ci.yml  # windows+macos: pnpm i --frozen-lockfile? (首版无 lockfile 则 pnpm i) → typecheck → test → build
```

## 3. packages/core API 契约（**逐条签名实现**，名字不许改）
```ts
// op.ts —— 全部 zod schema + z.infer 类型成对导出
export type ActorId = string;            // device id, 8-32 chars [a-z0-9]
export type EntityId = string;           // ulid
export interface Lamport { c: number; d: ActorId }  // zod: lamportSchema, c>=1
export type OpKind = 'upsert'|'delete'|'move'|'reorder'|'patch';
export type TargetTable = 'page'|'block'|'collection'|'record'|'schema';
export interface Op {
  op_id: string; lamport: Lamport; at: number; actor: ActorId;
  target: { table: TargetTable; id: EntityId };
  kind: OpKind; payload: Record<string, unknown>;
  base?: number;                          // patch 并发检测用；upsert/delete 必空
  merge_policy?: 'lww';                   // Q5 预留，一期只允许 'lww' 或省略
}
export function encodeOp(op: Op): string;                 // 单行 JSON（键序稳定）
export function decodeOp(line: string): Op;               // 校验失败 throw OpValidationError
export class OpValidationError extends Error { readonly issues: string[] }

// clock.ts
export class LamportClock {
  constructor(deviceId: ActorId, initialC?: number)
  tick(): Lamport;                        // 本地事件：c+1
  witness(other: Lamport): void;          // 收到远端：c=max(own,other.c)+... 规则：own=Math.max(own,other.c)，不发新值
  get value(): number;
}
// 比较函数：先比 c 小者在前，同 c 比 d（字符串字典序）
export function compareLamport(a: Lamport, b: Lamport): number

// sortkey.ts —— 字符集 base62 有序：0-9 A-Z a-z（ASCII 单调）
export const SORTKEY_MIN: string;         // '0'
export const SORTKEY_MAX: string;         // 'z'
export const SORTKEY_INITIAL: string;     // 'A00000000'
export function sortBetween(a: string | null, b: string | null): string;
// 规则：(null,'z')->前半；('A00',null)->'A0'后再半；冲突时自动加长一位再取中；两侧等值/逆序 throw InvalidSortRange
export function sortSequence(n: number): string[];        // 连续生成 n 个递增键（长度<=16）

// segment.ts
export interface Segment {
  seg_id: string;                    // `seg-<lamportC:8hex>-<deviceId>-<n:6hex>` 自校验
  schema_ver: number;                // ==SCHEMA_VERSION
  header: { dev: ActorId; c_from: number; c_to: number; n: number; created_at: number };
  ops: Op[];                         // 非空、按 compareLamport 升序、op_id 无重复
}
export function encodeSegment(seg: Segment): string;      // 首行 {"h":...}，其后每行一个 encodeOp，末尾 '\n'
export function decodeSegment(text: string): Segment;     // 结构/顺序/schema_ver 全校验
export function segmentName(seg: Segment): string;
export function assertSegmentName(name: string, seg: Segment): void;  // 文件名与内容一致，否则 throw

// projection.ts / replay.ts / snapshot.ts
export interface Entity { table: TargetTable; id: EntityId; version: number; alive: number;
  data: Record<string, unknown>; lamport: Lamport }
export class Projection {
  get(table: TargetTable, id: EntityId): Entity | null;
  all(table: TargetTable): Entity[];                     // 含 alive=0
  entities(): Entity[];
}
export interface ReplayReport { conflicts: Array<{ table: TargetTable; id: EntityId; kept: Lamport; lost: Lamport }> }
export function replay(ops: Op[], into?: Projection): { projection: Projection; report: ReplayReport };
// 语义：lamport 升序应用；upsert/patch: 仅当 op.lamport > entity.lamport 才生效，否则记 conflict（lost 方保留在 report，实现“冲突副本”素材）；delete=upsert{alive:0}；move/reorder 改 data 的 parent/sort_key 字段，同样 lww
export function opsToSnapshot(p: Projection): string;    // {v:schema_ver, entities:[...]} 稳定键序 JSON
export function snapshotToOps(snap: string, deviceId: ActorId, startC?: number): Op[];  // 回转，供新设备播种
```

## 4. 必测清单（vitest，测试名照抄语义）
- clock: `tick 单调递增` / `witness 拉齐且不越过` / `compareLamport 同 c 比 d`
- ulid: `单调递增（同毫秒内）` / `长度 26 Crockford 字符集` / `可解析回 timestamp`
- sortkey: `between(null,null)=INITIAL` / `1000 次随机 between 保持有序且长度<=16` / `等值相邻触发加长` / `非法区间 throw`
- segment: `encode→decode roundtrip 恒等` / `乱序 ops 段被拒绝` / `schema_ver 不符被拒绝` / `文件名与内容不符被拒绝` / `空 ops 段被拒绝`
- replay: `同集 ops 任意输入顺序重放结果全等`（随机打乱 ×100）/ `双写同实体 → 高 lamport 胜出且 report 记录 lost` / `delete 后 upsert 更低版本被忽略` / `snapshot→ops→replay == 原投影`
- **fuzz（收敛性红线）**：随机生成 200 个设备各 50 op 交织 → 三种乱序重放 → 实体表逐字节相等。跑不进 CI 时长预算（<10s）就降到 50×50，**但不许删该测试**。
- schema: `SCHEMA_VERSION 导出` / `zod→JSON Schema 生成非空且含 block/page 全字段`

## 5. apps/desktop 渲染器（本阶段仅此，别做多了）
App.tsx：一个居中的最小版式（**不要求 UI 设计，UI 由 PM 另行负责**）：
- 文本 `Septcats · 工程骨架`；
- 一个按钮「IPC 自检」→ 调 `window.septcats.ping()` 显示返回的时间戳字符串；
- 页面加载完成即从 CSS 变量 `--sc-token-placeholder` 读一次颜色应用（tokens 占位用，正式 DESIGN.md 后续替换）。
主进程 `pnpm dev` 必须能开窗口；`pnpm build` 能产出（electron-builder 配置可后补，本阶段 build=electron-vite build，不需要出安装包）。

## 6. 完成定义（Definition of Done，PM 将逐条执行）
```bash
cd Septcats
pnpm install            # 0 exit
pnpm typecheck          # 所有包 0 error
pnpm test               # 全绿，含 fuzz
pnpm test:coverage      # packages/core src/ 行覆盖 >= 90%
pnpm build              # electron-vite build 成功
node -e "import('./packages/core/src/index.ts')" # 不要求；仅证明无 electron 泄漏的替代：grep -r "from ['\"]electron" packages/ 必须 0 命中
```
交付报告（stdout 末尾输出）：文件清单 + 每步命令真实输出摘要 + 未实现项/取舍说明。

## 7. 边界
- 不做：UI 视觉、数据库、迁移、同步引擎、打包签名。
- 依赖白名单：`electron`(devDep，仅 apps/desktop)、`react`、`react-dom`、`electron-vite`、`vite`、`@vitejs/plugin-react`、`typescript`、`vitest`、`@vitest/coverage-v8`、`zod`。除此之外一律先不装，不确定的不装并在报告说明。
