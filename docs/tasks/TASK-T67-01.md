# TASK-T67-01 · P1：页面密码锁（老板 09-22：账号密码类页面要能上锁）

> 老板原话：「新建页面之后，如果是密码类的内容，即保存的都是账号密码，我需要这个页面能有个密码锁。」
> PM 定稿默认值（老板未细说处按此执行）：**真加密**（rest 密文，不是 UI 遮挡）；主密码解锁；忘了不可恢复、但给一次性恢复码兜底；锁定态=重启/关应用必锁，会话内解锁可保持。

## 0. 现状底座（PM 已侦察，勿重复调查）

- 加密件现成：`apps/desktop/src/main/sync/crypto.ts` 已用 node:crypto AES-256-GCM（`createCipheriv('aes-256-gcm', dek, iv, {authTagLength})`，:109/:163），沿用其 envelope 格式（版本前缀+IV+tag）。`scryptSync` 由主密码派生页面 DEK。
- 迁移：`apps/desktop/src/db/migrations.ts` MIGRATIONS 列表，**v9 已被 wiki 链接表占用，本单用 v10（纯新增建表）**；schema.v9.ts 的 STRICT 表+IF NOT EXISTS 范式照抄。
- 块存储：`statements.ts:239 block INSERT`（content_json）；FTS：`fts.syncBlock` 每页重插（statements.ts:660 区），页级跳过=在 FTS 同步前查 page_lock。
- 页面 ⋯/右键菜单：`SidebarTree.tsx` pageRowMenu（T64 刚改造过——**本单必须等 T64 合入后开工**）。
- 顶栏/页签：`tabs.ts` state + TabsBar（锁定徽标加此处）；i18n 双份；像素图标族无 Lock → pixelIcons.tsx 新增 `LockGlyph`（16 网格挂锁，风格对齐 28 枚，走既有 makeGlyph）。
- CredentialStore（AI 密钥那个，main 侧）**不复用**：页面锁的 verifier 存 v10 新表，不进 AI 配置面。
- 同步：op 段本身已有信封加密；本单保证锁页 op payload 密文化（见 §1.3），同步侧不新增依赖。

## 1. 口径（PM 定稿）

### 1.1 数据（v10 迁移，纯新增）
```sql
CREATE TABLE IF NOT EXISTS page_lock (
  page_id       TEXT PRIMARY KEY,
  salt          BLOB NOT NULL,
  kdf           TEXT NOT NULL,            -- 'scrypt|N=2^17|r=8|p=1|dklen=32'
  verifier      BLOB NOT NULL,            -- 校验密文：用 DEK 加密的定长标记
  hint          TEXT,                     -- 用户可选提示（明文，UI 明示"勿写密码本身"）
  recovery_hash BLOB NOT NULL,            -- 恢复码 scrypt 校验（主密码忘了用恢复码解锁改密）
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
) STRICT;
```
- 无外键级联（页面删除/回收站流由应用层处理，与既有表口径一致）。
- 派生：scrypt(主密码, salt, N=2^17,r=8,p=1, keylen=32) → 页面 DEK（仅存 main 进程内存）。verifier = AES-GCM(DEK, 常量标记)；解锁=scrypt 后解 verifier 成功。恢复码=20 位随机 base32（一次性生成给用户在弹框复制/记下），recovery_hash=scrypt(恢复码归一化, salt2)；用恢复码解锁后**强制弹改密框**。

### 1.2 加密范围（首版定界，报告写「已声明限制」）
- **加密=正文**：该页全部 `block.content_json` 落库/重放前用 DEK 信封加密（密文形态 `SCENC1|b64`）；读路径在 main 侧、DEK 在场时解密后走既有 IPC（renderer 零感知）。
- **明文保留（限制声明）**：页面标题、树结构、字数统计元数据。理由：树/搜索入口需要可导航性；老板用例里标题通常是站点名非密码本身。任务书不做标题加密，PROJECT_PLAN §决议补一条。
- FTS：锁页**不进索引**（搜索不命中；解锁会话内打开过也不回灌，重锁后清）。
- 回收站/彻底删除：删页连带删 page_lock 行；从回收站恢复→锁仍在（密文完好）。
- 导出/复制：锁页未解锁时导出选项置灰或跳过+toast；已解锁允许导出但弹一次「导出含敏感内容」像素确认框。

### 1.3 写路径
- `blocks:commit`（含 op 落段）在 main 侧 dbview 之前：若目标页有 lock 且 DEK 在场 → 内容以 DEK 信封加密后落 block 表与 op payload；若 DEK 不在场（理论上不可达，UI 挡）→ 拒绝写入报 `LOCKED`。
- 加锁动作：设密码 → 后台用新 DEK **重写该页全部块**（先密文写临时表再原子替换，失败回滚保持明文）；解锁改密=重信封（旧 DEK 解、新 DEK 封）。
- 迁移兼容：旧库无表=v10 建表即空，一切页自然未锁。

### 1.4 UI（像素风、灰阶、黑框线，全部 i18n 双份）
1. **设置锁**：页 ⋯/右键菜单加「密码锁」组：`锁定此页`（无锁时）/`修改密码`/`移除密码锁`/`设置提示`。锁定弹框：密码+确认+（可选提示）→ 强度条（长度≥8，提示性非阻断）→ 下一步展示**恢复码**（monospace 大字+复制钮+"离开前请保存，忘记主密码的唯一退路"）→ 完成=重写块。
2. **锁态开页**：打开锁页=编辑区替换为居中**锁卡**（像素黑框、挂锁 glyph、密码输入+提示展示位、错误 shake+剩余尝试计数）。解锁成功→正常编辑器；tab 保持打开；**应用重启/进程退出→回到锁卡**（会话内可重复解锁一次即可：DEK 缓存在 main，锁页不重复要密码直到应用退出）。
3. **徽标**：树行标题右端 + 页签标题左端各一枚 12px 锁 glyph（锁定态）。
4. **顶栏/命令面板**：命令 `lock page` / `解锁此页`（有焦点页才显）；`Ctrl+Shift+L`=快速锁定当前页（进 keybind 注册处，无统一面则 App keydown 挂）。
5. 恢复码路径：锁卡「忘记密码？」→ 输恢复码 → 验过 → 强制改密弹框 → 全链恢复。
6. 失败限速：连续 5 次错误 → 指数退避提示（60s 起），只记 main 内存。

## 2. 交付物
1. v10 迁移 + main lock 服务（新文件 `apps/desktop/src/main/pageLock.ts`）+ IPC 通道组（lock:status/lock:set/lock:unlock/lock:remove/lock:verify-recovery/lock:set-hint，注册进 shared/ipc 白名单范式）+ blocks:commit/读路径加密钩子 + FTS 跳过 + 导出钩子。
2. renderer：锁卡组件（workbench 目录无关；放 `apps/desktop/src/renderer/src/lock/`）、菜单项、徽标、命令、弹框（复用 Modal/Dialog 像素范式）、i18n 双份、pixelIcons 加 LockGlyph。
3. 单测：a) v10 迁移幂等/旧库升级；b) scrypt 参数钉值（跨版本可解）；c) 锁上→块全密文（DB 文件 grep 明文=0 断言）→解锁→内容字节级还原；d) 错误密码/恢复码/限速计数；e) FTS 不命中锁页；f) 删页/回收站恢复连带锁；g) 强度与 hint 边界（hint 不存明文密码字样只做长度/字符校验）；h) 迁移版本钉（SCHEMA_VERSION→10）全仓扫钉随动（PM 收口时核）。钉旧口径用例按新语义改写列 DEVIATION。
4. 真机探针 `docs/mockups/cdp-e2e-t67-01.mjs`（断言前一次性形状脚本拿真值；resize 走 main inspector setBounds+回读；**探针用一次性脚本验证磁盘密文**：解锁前后各拷一次 .sqlite 头 64KB 内 grep 原明文关键词=0/内容正确还原；重启还原锁态走优雅退出两段）截图 ≥8 张 screens-t67/。
5. 报告 `docs/tasks/TASK-T67-01-report.md`：骨架前置；原始数值；「标题明文/导出确认」两处限制声明进报告与 PROJECT_PLAN §14 决议；PM 复跑节留空。

## 3. 红线
- **等 T64 合入 main 后开工**（同文件面）；T65/T66 在各自 worktree 不冲突，App.tsx/commands 接线处取最小 diff。
- 密码永不出 main 进程之外：renderer 只传 typed 字符串给 IPC（结构化克隆、不落日志——`lock:*` 通道参数在 diag/日志路径必须脱敏，main 现有 redact 清单追加）；DEK 不落盘不写 env。
- 隐私红线不破：零外呼；恢复码只在设置弹框出现一次，不进备份目录明文（page_lock 表里只有 hash）。
- 语义色/黑框线 token/思源黑体不破；packages/** 仅 pixelIcons 追加 glyph。
- 同步兼容：锁页 op payload 密文化后，**旧客户端**读该页会得乱码（不崩则免测声明，崩则需锁页不同步开关——先测 `sync` 包对未知二进制 payload 的宽容性，报告写明证据）。

## 4. DoD（CB 自验，贴数值进报告）
`pnpm -C apps/desktop test` 全绿（每写一个测试文件即跑；先 ensure-abi node）→ `pnpm -r test` 无红 → typecheck 0 → build+selftest 过；探针不跑（留 PM）。**git 不碰**（PM 提交）。

## 5. 排队
位置：T64（主树，CB 施工中）合入后立即派发；T65/T66（worktree 并行）完成后 PM 先合两单、rebase T67 基线，再派 CB（主树独占）。
