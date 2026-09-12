# TASK-M0-M1-01 · Septcats monorepo 骨架（M0）+ 平台适配层（M1）

> 发件人：Hermes（PM）｜ 收件人：CodeBuddy（代码工程师）
> 仓库：`E:\Hermes Agent工作空间\Septcats`（Windows 为主，代码必须 mac 兼容）
> SSOT：`docs/PROJECT_PLAN.md` v0.2。本任务书只做 **M0 + M1**，越界改动会被打回。
> 角色纪律：你写代码与测试并本地跑通；**不要 git commit/push**，提交由 PM 审查后执行。

## 0. 一句话目标
搭起可运行的 pnpm monorepo + Electron 三进程骨架（electron-vite），并交付 `packages/platform`：数据目录/钥匙串/凭据/日志等 OS 差异全部收口在这一个包里，之后任何模块不得直接 import `os.homedir()`、`app.getPath` 之外的路径推导逻辑。

## 1. 目录与包（结构必须一致）
```
Septcats/
├─ package.json              # private, "packageManager":"pnpm@9", engines node>=20.19
├─ pnpm-workspace.yaml       # apps/* packages/*
├─ tsconfig.base.json        # strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes + moduleResolution bundler + target ES2022
├─ .editorconfig  .gitignore(已有,追加 out/dist/coverage/*.local)
├─ packages/
│  ├─ core/      # @septcats/core   纯 TS：错误码、Result、ids(自写 ULID)、时间、zod schemas（**禁止 import electron/node:fs/crypto**）
│  └─ platform/  # @septcats/platform  见 §3
├─ apps/desktop/             # electron-vite 应用
│  ├─ package.json           # scripts: dev/build/start/typecheck/test/lint
│  ├─ electron.vite.config.ts
│  ├─ tsconfig.json / tsconfig.node.json / tsconfig.web.json
│  ├─ src/main/index.ts      # 入口：单实例锁→创建窗口（含平台注入，见 §4）
│  ├─ src/preload/index.ts   # contextBridge 暴露最小 api：{app:{version,platform}, diagnostics:{logDir()}}
│  ├─ src/renderer/          # React18 空壳：index.html + src/main.tsx（只渲染 <div id=root> Septcats skeleton + 版本号）
│  └─ src/shared/ipc.ts      # IPC channel 常量与类型（单一来源）
└─ docs/（不动）
```
包间引用：workspace protocol（`workspace:*`）。core/platform 用 `exports` 指向 `src/*.ts`（消费端由 Vite/tsx 直编，M0 不产出 dts 构建，但 **typecheck 必须过**）。

## 2. 依赖白名单（超出即打回）
`electron@^37`、`electron-vite@^5`、`vite@^7`、`@vitejs/plugin-react@^5`、`react@^18`、`react-dom@^18`、`typescript@^5.9`、`vitest@^3`、`zod@^4`、`@septcats/*`(workspace)。
devDeps: `@types/node@^22`、`@types/react`、`@types/react-dom`、`electron-builder@^26`(仅声明 scripts，配置留 M10)、`@eslint/js`+`eslint@^9`+`typescript-eslint@^8`、`prettier@^3`。
**禁止**：`@secretagent/keytar`（mac/win 二进制宜，但一期我们用 OS 原生 CLI 方案，见 §3.2）。

## 3. packages/platform API 契约（全部必须有 vitest 单测）
```ts
// 3.1 paths
export interface PathLayout { root: string; db: string; attachments: string; logs: string; tmp: string; crashDumps: string }
export function resolveLayout(opts: { appName: string; overrideRoot?: string; homeDir?: string; platform: NodeJS.Platform }): PathLayout
// 默认 <home>/.<appName小写>；overrideRoot 存在则直接用它（同步文件夹场景）；所有目录路径统一 POSIX 分隔符输出；不 mkdir（副作用留给 ensureDirs()）
export function ensureDirs(layout: PathLayout): Promise<void>   // recursive mkdir，幂等
// 3.2 credentials（OS 原生 CLI，零编译依赖；mac 分支代码写好但 CI 只在 win 跑）
export interface CredentialStore { get(s: string, k: string): Promise<string | null>; set(s: string, k: string, v: string): Promise<void>; delete(s: string, k: string): Promise<boolean>; isAvailable(): Promise<boolean> }
export function createCredentialStore(env?: NodeJS.ProcessEnv): CredentialStore
// win: powershell -NoProfile -Command 调用 [Management.Automation.PSCredential] 存/取（New-Object PSCredential + ConvertFrom-SecureString 落注册表 HKCU\Software\Septcats\Cred 不可行——改用 cmdkey /generic:Septcats/<service>:<key> 存，读取用 PowerShell CredentialManager 不可用时降级 DPAPI：Set-Content/Get-Content + ConvertFrom-SecureString）
// 实现细节你定，但必须满足：**密钥字符串不出现在命令行参数明文里（stdin/文件传递）**；测试在 win 上真存真取一轮；isAvailable() 在无钥匙串环境返回 false 而非抛错。
// 3.3 appPaths bootstrap（main 进程用）
export function bootstrapPaths(cfg: { appName: string; electronUserData: string; settingsRootPath?: string }): PathLayout  // 记录 settings.json 于 <electronUserData>/septcats.settings.json（key: rootPath），后续可迁移（写 migrate marker）
// 3.4 logger
export interface ModuleLogger { info(msg: string, ctx?: Record<string, unknown>): void; warn(...); error(...) }
export function createLogger(layout: PathLayout): { forModule(name: string): ModuleLogger; flush(): Promise<void> }
// <logs>/<module>.log，electron-log 格式 `ISO 级别 (module) 消息 {json ctx}`，10MB 滚动一份 .old，进程崩溃不丢未刷写（每行立即 append）。
```
**安全红线**：任何 API 不得把凭据值写入日志/错误消息（测试里断言过：set 后日志文件内不含该值）。

## 4. apps/desktop 行为要求
1. main：`app.requestSingleInstanceLock()` 失败即 exit；二次启动聚焦已有窗口。
2. BrowserWindow 基线：`sandbox:true, contextIsolation:true, nodeIntegration:false, webviewTag:false`；`show:false` + `ready-to-show` 显示；窗口态持久化（bounds/最大化 → `<electronUserData>/window-state.json`，启动恢复；多显示器越界时钳回主屏）。
3. 崩溃钩子：`process.on('unhandledRejection'|'exception')` → logger.error + 写 `<logs>/crash-<ts>.json`（不退出，异常仅记录；uncaughtException 记录后再 exit(1)）。
4. IPC：preload 暴露 `septcatsApp.version()`（invoke 'app:version'），main 应答 `app.getVersion()`；`app:meta` 返回 `{version, platform, layoutRoot}`。**channel 字符串一律从 src/shared/ipc.ts import，禁止裸字符串。**
5. renderer 只允许 import：react/react-dom/@septcats/core/@septcats/platform（浏览器安全子集——platform 的 paths/logger 在渲染器不可用则拆 `@septcats/platform/browser` 入口，或干脆只 import core；你评估后选简单方案，写进交付报告）。

## 5. CI（.github/workflows/ci.yml）
`windows-latest + macos-latest` 双矩阵：`pnpm install --frozen-lockfile → pnpm -r typecheck → pnpm -r test → pnpm -C apps/desktop build`（build 失败可先标 continue-on-error 并注释原因，其余不许松）。

## 6. Definition of Done（PM 会逐条复跑，任一失败即打回）
```bash
cd E:/Hermes\ Agent工作空间/Septcats   # bash 下
pnpm install            # lockfile 生成并提交在报告说明
pnpm -r typecheck       # 0 error
pnpm -r test            # 全绿（含 platform 真机凭据一轮、logger 写入断言）
pnpm -C apps/desktop dev -- --no-sandbox  # 能起窗（你 headless 环境起不来就在报告说明验证方式，PM 真机复跑）
pnpm -C apps/desktop build
grep -rn "homedir\|getPath('userData')" apps/desktop/src packages --include=*.ts | grep -v platform | grep -v ".test."   # 必须 0 命中（路径收口验证）
```

## 7. 交付报告格式（stdout 最后一段，必须）
```
REPORT-M0-M1-01
DONE: [文件清单，按包分组]
TESTS: <n> passed / <n> failed（贴 vitest 摘要行）
COMMANDS: install/typecheck/test/build 各自真实退出码
DECISIONS: [你做的契约内裁量 + 理由]
DEVIATIONS: [与本任务书任何偏离，逐条；无则写 none]
BLOCKERS: [环境导致的未验证项；无则写 none]
```
先复述你对本任务书的理解（3-5 行），再开工。
