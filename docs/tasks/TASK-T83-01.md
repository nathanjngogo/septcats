# TASK-T83-01 · `ensure-abi.mjs` 加固：ABI 切换不再可能删掉原生模块

> 前置：本单**不阻塞 0.6.0 发布**（发布基点已冻结），0.6.0 出包后再派。
> 基线=main tip。工作目录=主树。只 Write/Edit 落盘；**禁碰 git**。
> 报告 `docs/tasks/TASK-T83-01-report.md`（**开工两步内先建骨架**）；收尾打印 `CB-T83-01-EXIT=0`。
> 原生自测硬要求（本仓测试环境三钉）：`export PATH="/c/Users/Administrator/AppData/Local/hermes/node:$PATH"`（node 须 **v22.23.2**，v26 的内建 localStorage 会抢 jsdom 全局制造 309 条假红）
> + `export TMPDIR/TEMP/TMP="C:\Users\Administrator\AppData\Local\Temp"`（长路径；8.3 短路径会触发 libuv `fs-event.c:72` 断言崩）
> + 按目标切二进制（测试=node / 真机=electron）。

## 背景（PM 两次实踩，现场证据在 `_scratch/`）

`apps/desktop/scripts/ensure-abi.mjs` 负责在 node ABI 与 electron ABI 之间切换
`better-sqlite3.node`。两次实测事故：

1. **失败即毁灭**：`pnpm rebuild` 在无 VS 构建链的机器上失败时，会把
   `better-sqlite3/build/Release/` **整个删掉**（pnpm 先清理再编译），
   `better_sqlite3.node` 随之消失 → 之后所有测试与真机探针 `code=1` 假红，
   只能从 `dist/win-unpacked/resources/app.asar.unpacked/...` 手工回填。
2. **无缓存即重复下载**：切成 node ABI 时因 GitHub 不通（本机网络）需从
   npmmirror 拉 prebuild（`better-sqlite3-v12.11.1-node-v127-win32-x64.tar.gz`，
   实测 dl:200 1039346B）；每次都从头来。

## 交付面

1. **先备份后重建**：任何会触发 `pnpm rebuild` 的路径，**先**把现有
   `build/Release/better_sqlite3.node` 复制到临时位（同盘、`.tmp-abi-<ts>.node`），
   重建失败时**原样回填**并给出明确错误（非零退出 + 文案说明「已回填，未丢失」）。
   **销毁前必先备份**是硬不变量，不接受「重建通常能成」的假设。
2. **本地二进制缓存**：把两种 ABI 的可用二进制各存一份到
   `apps/desktop/.abi-cache/{node,electron}.node`（**加进 `.gitignore`**）。
   切换时若缓存命中且能加载（`new Database(':memory:')` 探针）→ 直接复制，**不触发 rebuild**。
   否则走「下载 prebuild（npmmirror 优先，URL 常量集中一处）→ 失败再 rebuild」的顺序；
   成功后就地存入缓存。
3. **加载自检**：切换结束必须实际 `require` 一次并建内存库（现脚本已有类似探针——
   不足处：失败时没有回填）。自检失败=非零退出 + 打印当前二进制来源（缓存/下载/rebuild）。
4. **幂等**：目标 ABI 已就位且可加载时，**零副作用**（不复制、不下载、不 rebuild），
   只打印一行状态。
5. **测试**：脚本目前**无测试**。新增 `apps/desktop/test/ensure-abi.test.ts`
   （或 `scripts/__tests__/`，与本仓既有测试落点一致为优先）覆盖：
   ①失败回填（把 rebuild 注入成抛错，断言二进制字节回填且退出码非零）
   ②缓存命中零 rebuild（断言未调用重建）
   ③幂等零副作用
   ④缓存文件缺失时的降级路径
   纯函数化优先（把「决策」抽成可测函数，IO 走注入），避免测试里真的跑 electron ABI 切换。

## 不许做

- 不改 `apps/desktop/package.json` 的测试/构建脚本语义（`predev`/`pretest` 仍会调本脚本）。
- 不引入新依赖（下载用 node 内置 `fetch`/`https` + `zlib`/`tar` 现有能力；
  若必须在 Windows 解 tar，先看 `scripts/` 里既有做法再决定）。
- 不碰 `node_modules/.pnpm/better-sqlite3@*/...` 之外的任何依赖目录。

## 验收（PM 复跑）

1. `pnpm -C apps/desktop test`（node ABI）全绿，且 **`.abi-cache/node.node` 生成**。
2. 人为破坏：把缓存改名 + 让 rebuild 失败（注入或临时改 PATH）→ 脚本失败但**二进制仍在**（字节一致，sha256 断言）。
3. 连续两次跑同一目标 → 第二次输出「已就位」且不重下、不 rebuild（mtime 不变）。
4. `git status` 无 `.abi-cache/` 进入跟踪（`.gitignore` 生效）。