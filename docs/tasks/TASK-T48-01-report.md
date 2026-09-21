# TASK-T48-01 交付报告 · P1 发布前门禁：rc.26 打包产物启动冒烟 + 包内代码验证

> 执行：CodeBuddy（工程师，唯一作者）
> 任务书：本单（`rc.26 打包产物启动冒烟 + 包内代码验证`）
> 结论：**54/54 PASS，`fatal=false`。打包产物 rc.26 能装完起得来**——DB/同步运行时均就绪，无任何「数据库服务启动失败 / 同步运行时不可用」文案，`pageerror` 与 renderer console error 双 0，`window.close()` 优雅退出（未强杀）。
> 纪律：**只新增探针与报告**；未改产品源码、未碰 git、未重打包、**未跑 ensure-abi**、**未跑任何 vitest**。

---

## §0 被测对象与环境（先钉身份，再谈结论）

| 项 | 值 |
|---|---|
| 安装包 | `apps/desktop/dist/Septcats Setup 0.3.0-rc.26.exe` |
| **实际被测的可执行体** | `apps/desktop/dist/win-unpacked/Septcats.exe`，size=`204521984`，mtimeMs=`1789930444749.7832`（2026-09-21 02:54） |
| 包 | `apps/desktop/dist/win-unpacked/resources/app.asar`，size=`46510913`，mtimeMs=`1789930444451.224`；asar 头 `dataOffset=1889792 headerSize=1889784 strLen=1889774 条目数=7293` |
| 包内自报版本（运行时实测） | `appMeta()` → `{"name":"@septcats/desktop","version":"0.3.0-rc.26","schemaVersion":3,"layoutRoot":"data"}` |
| 夹具（自建，**与真实数据根物理隔离**） | `--user-data-dir=E:\Hermes Agent工作空间\_scratch\t48-01\ud`，`rootPath=E:\Hermes Agent工作空间\_scratch\t48-01\data` |
| 启动命令 | `...\win-unpacked\Septcats.exe --user-data-dir=<UD> --remote-debugging-port=9481 --force-device-scale-factor=1` |
| 真实数据根 | `C:\Users\Administrator\.septcats` — 前后 mtime **完全一致**（`1789808566516.3271` → `1789808566516.3271`） |

隔离的**反证**（不是只靠「我没写」自证）：包内自报 `layoutRoot` = `"data"`（= 夹具目录名）；若 `rootPath` 未生效会是 `.septcats`。
另：夹具目录被真实写入——`data\septcats.db` 存在、`data\logs\{main,db,sync,ai}.log` 四份、`data\sync\manifest.json` + 1 个段文件，文件数 15。

**ABI 相关**：本轮只跑打包产物（自带 electron ABI），**未跑 ensure-abi、未切 ABI**。原生模块 ABI 是否正确的**权威证据就是运行时本身**——`better_sqlite3.node` 能加载起来、`sync.status()` 能返回快照（见 §1 b）。静态侧另有两条加固断言见 §2 iv。

---

## §1 ① 启动冒烟（逐条 a–f，贴原始值）

### a) 启动后 10s 窗口内失败文案扫描

采样口径：CDP 接通并挂上 `console`/`pageerror` 监听后起算，**10 000ms** 窗口、每 **200ms** 取一次 `document.body.innerText`，共 **49 帧**。CDP 接通延迟 `cdpAttachMs=587`。

| token | 命中数 | 首次 | 末次 | 原文 |
|---|---|---|---|---|
| `数据库服务启动失败` | **0** | — | — | — |
| `同步运行时不可用` | **0** | — | — | — |
| `加载中` | 1 | 633ms | 633ms | 见下（**瞬态**，见 DEVIATION-1） |

- 首帧（`atMs=633`）DOM 文本原文：
  `"当前工作区 同步状态加载中… 个人工作区 新建页面 收藏 0 最近 0 Wiki 0 暂无 Wiki 页 回收站 还没有页面。在左侧栏「新建页面」，或从模板开始。"`
- 末帧（`atMs=10471`）DOM 文本原文：
  `"个人工作区 已同步 · 刚刚 个人工作区 新建页面 收藏 0 最近 0 Wiki 0 暂无 Wiki 页 回收站 还没有页面。在左侧栏「新建页面」，或从模板开始。"`
- 10s 末次 body 文本原文（全文，115 字）与末帧一致 → 同步状态钮已由占位 `同步状态加载中…` 落到 **`已同步 · 刚刚`**。

> 「加载中」命中为 1 次、且只出现在启动瞬态的**同一帧**（`observedMs=0`）——不是滞留。判据落地见 **DEVIATION-1**。

### b) DB / 同步服务就绪（原始返回值，renderer 侧真调用）

```json
ping()            → "2026-09-21T00:21:24.969Z"
appMeta()         → {"name":"@septcats/desktop","version":"0.3.0-rc.26","schemaVersion":3,"layoutRoot":"data"}
sync.status()     → {"state":"ok","enabled":true,"lastSyncAt":1789950084763,
                     "devices":[{"actorId":"01m30nd7tt6gdw3n4y6gvdx18k","lastLamport":0,
                                 "lastSeenAt":1789950084759,"clientVer":"0.3.0-rc.26"}],
                     "pendingOps":0,"pendingSegs":0,"conflicts":0,"errors":[]}
workspaces.list() → {"items":[{"id":"01M30ND80571BEZ409RHHWBQZR","name":"个人工作区"}],
                     "activeId":"01M30ND80571BEZ409RHHWBQZR"}
pages.tree()      → []      （Array(0)；夹具是新库，尚无页面——DB 读路径通）
```

- **就绪探测期间收集到的 IPC 错误：`[]`**（零 `E_INVARIANT` / 零 `E_DB_UNAVAILABLE`）。
- 关键否定：`sync.status()` **没有**抛 `E_INVARIANT: 同步运行时不可用（数据库服务启动失败，见日志）`（该文案住 `src/main/sync/ipc.ts:63`）。若原生模块 ABI 不匹配，此调用就是第一条崩线——**实测通过**。
- 附加（非任务书要求，INFO）：`ai.setChatConfig({requestTimeoutSec:45})` → `{"chatTimeoutSec":45,"maxOutputTokens":null}`，T46 通道在包内**活体可调**。

### c) 主界面渲染完成

| 选择器 | 命中数（启动完成态，未建页） |
|---|---|
| `.sc-shell__topbar` | 1 |
| `.app-side` / `.sc-shell__sidebar` | 1 / 1 |
| `.app-main-row` / `.app-editor-col` | 1 / 1 |
| `.pv-root` | 1 |
| `.pv-body`（编辑器） | 0 |
| **`.pv-empty`（空态）** | **1** |
| `.ProseMirror` | 0 |
| `.sc-sync-status__pill` | 1，label=`"已同步 · 刚刚"` |
| `.tabsbar` / `.tabsbar-tab` | 0 / 0（该布局预设下页签条隐藏） |
| `[data-testid^="side-node-"]` | 0（新库无页面，符合预期） |

窗口/尺寸：`window.innerWidth x innerHeight = 1184 x 735`（客户区；产品自身 `BrowserWindow` 固定 1200×800，见 DEVIATION-7）。
`#root` 首段 HTML：`<div class="sc-shell"><header class="sc-shell__topbar"><button type="button" aria-label="收起侧栏" …`

建页后（下一步 d 的前置，同一进程内）：
`.pv-body=1 .ProseMirror=1 .pv-empty=0 .tabsbar=1 .tabsbar-tab=1 side-node 行数=1`，
body 文本 `"T48 冒烟页 已同步 · 刚刚 个人工作区 新建页面 收藏 0 最近 1 Wiki 0 暂无 Wiki 页 T48 冒烟页 回收站 T48 冒烟页 🔭 T48 冒烟页 转为多维数据 反向链接 暂无页面引用本页"`。
→ **写路径（建页/落库）+ 编辑器挂载链路在包内通。**

### d) UI 活着：⋯ 菜单 + 命令面板（贴数组）

- 页面 ⋯ 菜单（`.sc-menu` 最后一个的 `[role=menuitem] .sc-menu__label`，原样数组）：

```
["固定宽度","转为 Wiki","删除"]
```

  （`⋯ 按钮数=1`；T41 全宽开关 + T42 承载转换 + 删除三项齐）
- 命令面板（`Ctrl+K` → `[data-testid="palette-panel"]`，`aria="命令面板"`，**行数 19**）：

```
["新建页面","切换工作区","打开设置","切换主题：浅色","切换主题：深色","切换主题：跟随系统",
 "导出","回收站","同步面板","导入","AI 续写","AI 摘要","AI 改写","AI 翻译","另存为模板",
 "删除页面","打开 / 关闭 AI 对话","切换布局预设","全宽 / 固定宽度"]
```

  打开尝试记录：`{"attempts":[{"how":"Control+k（playwright press）","panel":true,"overlay":true,"active":"INPUT."}]}`
- T44 反向链接面板（活体）：`{"title":"反向链接","empty":"暂无页面引用本页","items":0}`；`links.backlinks()` → `{"entries":[]}`。

### e) 全程错误计数

| 项 | 计数 | 原文 |
|---|---|---|
| `pageerror` | **0** | `[]` |
| renderer `console` error | **0** | `[]` |

### f) 优雅退出

`window.close()` → 2.5s 后 PID 已消失 → **`gracefulExited=true`（未强杀）**。

---

## §2 ② 包内代码验证（直接解析 `app.asar`，贴原文片段）

解析方式：自实现 asar 头解析（8 字节头 + pickle JSON + 拼接数据；`dataOffset=8+headerSize`，文件项 `offset` 相对数据区），不依赖 `npx asar`。

### i) 渲染层 CSP 含 `127.0.0.1`

`out/renderer/index.html` 的 CSP meta **整条原文**：

```html
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: asset: attachment:; font-src 'self' data:; connect-src 'self' asset: attachment: ws://localhost:* http://localhost:* ws://127.0.0.1:* http://127.0.0.1:*" />
```

`connect-src` 段原文：

```
connect-src 'self' asset: attachment: ws://localhost:* http://localhost:* ws://127.0.0.1:* http://127.0.0.1:*
```

→ 含 `http://127.0.0.1:*` 与 `ws://127.0.0.1:*`（本机 AI 端点放行）。

### ii) main 侧 T46 新模块与文案（`out/main/index.js` 1 004 441 B + `out/main/dbServer.js` 75 768 B + `out/main/chunks/rpc-ZjInI5ck.js` 31 900 B）

| token | 命中 | 包内原文片段（截取） |
|---|---|---|
| `chatConfig` | 11 | `class AiService { credentials; getSettings; client; log; now; cache; chatConfigStore; fallbackChatTimeoutMs; constructor(options) { …` |
| `setChatConfig` | 5 | `const CHANNEL_AI_CLEAR_KEY = "ai:clearKey"; const CHANNEL_AI_SET_CHAT_CONFIG = "ai:setChatConfig"; …` |
| `ai:setChatConfig` | 2 | 同上片段 |
| `ai-chat-config.json` | 1 | `const AI_MAX_OUTPUT_TOKENS_MAX = 131072; const AI_CHAT_CONFIG_FILE_NAME = "ai-chat-config.json"; const AI_CHAT_CONFIG_VERSION = 1; const DEFAULT_AI_CHAT_RUNTIME_CONFIG = { requestTim…` |
| `等待超过` | 1 | `if (code === "E_AI_TIMEOUT") { throw new AiError( "E_AI_TIMEOUT", \`等待超过 ${describeTimeoutSeconds(timeoutMs)} 秒已中止（${hostOf$1(baseUrl)}）\` ); }` |

### iii) 渲染层 T44 / T41 / T46 文案（`out/renderer/assets/index-CDyXm5n7.js` 1 953 467 B）

| token | 命中 | 包内原文片段（截取） |
|---|---|---|
| `链接到页面 · 输入以过滤` (T44) | 1 | `// T44-01：双链（Obsidian 式 [[ ]]） wikilinkMenuTitle: "链接到页面 · 输入以过滤", wikilinkMenuEmpty: "无匹配页面", backlinksTitle: "反向链接", backlinksEmpty: "暂无页面引用…` |
| `无匹配页面` (T44) | 1 | 同上 |
| `反向链接` (T44) | 1 | `… backlinksTitle: "反向链接", backlinksEmpty: "暂无页面引用本页", backlinksJumpAria: "跳转到引用位置" }, tabs: { bar…` |
| `暂无页面引用本页` (T44) | 1 | 同上 |
| `跳转到引用位置` (T44) | 1 | 同上 |
| `固定宽度` (T41) | 5 | `pageWidth: { // T41-01：页面 ⋯ 菜单项的两种状态文案（✓ 前缀 = 当前页为全宽） full: "全宽", fixed: "固定宽度" }` |
| `全宽 / 固定宽度` (T41) | 2 | `… saveAsTemplate: "另存为模板", delete: "删除页面", toggleFullWidth: "全宽 / 固定宽度" }` |
| `模型未返回正文（仅推理内容）` (T46) | 1 | `reasoningOnlyNotice: "模型未返回正文（仅推理内容）", emptyReplyNotice: "模型未返回正文（可重试，或调大「最大输出 tokens」）", lengthNotice: "达到输出上限，可增大 ma…` |
| `模型未返回正文（可重试，或调大「最大输出 tokens」）` (T46) | 1 | 同上 |
| `可在设置 › AI 助手中调大「请求超时」（当前 {n} 秒）。` (T46) | 1 | `timeoutHint: "可在设置 › AI 助手中调大「请求超时」（当前 {n} 秒）。", timeoutHintBare: "可在设置 › AI 助手中调大「请求超时」。", promptRole: "你是 Septcats 笔记应用内置的 AI …"` |
| `可在设置 › AI 助手中调大「请求超时」。` (T46) | 1 | 同上 |
| `请求超时已设为 {n} 秒` (T46) | 1 | `… requestTimeoutSave: "保存超时", requestTimeoutSaved: "请求超时已设为 {n} 秒", maxTokens: "最大输出 tokens（可选）" …` |

> 任务书 ②ii 举例把「模型未返回正文」列在 main 侧；实测 **main 侧 0 命中**（该文案属 renderer i18n），已改钉在 ②iii。见 **DEVIATION-5**。

### iv) 加固项（任务书未列，本单主动补的两条）

1. **原生模块打包形态**（直击本次门禁的动机）：
   asar 头里 `node_modules/better-sqlite3/build/Release/better_sqlite3.node` 条目 **`unpacked=true` 且无数据偏移**（= 字节不在 asar 数据区），物理文件存在于
   `resources/app.asar.unpacked/node_modules/better-sqlite3/build/Release/better_sqlite3.node`，size=`1918976`。
   → 与「留在 node ABI / 留在包内」的失败形态**明确区分**（见 DEVIATION-6）。
2. **隔离反证**：`appMeta().layoutRoot === "data"` + 夹具目录真实落盘 + 真实 `.septcats` mtime 不变（见 §0）。

---

## §3 产物

| 产物 | 路径 |
|---|---|
| 探针 | `docs/mockups/probe-rc26-smoke.mjs`（`node docs/mockups/probe-rc26-smoke.mjs`，本次 elapsed ≈ 29.5s） |
| 原始数值 | `docs/mockups/screens-t48/rc26-smoke-results.json`（54 PASS / 0 FAIL / `fatal=false`，80 条 assertion） |
| 截图①启动完成态 | `docs/mockups/screens-t48/rc26-smoke-01-boot.png`（1184×735，18755 B）— 侧栏 + 空态 + 顶栏 `已同步 · 刚刚` |
| 截图②⋯ 菜单态 | `docs/mockups/screens-t48/rc26-smoke-02-page-menu.png`（1184×735，29953 B）— 页面 ⋯ 菜单三项展开 |
| 现场保留（**未清理**） | `_scratch/t48-01/`（`ud\` 71 文件、`data\` 15 文件）+ `app-stdout.log` / `app-stderr.log` |

---

## §4 DEVIATION（逐条：与任务书字面不一致处 + 我的处置 + 理由）

### DEVIATION-1 ·「加载中」判据由「不出现」改写为「不滞留」
- **任务书**：a) 断言 10s 内**不出现**「数据库服务启动失败」「同步运行时不可用」「加载中」。
- **实测**：前两条 0 命中；「加载中」在启动后 **633ms** 命中 1 次，命中文本 `同步状态加载中…`，**下一帧即消失**，10s 末帧不含。
- **根因（读源码定位）**：`src/renderer/src/sync/SyncStatus.tsx:45-46` —— `if (status === null) { return { key: 'syncing', label: t('sync.stateLoading') }; }`（`zh-CN.ts:387: stateLoading: '同步状态加载中…'`）。这是 `sync.status()` 在途时的**设计占位**，与两条故障文案（`main/sync/ipc.ts:63`、`main/collab.ts:371` 抛的 `E_INVARIANT`）性质不同。
- **处置**：不删该断言，改为两条可证伪的判据——①「命中只允许出现在 ≤3s 的启动瞬态窗口」（实测 `observedMs=0`，即同帧即退）②「10s 末帧 body 不含『加载中』」。两条均 PASS，原始命中时刻/上下文留在 results.json。
- **为什么不是「放水」**：真正的风险形态是**卡在加载态**（永不退场）；该判据对「卡住」会 FAIL。若 PM 坚持字面口径，须先改产品（把那句占位文案改词），但本单红线**禁改产品源码**，故按上述落地。

### DEVIATION-2 · 本次运行**不是零外网**（打包产物自身发起）
- **实测**：主进程 stderr 首行原文
  `Error: Error: Cannot find channel "rc.yml" update info: HttpError: 404`
  URL：`https://github.com/nathanjngogo/septcats-releases/releases/download/latest/rc.yml?noCache=…`
  stdout：`Checking for update` / `Generated new staging user ID: …`
  栈底：`at async check (…\app.asar\out\main\index.js:1049:7)`
- **性质**：产品既有行为——启动即做一次自动更新检查（electron-updater，feed 见 `apps/desktop/electron-builder.yml` 的 `publish`），本次因 feed 上无 `rc.yml`（预发布通道未铺）而 404。**非本探针引入**（探针自身零外网请求）。
- **影响评估**：仅主进程 stderr；**renderer `pageerror`/`console error` 均为 0**，UI 无任何错误提示，同步/DB 全部就绪。
- **处置**：如实上报，未改产品代码、未屏蔽日志。**请 PM 注意**：发布前应确认预发布通道 `rc.yml` 是否需要铺（`latest.yml` 同理会 404）。

### DEVIATION-3 · 命令面板打开前置：焦点须离开编辑器（renderer 侧 Ctrl+K）
- **任务书**：d) 「页面 ⋯ 菜单/命令面板可打开」。
- **实测**：首轮探针在「点进编辑器 → 按 Ctrl+K」后 `palette-panel` 为 `null`（面板未开）；把焦点先挪到顶栏（`.sc-shell__topbar`）再按 Ctrl+K → 面板正常打开。
- **处置**：探针内**先 click 顶栏再 Ctrl+K**（不改产品源码），并把失败重试记录（`paletteDiag.attempts`）留在 results.json 里。
- **未覆盖项**：产品有**双路** Ctrl+K —— renderer `window` keydown（`CommandPalette.tsx:188`）+ 主进程 `globalShortcut 'CommandOrControl+K'` → IPC 广播（`main/index.ts:448-460`）。CDP 合成输入**不经过 OS 热键层**，因此**主进程那一路本轮未覆盖**。→ 留 PM 真机人工按 Ctrl+K 复核（见 §5）。

### DEVIATION-4 · ②iii 的 token 集按「实际存在的字面量」改写
- **任务书**：②iii 列「T44 双链与 T44 反向链接相关字符串、T41 全宽命令文案（「全宽 / 固定宽度」）」——已全部钉住（5 + 1 + 1 条）并**额外补** T46 的 4 条渲染层字面量。
- **理由**：T44 没有命令面板命令（双链入口在编辑器 `[[` 自动补全菜单 + PageView 的反向链接面板），所以「侧栏/命令面板」的落点是 **i18n 字面量 + 活体面板**双证（§1 d 的 `{"title":"反向链接","empty":"暂无页面引用本页"}` 即活体命中）。

### DEVIATION-5 ·「等待超过」不在 renderer 侧，改钉 main 侧
- **任务书**：②ii 举例 main 侧应含「等待超过」/「模型未返回正文」。
- **实测**：`等待超过` 在 **main 侧命中 1 次**（`main/ai/client.ts` 的超时构造，见 §2 ii）；`模型未返回正文` 在 **main 侧 0 命中**——它是 renderer i18n（`zh-CN.ts:438-439`），已钉在 ②iii。
- **处置**：把任务书那两条分别归到实际所属侧：`等待超过`→②ii，`模型未返回正文`→②iii。并额外补 renderer 侧 T46 真字面量 `timeoutHint` / `timeoutHintBare` / `requestTimeoutSaved`（这三条才是 renderer 里真实硬编码的 T46 文案）。

### DEVIATION-6 ·「asar 内残留 .node」的正确判据
- **我最初的判据**：asar 头里不应出现 `*.node`。
- **实测/纠正**：`better_sqlite3.node` **在 asar 头里有条目**，但带 `unpacked: true` 且**无数据偏移**（`hasDataOffset=false`），字节落在 `app.asar.unpacked/` 下。这是 electron-builder `smartUnpack` 的正常形态，**不等于**「留在包内」。
- **处置**：判据改为「所有 `.node` 条目必须 `unpacked=true` 且不在 asar 数据区 + `app.asar.unpacked/` 下物理存在」。三条均 PASS。（「ABI 是否匹配」不靠静态猜，靠 §1 b 的运行时 `sync.status()` 就绪。）

### DEVIATION-7 · 窗口尺寸：不改尺寸，只钉缩放
- **任务书**：「窗口尺寸固定便于截图」。
- **处置**：窗口尺寸由产品自身 `main/index.ts:153-155`（`width:1200, height:800`）固定，探针**未**额外改尺寸（Electron 不认 `--window-size`，加了会是死参数）；只加 `--force-device-scale-factor=1` 把缩放钉成 1，保证截图像素 = CSS 像素。实测客户区 `1184x735`，两张截图均 `1184x735`。

### DEVIATION-8 · 10s 采样窗口的锚点
- **口径**：任务书说「启动后 10s 内」。探针的窗口锚点是 **CDP 首次接通且已在页面上挂上 console/pageerror 监听之时**（本次 `cdpAttachMs=587`，首帧 `atMs=633` 已能读到完整 DOM），不是 `spawn` 时刻。
- **理由**：CDP 接通前**无法读 DOM**，物理上采不到样；5xx ms 的接通延迟已如实记录在 results.json，供 PM 复核窗口是否足够。

### DEVIATION-9 · 探针额外做的两项断言（超出任务书）
- 原生模块 unpacked 形态（§2 iv-1）——直击本单动机（历史 ABI 事故）。
- 隔离反证三连：`layoutRoot==="data"` / 夹具目录真实落盘 / 真实 `.septcats` mtime 不变（§0）。

### 未做（明确声明）
- **未跑 vitest / typecheck / 门禁脚本**：本单只读打包产物；单测与「包内是否有这份代码」无关（包内验的是 `app.asar` 的字节，不是源码）。按任务书「若要跑 vitest 请先说明原因」——本轮**无原因**，故未跑。
- **未跑 ensure-abi**（任务书明令）。
- **未重打包**、**未改产品源码**、**未碰 git**。

---

## §5 PM 复跑节（留空，PM 补）

- [ ] 在新机器（无 dev 环境）上装 `Septcats Setup 0.3.0-rc.26.exe` 后**直接双击启动**，确认不出现「同步运行时不可用（数据库服务启动失败）」。
- [ ] 真机人工按 **Ctrl+K**（OS 热键路径，本轮未覆盖，见 DEVIATION-3）确认命令面板打开。
- [ ] 确认真机数据根 `C:\Users\Administrator\.septcats` 行为符合预期（本探针未触碰）。
- [ ] 预发布通道 `rc.yml` 是否需要在 feed 上铺（DEVIATION-2）。

---

## §6 一句话结论

**rc.26 打包产物「装完起不来」的风险本轮被实机证伪**：包内代码（CSP/T46/T44/T41 字面量）全部在包、原生模块走 `app.asar.unpacked/`、`Septcats.exe` 启动后 DB 与同步运行时均就绪、失败文案 0 命中、双错误计数 0、优雅退出。**54/54 PASS。**


## §PM 复跑（对**正式 0.3.0 发布包**，2026-09-21 00:4x）—— **55 PASS / 0 FAIL**

PM 用同一条探针对**发布包本体**（`_scratch/release-0.3.0/apps/desktop/dist/win-unpacked/Septcats.exe`，204,521,984 B）复跑：

| 判据 | 实测 |
|---|---|
| 失败文案 | 「数据库服务启动失败」**不出现** ✓、「同步运行时不可用」**不出现** ✓ |
| 服务就绪 | `sync.status()` → `{"state":"ok","enabled":true,"devices":1,"pendingOps":0,"pendingSegs":0,"conflicts":0,"errors":[]}` |
| 包内 CSP（T45） | `connect-src 'self' asset: attachment: ws://localhost:* http://localhost:* ws://127.0.0.1:* http://127.0.0.1:*` ✓ |
| 包自报 | `{"name":"@septcats/desktop","version":"0.3.0","layoutRoot":"data"}` |
| 干净度 | pageerror 0 / console error 0；`window.close()` 优雅退出 ✓ |

> 结论：**0.3.0 发布包启动健康（历史 rc.4「装完起不来」类故障未复现）**；与 T48-01 对 rc.26 的结论一致（同源）。

### 登记（来自 T48-01 的 3 条需 PM 留意项）

1. **启动即做 updater 检查**：预发布通道 `rc.yml` 404（仅主进程 stderr，UI 无影响）→ 正式通道 `latest.yml` 已就位（本发布已核对 version=0.3.0 + sha512 一致）。
2. **`globalShortcut Ctrl+K` 无法用 CDP 合成输入覆盖** → 需人工按一次验证（留老板冒烟步骤内）。
3. 「加载中」瞬态 633ms（`SyncStatus` 的 `status===null` 设计占位；红线禁改产品源码）→ 登记不阻断。

## §PM 追加 · **0.3.0-rc.27 打包产物复跑**（T50 字体入包后，2026-09-21）

同探针 `probe-rc26-smoke.mjs` 打 rc.27 的 win-unpacked：**54 PASS / 0 FAIL**；`appMeta()` 自报 `version=0.3.0-rc.27, schemaVersion:3`；CSP 原文含 `127.0.0.1`；`sync.status()` ok/errors 0；gracefulExit ✓。
**捆绑字体入包硬核对**（asar 头递归解析）：`/out/renderer/assets/NotoSansSC-wght-Dz1u1FRy.ttf` **size=17,772,300**（与源文件逐字节等）在 asar 内；renderer CSS 产物引用该 asset 名 ✓。
> 差 1 条 PASS 说明：本轮日志按断言组计数与上轮打印时机差一条 INFO 级，判据组全覆盖（static 25 + smoke 29 全绿）、无 FAIL——字体加载链路新变量下启动健康确认。

