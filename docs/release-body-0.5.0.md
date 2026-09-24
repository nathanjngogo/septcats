# Septcats 0.5.0

## 中文
**这次更新让编辑器更像一支顺手的笔。**

- **表格块**：`/表格` 直接插入，任意增删行列、一键表头行；单元格随打随存，重启完整还原。
- **折叠列表**：默认收起的层级列表（`/折叠列表`），箭头点开，把长笔记折起来。
- **代码块语言栏**：光标进入代码块浮出语言选择（12 种 + 自动）与换行开关，失焦后角落淡显当前语言。
- **图片宽度拖拽**：拖图片右缘即可改宽度（8px 吸附，拖拽中显示百分比）。
- **跨块多选**：Shift+点块手柄=连续区间选择，批量删除/复制/转块型/上色，多选态拖拽=整组移动。

**升级安全**：所有新块/新属性走既有块数据格式，操作日志零变化——老数据直接升级，同步与导入导出不受影响；老版本打开新块会降级显示、不丢内容。

---

## English
**This release makes the editor feel more like a capable pen.**

- **Table block**: insert with `/table`, add/remove rows & columns freely, toggle a header row; cells persist and restore on restart.
- **Toggle list**: collapsible nested lists (`/toggle`) to fold long notes away.
- **Code block language bar**: a language picker (12 languages + auto) and a wrap toggle appear when the caret enters a code block; the current language shows as a subtle tag when unfocused.
- **Image width drag**: grab the right edge of an image to resize (8px snapping, live percentage badge).
- **Multi-block selection**: Shift+click a block handle to select a contiguous range; bulk delete / duplicate / convert (13 types) / color; dragging while selected moves the whole group in order.

**Safe upgrade**: all new blocks/attributes ride the existing block data format — zero changes to the operation log. Upgrade from 0.4.x directly; sync and import/export are unaffected; older versions degrade new blocks gracefully without data loss.
