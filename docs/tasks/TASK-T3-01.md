# TASK-T3-01 · M1 平台适配层（packages/platform）+ 路径收口

> PM：Hermes ｜ 工程师：CodeBuddy ｜ 仓库：E:\Hermes Agent工作空间\Septcats
> 前置：T2 已合入（migrations/server 等已存在，别动）。SSOT：计划书 §7 M1。
> 纪律同前：只 Write/Edit 文件；**不跑终端命令、不碰 git**；一次写完整，无占位符。

## 0. 目标
新建 `packages/platform`，把一切 OS 差异（路径/凭据/日志）收口进这一个包，并把 apps/desktop 主进程接上它。**收口红线：完成后 `grep -rn "homedir" apps/desktop/src packages/core packages/schema`（排除 node_modules/dist/out/注释）必须 0 命中** —— 现在 main/index.ts 里的 `os.homedir()` 就是本次要消灭的对象。

## 1. 包结构
```
packages/platform/
  package.json      # @septcats/platform；deps: zod；peer 无；exports "./src/index.ts"
  tsconfig.json     # extends base
  vitest.config.ts  # node env, include test/**/*.test.ts
  src/
    index.ts        # 统一导出
    layout.ts       # §2
    credentials.ts  # §3
    logger.ts       # §4
    settings.ts     # §5 bootstrapPaths + migrateRootPath
  test/
    layout.test.ts credentials.test.ts logger.test.ts settings.test.ts
```
纯 Node 实现，不 import electron（electron 相关 glue 留在 desktop 侧薄封装 `apps/desktop/src/main/platform.ts`，§6）。

## 2. layout.ts
```ts
export interface PathLayout { root:string; db:string; attachments:string; logs:string; tmp:string; crashDumps:string }
export function resolveLayout(opts: { appName: string; overrideRoot?: string; homeDir: string; platform: NodeJS.Platform }): PathLayout
// 默认 root = join(homeDir, '.'+appName.toLowerCase())；overrideRoot 存在则 root=overrideRoot（绝对路径校验，否则 throw）
// db=root/septcats.db, attachments=root/attachments, logs=root/logs, tmp=root/tmp, crashDumps=root/crashDumps
// 输出全部 path.normalize 后的平台原生路径（内部存储 POSIX 由调用方转换，这里不混用）
export async function ensureDirs(layout: PathLayout): Promise<void>  // recursive mkdir 幂等
export async function estimateFreeBytes(dirPath: string): Promise<number> // 跨平台粗略：statvfs via node:fs.promises.statfs（node22 有 statfs）
```

## 3. credentials.ts（安全红线最多的一节）
```ts
export interface CredentialStore {
  get(service: string, account: string): Promise<string | null>
  set(service: string, account: string, secret: string): Promise<void>
  delete(service: string, account: string): Promise<boolean>
  isAvailable(): Promise<boolean>
}
export function createCredentialStore(env?: NodeJS.ProcessEnv): CredentialStore
```
约束（违反即打回）：
1. **密钥明文绝不出现在任何子进程的 argv、任何日志、任何错误消息中**。传输路径自定，推荐：Windows 用 PowerShell + DPAPI（`ProtectedData::Protect`，CurrentUserData 域）将密文写入 `<credDir>/<service>__<account>.enc`（credDir 默认 `join(layoutRoot?, ...)` ——不，store 不感知 layout：构造参数传 `{ credDir }`，测试用 tmpdir；生产 desktop 传 `<root>/credentials`）。读回：文件→Unprotect→stdout 捕获。
2. macOS 分支用 `/usr/bin/security add/find/delete-generic-password -s <service> -a <account>`（写密码用 `-X <hex>` 避免 argv 明文；win 无对应就自行设计 stdin 方案）。
3. `isAvailable()`：探测子进程可用性，永不抛；不可用时 get/set 抛稳定错误码 `E_CRED_UNAVAILABLE`。
4. service/account 名白名单 `[a-z0-9_-]{1,32}` 防注入；文件名校验拒绝路径穿越。
5. 测试（win 上必须真跑）：set→get 恒等；密文文件不含明文（readFileSync + includes 断言）；argv 审计（spawn wrapper 记录参数断言无明文）；非法名拒绝；delete 幂等。

## 4. logger.ts（对齐 Notion 分模块日志风格，electron-log 格式）
```ts
export interface ModuleLogger { info(msg: string, ctx?: Record<string, unknown>): void; warn; error }
export function createLogger(layout: PathLayout, opts?: { level?: 'info'|'warn'|'error' }): {
  forModule(name: string): ModuleLogger; flush(): Promise<void> }
```
- `<logs>/<module>.log`；行格式 `[${ISO}] [${LEVEL}] (${module}) ${msg}${ctxJson}`；立即 appendFile（10MB 滚动 → `.old` 覆盖式）。
- 名称白名单 `[a-z0-9-]{1,40}`；写失败静默吞（日志器绝不能崩宿主）但计数 `droppedLines` 可从 flush 返回。
- **脱敏红线**：ctx 中 key 命中 /token|secret|password|credential|apikey/i（不区分大小写、去分隔符比较）时值替换为 `[redacted]`；嵌套对象递归；数组元素同样。必须有测试。
- 测试：多行即时可读（不 flush 也在盘上）；滚动；脱敏；错误吞掉不抛。

## 5. settings.ts
```ts
export function readSettings(userDataDir: string): { rootPath?: string; schema: 1 }
export function writeSettings(userDataDir: string, s: { rootPath?: string }): void   // 原子写 tmp+rename
export async function bootstrapPaths(opts: { appName: string; electronUserData: string; homeDir: string; platform: NodeJS.Platform }): Promise<PathLayout>
// 读 userDataDir/septcats.settings.json 的 rootPath → resolveLayout(overrideRoot?) → ensureDirs
export async function migrateRootPath(layout: PathLayout, toDir: string, opts:{ copyFile?:(a,b)=>Promise<void> }?): Promise<PathLayout>
// 1) toDir 绝对且存在校验 2) 复制 db+attachments/**+settings.json 到 toDir（逐文件 fsync 语义：写完重命名） 3) 新 layout ensureDirs 4) 写新 root 下 marker `.septcats-root`（JSON: migratedAt, from）5) 更新 userDataDir settings 6) 旧目录不删（保守），返回新 layout
// 中途失败：已复制的新文件删除回滚；settings 不更新。必须有测试（注入失败的第 3 个文件）。
```

## 6. desktop 接入（改动清单）
- `apps/desktop/package.json`：deps + `"@septcats/platform": "workspace:*"`。
- `apps/desktop/src/main/platform.ts`（新）：`initPlatform(): Promise<{ layout, logger, credentials }>` —— bootstrapPaths(appName='septcats', electronUserData=app.getPath('userData'))、createLogger、createCredentialStore({credDir: layout.root/credentials})。**除这里以外，desktop/src 任何文件不得再出现 os.homedir 或自拼 '~'。**
- `apps/desktop/src/main/index.ts`：删除本地 `resolveDataRoot()` 与内联 `log()` 实现，改 import `initPlatform()`；crash dump 目录用 layout.crashDumps；单实例锁/窗口逻辑不变。
- 主进程 `app.on('ready')` 前完成 initPlatform（await 后建窗）。
- preload 的 `appMeta` 返回 layoutRoot 的 basename（不泄露完整家目录路径，隐私默认）。

## 7. 根配置
- `vitest.config.ts` projects 追加 `'packages/platform'`；根 package.json scripts 不变（-r 自动覆盖）。

## 8. DoD（PM 复跑）
```
pnpm install && pnpm -r typecheck && pnpm -r test
pnpm -C apps/desktop selftest          # 回归不许破
grep -rn "homedir" apps/desktop/src packages --include=*.ts | grep -v test/   # 0 命中
pnpm -C apps/desktop build
```
报告格式同前。先复述理解（≤5 行）再动笔。
