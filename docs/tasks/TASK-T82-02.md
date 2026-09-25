# TASK-T82-02 · P1/P2 修复攒批（H-05 导入账本 / H-01 孤儿密钥 / H-07 卡片摘要）

> 来源：docs/Bug-hunt-R29.md 发现台账（09-25 全盘排查）
> 前置：T80-02（便携包导入）收口后派发——H-05 的修法与导入的冲突预检共用查表面，顺序不能反。
> 只 Write/Edit 落盘，不碰 git、不跑全仓（PM 复跑门禁）。报告骨架 `TASK-T82-02-report.md` 前置，§0 先答侦察问。

## 三项（互相独立，逐项收口）

### A · H-05（P1）：import_source 永久账 → 删页后同文件夹永远无法重导
- **现状**：`main/importer.ts:521-533` 把 `import_source` 全量预载成 `(path,hash)→page_id` Map，命中即整条剔除；**不校验 page 是否还活着**，删除侧（remove/purge/GC）也从不清理该表。老板真实库 424/424 行指向不存在页 → 重导入被全量静默跳过。
- **修法**：查表命中后加**页存活校验**（`page_id` 在 `page` 表且 `deleted_at is null` 才算重复；死引用视作未导入）。SQL 一条 LEFT JOIN 解决，禁内存二次过滤大表。
- **不做**：不清历史行（物理清账归 T81 GC 范围）；本项只修「判重语义」。
- **测试**：导→删（remove+purge 两态各测）→重导=成功入账非 skipped；活页重复导=仍 skipped（幂等不破）；回收站页（deleted_at≠null）重导=允许恢复语义还是新副本，**按现状 plan.ts 语义给出结论并钉死**（§0 侦察问）。

### B · H-01（P2）：AI 供应商删除时 clearKey 吞错留孤儿密钥
- **现状**：`settings/AiSection.tsx:463` `await ...ai.clearKey({providerId}).catch(() => {})`——失败静默，UI 已移除该项但 CredentialStore 密文仍在盘上（隐私红线不可接受）。
- **修法**：失败不再吞：danger toast「密钥未能从凭据库删除，请重试」+ 该项保留在列表（标 error 态可重删）；成功路径行为不变。i18n 双语键齐平、禁词纪律照旧。
- **测试**：mock clearKey reject → 断言 toast 出现 + 项未移除；resolve → 项移除无 toast。

### C · H-07（P2）：最近页卡片/市场种子抽不到 table/toggle 正文
- **现状**：`workbench/cards.tsx:firstTextOfBlock` 与 `workbench/market.ts:extractPlainText` 只认 PM doc 形（text/content 嵌套），T79-02 后 `blocks:list` 对 table/toggle 回结构化 `{rows,header}`/`{title,body}` → 摘要空白。
- **修法**：两函数加结构化分支（table=首格文本、toggle=title）。**硬约束：不许写第三份 content 解析实现**——优先消费 `main/blocks.ts:blockContentOf` 已有的归一出口（renderer 侧如不可达，则把「结构化→纯文本」的纯函数提 `@septcats/editor` 或 shared，main/renderer 两侧引用同一实现），§0 侦察问必须先答「renderer 侧现在能不能拿到单一实现、以什么包边界拿」。
- **测试**：table/toggle/doc 三形各钉；与 `blockContentOf` 同读一行断言文本一致（防实现再次分叉——T79 缺陷 A 教训）。

## 门禁/验收
- 三项各自单测 + `pnpm --filter @septcats/desktop test` 全绿（基线只增不减）+ typecheck 0 + no-magic ✓；
- A 项 PM 真机复验：scratch 夹具走「导→删→重导」全链探针（双钉纪律）；
- B/C 项真机目检由 PM DOM 探针代跑（禁词/文案/摘要文本断言）。