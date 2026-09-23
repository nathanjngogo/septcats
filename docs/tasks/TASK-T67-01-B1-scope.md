# TASK-T67-01-B1 切片 · 页面密码锁「数据+加密核心」（子 Agent 并行版）

> 本切片=T67 的**纯后端核心**。总口径/表结构/算法参数/限制声明全在 `docs/tasks/TASK-T67-01.md`（先通读），本文件只划**范围与冲突红线**。

## 你做什么（B1 范围）
1. **v10 迁移**：新文件 `apps/desktop/src/db/schema.v10.ts`（page_lock 表，逐字照 TASK §1.1 SQL，STRICT+IF NOT EXISTS，范式照 schema.v9.ts）+ `migrations.ts` 列表尾部**追加** #10（禁改 #1..#9 描述）。
2. **main 核心服务** `apps/desktop/src/main/pageLock.ts`：scrypt 参数钉值（N=2^17,r=8,p=1,dklen=32）派生 DEK、AES-256-GCM 信封（复用/仿 sync/crypto.ts 格式，版本前缀 `SCENC1`）、verifier 校验、恢复码生成（base32 20 位）/scrypt hash 校验、DEK 会话内存缓存（Map，进程退出即灭）、失败限速计数（5 次起 60s 指数退避，内存）。密码明文**绝不进任何日志**；diag/日志脱敏清单追加 `lock:*`。
3. **IPC 通道定名+注册**：shared/ipc 通道常量 `lock:status/set/unlock/remove/verifyRecovery/setHint/changePassword`；main 侧 `apps/desktop/src/main/lockIpc.ts`（新文件，index.ts 挂载**最多两行 import+register**）；preload 桥（既有范式）。
4. **加密钩子函数**（不接线）：`encryptPageBlocks/decryptPageBlocks/rewriteWithNewKey`（按 §1.3 临时表原子替换逻辑）——供 B2/接线者调。
5. **单测**：TASK §2.3 的 a/b/c/d/g 五组纯后端项（旧库升级、参数钉值、DB 文件明文 grep=0、字节级还原、限速、强度边界）。
6. **不跑探针**（真机段留 PM）；探针脚本 B1 不写。
7. 报告 `docs/tasks/TASK-T67-01-report.md`：**你只填「B1 节」**（改动文件、原始数值、选择理由），其余节不动。

## 你不做什么（红线——并行环境保命条款）
- **零 i18n**（T66 正在改 zh-CN.ts/en-US.ts）；**零 commands.ts**（同上）；**零 pixelIcons.tsx / ThemeGallery / workbench/**（T65/T66 面）。
- **不碰 SidebarTree.tsx / App.css / PageView.tsx / TrashList.tsx / renderer 任何 UI**（主树 T64 正在改这些）。
- **App.tsx / main/index.ts / preload 各最多两行接线 diff**，能放新文件的逻辑一律放新文件。
- **UI 全不做**（锁卡/徽标/菜单/弹框/快捷键/B2 的事）；FTS 钩子、blocks:commit 接线、导出确认框、同步宽容性测试=**B2 范围，你不做**。
- 不 merge、不 push、不启动 Electron、不改主工作树。
- 每写完一个测试立即 `pnpm -C apps/desktop test`（node ABI：`node apps/desktop/scripts/ensure-abi.mjs node`）；交付前 typecheck 0。

## 交付
commit 前缀 `feat(t67-b1):`；总结=commit/files/tests/报告 B1 节要点。
