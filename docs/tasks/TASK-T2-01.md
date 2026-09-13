# TASK-T2-01 · DbServer 数据核心（M2）

> PM：Hermes ｜ 工程师：CodeBuddy ｜ 仓库：E:\Hermes Agent工作空间\Septcats
> 前置：M0+M2a 已合入（packages/core 提供 Op/segment/replay 纯逻辑）。SSOT：docs/PROJECT_PLAN.md §M2。
> 纪律同前：只 Write/Edit 文件，不跑终端命令、不碰 git；PM 统一验证。

## 0. 目标
Electron `utilityProcess` 内独占 better-sqlite3 的数据库服务：迁移框架 + 语句白名单 RPC + WAL + 备份 + 完整性检测与从分段重建。**渲染器/主进程永不直接 import better-sqlite3。**

## 1. 位置与文件
```
apps/desktop/src/db/
  ├─ server.ts        # utilityProcess 入口：init(process.parentPort)，接收/执行/应答
  ├─ client.ts        # 主进程侧：startDbServer(): Promise<DbHandle>；RPC 封装（请求 id 关联、超时 10s、进程死亡检测→onExit 回调）
  ├─ rpc.ts           # 消息协议类型（shared 与 main 都 import；不 import electron）
  ├─ migrations.ts    # 版本化迁移表：{ id, up(db) }；user_version 驱动；迁移前自动备份
  ├─ statements.ts    # 白名单：{ sqlId: { sql, kind:'run'|'get'|'all', params: zod schema } }
  ├─ schema.sql.ts    # v1 建表 SQL（见 §2）
  └─ selftest.ts      # 纯 Node 冒烟：better-sqlite3 直连临时库跑全迁移（CI 用，不依赖 Electron）
  test/  (vitest, node env): migrations.test.ts statements.test.ts server.test.ts（起 server.ts 需 Electron？不要——测试只测纯函数层 + better-sqlite3 直连；Electron 集成由 PM 真机做）
```
apps/desktop/package.json：deps + `better-sqlite3@^12`，devDeps + `@types/better-sqlite3`、`@electron/rebuild`；scripts 增加 `"rebuild": "electron-rebuild -f -w better-sqlite3"` 与 `"postinstall": "electron-rebuild -f -w better-sqlite3"`（注释写明 Windows 首次安装需 VS Build Tools 或用预编译，若 prebuild 失败 PM 处理）。

## 2. v1 Schema（表列照抄计划书 §6.2，全部 STRICT + meta_role 除外不加）
- `workspace(id TEXT PK, name TEXT, root_page_id TEXT, settings_json TEXT, created_at INTEGER)`
- `page(id TEXT PK, workspace_id TEXT NOT NULL, title TEXT NOT NULL DEFAULT '', icon TEXT, cover TEXT, parent_id TEXT, sort_key TEXT NOT NULL, alive INTEGER NOT NULL DEFAULT 1, version INTEGER NOT NULL, updated_at INTEGER)` + `idx_page_parent(workspace_id,parent_id) WHERE alive=1`
- `block(id TEXT PK, page_id TEXT NOT NULL, workspace_id TEXT NOT NULL, type TEXT NOT NULL, props_json TEXT NOT NULL DEFAULT '{}', content_json TEXT, sort_key TEXT NOT NULL, alive INTEGER NOT NULL DEFAULT 1, version INTEGER NOT NULL, lamport_c INTEGER NOT NULL, lamport_d TEXT NOT NULL, updated_at INTEGER)` + `idx_block_page(page_id) WHERE alive=1`、`idx_block_lru(updated_at)`
- `collection(id TEXT PK, page_id TEXT, workspace_id TEXT NOT NULL, name TEXT, schema_json TEXT NOT NULL DEFAULT '{}', views_json TEXT NOT NULL DEFAULT '[]', alive, version, lamport_c, lamport_d, updated_at)`
- `record(id TEXT PK, collection_id TEXT NOT NULL, workspace_id TEXT NOT NULL, values_json TEXT NOT NULL DEFAULT '{}', sort_key TEXT NOT NULL, alive, version, lamport_c, lamport_d, updated_at)` + `idx_record_coll(collection_id) WHERE alive=1`
- `op_ledger(seq INTEGER PRIMARY KEY AUTOINCREMENT, op_id TEXT NOT NULL UNIQUE, seg_id TEXT, lamport_c INTEGER NOT NULL, lamport_d TEXT NOT NULL, target_table TEXT NOT NULL, target_id TEXT NOT NULL, op_json TEXT NOT NULL, applied_at INTEGER NOT NULL)` + `idx_ledger_lamport(lamport_c,lamport_d)`
- `sync_state(device_id TEXT PK, last_lamport_c INTEGER NOT NULL DEFAULT 0, last_sync_ok INTEGER, pending_count INTEGER DEFAULT 0, conflict_count INTEGER DEFAULT 0, updated_at INTEGER)`
- `meta(key TEXT PK, value TEXT NOT NULL)`（存 schema_version、installed_at、device_id）
- `page_block_fts`：FTS5 **虚拟表** `(title, body, page_id UNINDEXED, workspace_id UNINDEXED, tokenize='trigram')`，由 block/page 写入触发器（AFTER INSERT/UPDATE/DELETE on live rows）维护；body 取 content_json 中 `text` 字段聚合的简易实现：触发器只同步 `page.title` 与 `block.props_json->>'$.title'`（json_extract），**完整正文索引留给 M7**，本任务只要管道正确。
- PRAGMA：journal_mode=WAL、synchronous=NORMAL、foreign_keys=ON、busy_timeout=5000。user_version 迁移驱动。

## 3. RPC 协议（rpc.ts）
```ts
type DbRequest =
 | { id:string; t:'migrate' }                                    // → {ok, from, to}
 | { id:string; t:'run'; sqlId:string; params:unknown }          // → {ok, changes, lastInsertRowid?}
 | { id:string; t:'get'|'all'; sqlId:string; params:unknown }    // → {ok, row/rows}
 | { id:string; t:'batch'; stmts:{sqlId:string;params:unknown}[] } // 单事务；任一失败全滚 → {ok, results} 或 {ok:false,error}
 | { id:string; t:'ftsSearch'; workspaceId:string; query:string; limit:number } // → {ok, rows:[{page_id,title,score,snippet}]}（bm25 + snippet()）
 | { id:string; t:'exportSnapshot' }                             // → {ok, json:string}（opsToSnapshot 投影自 op_ledger 全量重放）
 | { id:string; t:'rebuildFromSegments'; segmentsJson:string }   // 入参=Segment[] 序列化；清 view 表→replay（core）→写 op_ledger+物化表，单事务
 | { id:string; t:'integrityCheck' }                             // → {ok, ok:boolean, messages:string[]}
 | { id:string; t:'backupTo'; destPath:string }                  // better-sqlite3 backup API
type DbResponse = { id:string; ok:boolean; data?:unknown; error?:{code:string;message:string} }
```
- `sqlId` 不在白名单 → error.code='E_UNKNOWN_STATEMENT'（**这是安全红线，必须有测试**）。
- params 用各语句 zod schema 校验，失败 'E_BAD_PARAMS'；错误消息不得含参数值（防泄露）。
- batch 是编辑器提交路径的原子保证：同一事务内写 op_ledger + 物化表 + FTS。

## 4. 迁移框架
- `MIGRATIONS: Migration[]`，up 幂等检查；`migrate()` 顺序应用 user_version 之后的全部；开始前 `PRAGMA wal_checkpoint(TRUNCATE)` + backup 到 `<db>.bak-v<from>`；失败回滚（文件级还原）。
- `schema.sql.ts` 即 migration #1；之后加列走 #2 起步，**禁止改 #1**。

## 5. selftest.ts（纯 Node 可跑，无 Electron）
临时目录建库→migrate→batch 插 workspace/page/block/record→get 回读→ftsSearch 命中中文子串（trigram）→integrityCheck ok→backup 到文件→删主库文件→rebuildFromSegments（用 core.segment 造 2 段合法段）→回读一致。`process.exit(0|1)` + 逐行 PASS/FAIL 输出。PM 用 `node --import tsx` 或先编译跑。

## 6. client.ts 行为
- `startDbServer(opts:{dbPath,segmentsDir?})`：spawn utilityProcess（entry 路径由 build 决定：`app.getAppPath()` 下 out/main/dbServer.js —— electron.vite.config 增加第二个 main 入口 `dbServer`，你负责改配置）。
- 请求 id=`crypto.randomUUID`，Map 挂起表，超时 reject('E_TIMEOUT')；进程 exit → 全部挂起 reject('E_DBPROCESS_EXIT')，DbHandle.emit('dead')。
- API：`handle.migrate()/.run()/.get()/.all()/.batch()/.ftsSearch()/.rebuildFromSegments()/.integrityCheck()/.backupTo()/.dispose()`，签名与 DbRequest 一一对应（params 泛型从白名单类型推导最好，不强求）。

## 7. DoD（PM 执行）
```
pnpm install && pnpm -C apps/desktop rebuild   # better-sqlite3 编译过（失败则 PM 处理，报告说明即可）
pnpm -r typecheck
pnpm -r test                                    # 新增 db 纯层测试全绿
node apps/desktop/scripts/run-selftest.mjs     # 你写这个启动脚本（tsx 或 dist），PASS 全部
pnpm -C apps/desktop build                      # 双 main 入口产物存在
```
报告格式同前（DONE/TESTS/COMMANDS/DECISIONS/DEVIATIONS/BLOCKERS）。
