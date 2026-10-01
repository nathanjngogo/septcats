创意 IDEA-B：写作洞察条（页尾「N 字 · 约读 M 分钟」，打字实时更新）

- packages/editor/stats.ts（新纯函数）：CJK 逐字 + 拉丁词 = words；分钟 = ceil(words/300) 且 ≥1；
  空文本 = null（没有内容就不显示「0 字 · 读 1 分钟」的蠢话）；块边界换行天然切断拉丁词
- PageView 挂 editor.on('update') 现读 PM 文档（editor.state 现读，无陈旧文档口径与既有一致）；
  aria-live=polite 播报；跟随 measure 宽度右缘弱化（数字是辅助信息，不抢正文）
- 测试：stats.test 8 例（中/英/混/分钟进位/空值/emoji 码点/peek/块边界）→ editor 283/283；
  真机 cdp-e2e-idea-a 扩 IDEA-B 断言 → 10 PASS / 0 FAIL（打字 27 字 → 条上「27 字 · 约读 1 分钟」精确对上）
- 门禁：desktop 1472/1472 · ui 192 · editor 283 · tsc 0 · no-magic 0；已重打包
- 修两处测试预期错（a😀b 的 emoji 是分隔符 ⇒ 2 词；peek 数错 1 字）——实现全程没改错
