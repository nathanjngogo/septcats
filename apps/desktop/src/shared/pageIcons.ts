/**
 * pageIcons.ts —— 页面图标画廊数据（N1-②）。
 *
 * 为什么这张表住在 `src/shared` 而不是 renderer 组件里：
 *   `apps/desktop/test/i18n.test.ts` 门禁⑤ 禁止 `src/renderer/src` 下的源码出现 CJK
 *   字符串字面量（用户可见文案必须走 i18n 字典）。而**搜索关键词是数据不是文案**，
 *   故照 editor 包 `types/blockLabels.ts` 的既有先例，把数据表放在扫描面之外，
 *   组件只做查询（组件内不出现 CJK 字面量）。
 *
 * 口径：
 *   · keywords 中英混排 —— 用户用中文或英文搜索都能命中（不做 locale 分支，成本最低）；
 *   · 精选集覆盖「文档/数据/日程/项目/商务/设计」六类常用语义，够用即可（非全量 emoji）。
 */
export interface PageIconOption {
  emoji: string;
  keywords: string;
}

export const PAGE_ICON_GALLERY: readonly PageIconOption[] = [
  { emoji: '📄', keywords: '文档 页面 doc page document' },
  { emoji: '📝', keywords: '笔记 草稿 note draft memo' },
  { emoji: '📌', keywords: '置顶 重要 pin important' },
  { emoji: '📎', keywords: '附件 attach clip' },
  { emoji: '📁', keywords: '文件夹 folder directory' },
  { emoji: '🗂️', keywords: '归档 分类 archive category' },
  { emoji: '📚', keywords: '知识库 书 book wiki library' },
  { emoji: '📖', keywords: '说明 手册 manual read guide' },
  { emoji: '📊', keywords: '数据 图表 chart data analytics' },
  { emoji: '📈', keywords: '增长 趋势 growth trend up' },
  { emoji: '📉', keywords: '下滑 下降 decline down' },
  { emoji: '🧮', keywords: '计算 表格 calc sheet spreadsheet' },
  { emoji: '🗓️', keywords: '日历 排期 calendar schedule' },
  { emoji: '⏰', keywords: '提醒 截止 时间 alarm clock deadline' },
  { emoji: '✅', keywords: '待办 完成 done check todo' },
  { emoji: '🎯', keywords: '目标 重点 target goal focus' },
  { emoji: '🚀', keywords: '发布 上线 launch rocket release' },
  { emoji: '🔥', keywords: '热门 紧急 hot fire urgent' },
  { emoji: '⭐', keywords: '收藏 星标 star favorite' },
  { emoji: '💡', keywords: '想法 灵感 idea insight' },
  { emoji: '🧭', keywords: '方向 规划 compass direction plan' },
  { emoji: '🧩', keywords: '模块 组件 puzzle module' },
  { emoji: '🛠️', keywords: '工具 维护 tools maintenance' },
  { emoji: '⚙️', keywords: '设置 配置 gear settings config' },
  { emoji: '🔍', keywords: '搜索 调研 search research' },
  { emoji: '🧠', keywords: '思考 策略 brain strategy' },
  { emoji: '🔒', keywords: '私密 锁定 lock private' },
  { emoji: '💰', keywords: '财务 利润 money profit finance' },
  { emoji: '🛒', keywords: '电商 采购 cart shop ecommerce' },
  { emoji: '📦', keywords: '产品 包裹 product box package' },
  { emoji: '🏷️', keywords: '标签 价格 tag price label' },
  { emoji: '🤝', keywords: '合作 客户 partner client deal' },
  { emoji: '📮', keywords: '邮件 沟通 mail communication' },
  { emoji: '🌍', keywords: '市场 全球 globe market global' },
  { emoji: '🏁', keywords: '里程碑 结束 flag milestone' },
  { emoji: '📅', keywords: '计划 会议 date meeting plan' },
  { emoji: '🗒️', keywords: '速记 记录 scratch record' },
  { emoji: '🔗', keywords: '链接 引用 link reference' },
  { emoji: '🧾', keywords: '报销 单据 receipt invoice' },
  { emoji: '🧪', keywords: '实验 测试 test experiment lab' },
  { emoji: '🎨', keywords: '设计 视觉 design visual art' },
  { emoji: '🖼️', keywords: '图片 素材 image asset' },
  { emoji: '🎬', keywords: '视频 内容 video content' },
  { emoji: '📷', keywords: '拍摄 摄影 camera photo shoot' },
  { emoji: '🌱', keywords: '新芽 起步 seed new start' },
  { emoji: '☕', keywords: '日常 随笔 coffee daily' },
  { emoji: '🏠', keywords: '首页 工作台 home workbench' },
  { emoji: '🐴', keywords: '品牌 吉祥物 horse brand mascot' },
];

/** 内置封面 token（视觉定义在 renderer 的 PageAppearance.css `[data-cover]`）。 */
export const PAGE_COVER_TOKENS = [
  'aurora',
  'dusk',
  'mint',
  'sand',
  'slate',
  'rose',
  'ocean',
  'forest',
] as const;

export type PageCoverToken = (typeof PAGE_COVER_TOKENS)[number];