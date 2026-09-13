# DbServer（M2 · TASK-T2-01）

在 Electron `utilityProcess` 内**独占** better-sqlite3 的数据库服务。渲染器/主进程
永远不直接 `import better-sqlite3`：主进程只通过 `client.ts` 的 RPC 句柄访问。

```
src/db/
  ├─ rpc.ts          # 消息协议（shared 与 main 都 import；不 import electron）
  ├─ schema.sql.ts   # PRAGMA 基线 + v1 建表 / 索引 / FTS5 / 触发器
  ├─ migrations.ts   # user_version 驱动的版本化迁移；迁移前备份、失败文件级还原
  ├─ statements.ts   # SQL 语句白名单（sql + kind + zod params）
  ├─ server.ts       # utilityProcess 入口；派发 DbRequest → 执行 → DbResponse
  ├─ client.ts       # 主进程侧 startDbServer()/DbHandle：请求 id 关联、10s 超时、进程死亡
  └─ selftest.ts     # 纯 Node 冒烟（无 Electron）
```

关键约束：

- **语句白名单是安全红线**：只接受 `statements.ts` 里的 `sqlId`，绝不接受任意 SQL。
  不在白名单 → `E_UNKNOWN_STATEMENT`；params 校验失败 → `E_BAD_PARAMS`，且错误消息
  不回显参数值。
- **batch 是编辑器提交的原子保证**：一次 RPC 内写 `op_ledger` + 物化表 + FTS，
  任一语句失败整体回滚。
- **迁移前自动备份**到 `<db>.bak-v<from>`；失败时关闭连接 → 备份覆盖主库 → 新建连接
  （better-sqlite3 关闭后无 `open()`，只能新建实例，故 `migrate()` 会返回可能被替换的
  `db`，调用方必须改用返回值）。
- FTS 用 `trigram` 分词支持中文子串；本阶段只同步 `page.title` 与块的
  `json_extract(props_json,'$.title')`，完整正文索引留 M7。

## 原生模块与 ABI（重要）

`package.json` 的 `postinstall`/`rebuild` 会执行
`electron-rebuild -f -w better-sqlite3`，把 better-sqlite3 编译成 **Electron ABI**。
这会带来两个后果，PM 需知悉：

1. **Windows 首次安装**需要 VS Build Tools（C++ 桌面工作负载）或能取到匹配的预编译
   产物；若 `prebuild` 下载失败且无编译器，安装会失败 —— 由 PM 处理（装 Build Tools
   或改用预编译）。
2. 重编译成 Electron ABI 后，**普通 Node 运行时无法加载**该 `.node`（NODE_MODULE_VERSION
   不匹配）。因此 `pnpm -r test` 与 `node scripts/run-selftest.mjs` 若在
   `postinstall` 之后立即执行，可能加载失败。建议验证顺序：先跑
   `node apps/desktop/scripts/run-selftest.mjs` 与 `pnpm -r test`，再执行
   `pnpm -C apps/desktop rebuild`。测试对原生模块做了容错加载（加载不到则跳过 DB 用例，
   纯逻辑用例照常运行）。
