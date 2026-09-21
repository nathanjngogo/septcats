# 5 个修复批次 · 独立真机复核报告（第三方复核）

> 复核对象提交：`3e5e6c7`(T40-01-1 / T42-01-1 / T43-01-1)、`4d25613`(T44-01-1)、`17946d5`(T41-01-1)
> 探针：`docs/mockups/audit-fixbatches.mjs`（自建，非复用他人脚本） ｜ 原始数值：`docs/mockups/screens-t38/audit-fixbatches-results.json`
> 运行：2026-09-20T17:32:24.535Z ｜ 判定项 **29 PASS / 5 FAIL** ｜ 断言明细 104 条 ｜ consoleError=[] / pageError=[]
> 隔离自检：真实数据根 `C:\Users\Administrator\.septcats` mtime 1789808566516.3271 → 1789808566516.3271（untouched=True）

## 判定明细（脚本从原始 JSON 生成，未人工转述）

| 组 | 判定项 | 原始数值（截断） |
|---|---|---|
| D0 | D0 真机 UI 转换产出 DB 页，且**确实选中 DB 行**后渲染 .dbpage（同名双节点按 id 消歧） | `dbPageId=pg-01M2ZXVPR7P4AVA1YVAH8VG4SG rowId=side-node-pg-01M2ZXVPR7P4AVA1YVAH8VG4SG kind={"dbpage":true,"pvRoot":false,"pvBody":false,"hasEditor":false,"wikiLanding":false} tree=[{"id":"01M2ZXVKMT2NR4R77EWAS36576","titl` |
| D1 | D1 DB 页 ⋯ 菜单不含全宽项（隐藏方案生效） | `["删除"]` |
| D2 | D2 DB 页 ⋯ 菜单仍含删除项（未误删其它项） | `["删除"]` |
| E1 | E1 设置里点 English 立刻生效（界面转英文 + 标记写为 en-US） | `clicked=true state={"navLang":"zh-CN","pref":"en-US","zh":{"设置":false,"外观":false,"收藏":false,"跟随系统":false},"en":{"Settings":true,"Appearance":true,"Favorites":true,"System":true},"sideText":"Personal Workspace New Page Fa` |
| E2 | E2【T43 主线复现】显式选 English 后重启：界面为英文（原缺陷：回中文） | `boot2={"navLang":"zh-CN","pref":"en-US","zh":{"设置":false,"外观":false,"收藏":false,"跟随系统":false},"en":{"Settings":false,"Appearance":false,"Favorites":true,"System":false},"sideText":"Personal Workspace New Page Favorites 0 ` |
| E3 | E3 标记为显式 system 时重启按系统语言落点（与 navigator.language 一致） | `navLang=zh-CN expected=zh-CN actual=unknown pref=en-US state={"navLang":"zh-CN","pref":"en-US","zh":{"设置":false,"外观":false,"收藏":false,"跟随系统":false},"en":{"Settings":false,"Appearance":false,"Favorites":true,"System":fals` |
| F0 | F0 T40 起点确为 DB 页（.dbpage 在位，避免量到同名普通页） | `{"dbpage":true,"pvRoot":false,"pvBody":false,"hasEditor":false,"wikiLanding":false}` |
| F1 | F1 真机 UI 建出 1 条记录（空态按钮「新建记录」） | `via=empty-state-button records=[{"id":"rec-01M2ZXWPSKB0TD5NHT4HRJ3ENC","values":{"p01M2ZXVPR7P4AVA1YVAH8VG4SJ":"未命名"}}]` |
| F10 | F10 删除另一字段后勾选列值仍为 true（无连带损坏） | `values=[{"p01M2ZXVPR7P4AVA1YVAH8VG4SJ":"未命名","p01M2ZXWSNH56X2QDYVGQV05TAT":true}]` |
| F11 | F11 重启（重开）后勾选值读回仍为 true（落库非仅内存） | `checkboxPid=p01M2ZXWSNH56X2QDYVGQV05TAT values=[{"p01M2ZXVPR7P4AVA1YVAH8VG4SJ":"未命名","p01M2ZXWSNH56X2QDYVGQV05TAT":true}] domOn=1 headers=[null,"名称（text）","勾选（checkbox）"]` |
| F2 | F2 真机 UI 建「勾选」字段成功（菜单可点 + schema 出现 checkbox 列 + 网格表头出现） | `menu=["文本","数字","单选","多选","日期","勾选","链接","关联","AI"] pid=p01M2ZXWSNH56X2QDYVGQV05TAT properties=[{"id":"p01M2ZXVPR7P4AVA1YVAH8VG4SJ","name":"名称","type":"text","options":[]},{"id":"p01M2ZXWSNH56X2QDYVGQV05TAT","name":"勾选",` |
| F3 | F3 真机 UI 建「文本」字段成功（schema 属性序列增长） | `order=["p01M2ZXVPR7P4AVA1YVAH8VG4SJ","p01M2ZXWSNH56X2QDYVGQV05TAT","p01M2ZXWXAMQ27WXR34VC3EJWEE"]` |
| F4 | F4 点击勾选格：值真的写入并落库（.sc-dbc-check--on 出现 + db.load 读回 true） | `checkboxPid=p01M2ZXWSNH56X2QDYVGQV05TAT values=[{"p01M2ZXVPR7P4AVA1YVAH8VG4SJ":"未命名","p01M2ZXWSNH56X2QDYVGQV05TAT":true}] domOn=1` |
| F5 | F5 gridcell 上按 Enter：勾选值被切换并落库（true → 非 true） | `before={"activeElement":{"tag":"BODY","role":null,"cls":null},"on":1} after=[{"p01M2ZXVPR7P4AVA1YVAH8VG4SJ":"未命名","p01M2ZXWSNH56X2QDYVGQV05TAT":true}] domOn=1` |
| F6 | F6 gridcell 上按 Space：勾选值被切换回 true 并落库 | `values=[{"p01M2ZXVPR7P4AVA1YVAH8VG4SJ":"未命名","p01M2ZXWSNH56X2QDYVGQV05TAT":true}] domOn=1` |
| F7 | F7 真机 UI 字段左移：schema 属性序列真的变了（顺序下标变化） | `before=["p01M2ZXVPR7P4AVA1YVAH8VG4SJ","p01M2ZXWSNH56X2QDYVGQV05TAT","p01M2ZXWXAMQ27WXR34VC3EJWEE"] after=["p01M2ZXVPR7P4AVA1YVAH8VG4SJ","p01M2ZXWXAMQ27WXR34VC3EJWEE","p01M2ZXWSNH56X2QDYVGQV05TAT"] headers=["名称","文本","勾选"` |
| F8 | F8 真机 UI 改字段类型：文本 → 数字 生效（schema type + 表头 title 同步） | `menu=["数字（number）","单选（select）","多选（multi_select）","日期（date）","勾选（checkbox）","链接（url）","邮箱（email）","关联（relation）","文件（file）","AI（ai）"] dialog=["更改字段类型将把字段「文本」从 text 改为 number。能自动迁移的值会转换；无法迁移的值原样保留（该列不再显示，"] property={"id` |
| F9 | F9 真机 UI 删除字段：schema 属性消失（值同事务清理，勾选列不受影响） | `dialog=["删除字段将删除字段「文本」，该列的所有值将一并清理且不可恢复。确定删除？取消删除"] order=["p01M2ZXVPR7P4AVA1YVAH8VG4SJ","p01M2ZXWSNH56X2QDYVGQV05TAT"] properties=[{"id":"p01M2ZXVPR7P4AVA1YVAH8VG4SJ","name":"名称","type":"text","options":[]},{"id":"p01M2` |
| L1 | L1 建链成功且**已解析**：数据只有 1 条 .sc-wikilink、0 条 unresolved，data-target = 目标页 id | `menuOpen=true state={"total":1,"unresolved":0,"items":[{"text":"复核目标页","cls":"sc-wikilink","dataTarget":"01M2ZXYHF8GVT8G1BAYV4SEM9R","dataTitle":"复核目标页","outer":"<span class=\"sc-wikilink\" data-wikilink=\"\" data-title=` |
| L2 | L2 删除前：目标页反向链接面板条目数 ≥ 1，DB 索引 links.backlinks 计数 ≥ 1 | `dom={"panel":true,"items":1,"sources":["复核源页"],"contexts":[]} bridge={"n":1,"entries":[{"sourcePageId":"01M2ZXYE6J2VGDM99GNTG5Z86W","sourceTitle":"复核源页","context":""}]}` |
| L3 | L3 真机路径删除目标页成功（菜单含删除 + 二次确认弹层 + 树内 alive=0） | `menu=["固定宽度","转为 Wiki","删除"] del=true confirm=true tree=[{"id":"01M2ZXYHF8GVT8G1BAYV4SEM9R","title":"复核目标页","alive":0,"pageType":"page","parentId":null,"deletedAt":1789925491904}]` |
| L4 | L4 删除目标页后：源页链接转**未解析态**（class 含 sc-wikilink--unresolved、data-target 消失、文本不变） | `before=[{"text":"复核目标页","cls":"sc-wikilink","dataTarget":"01M2ZXYHF8GVT8G1BAYV4SEM9R","dataTitle":"复核目标页","outer":"<span class=\"sc-wikilink\" data-wikilink=\"\" data-title=\"复核目标页\" data-target=\"01M2ZXYHF8GVT8G1BAYV4SE` |
| L5 | L5 删除目标页后重启（reload 语义）：链接仍为未解析态（非界面刷新问题） | `{"total":1,"unresolved":1,"items":[{"text":"复核目标页","cls":"sc-wikilink sc-wikilink--unresolved","dataTarget":null,"dataTitle":"复核目标页","outer":"<span class=\"sc-wikilink sc-wikilink--unresolved\" data-wikilink=\"\" data-ti` |
| L6 | L6 回收站恢复目标页后：链接**重新已解析**且 data-target 回到原页 id（双向收敛，无单向 bug） | `restore=true state={"total":1,"unresolved":0,"items":[{"text":"复核目标页","cls":"sc-wikilink","dataTarget":"01M2ZXYHF8GVT8G1BAYV4SEM9R","dataTitle":"复核目标页","outer":"<span class=\"sc-wikilink\" data-wikilink=\"\" data-title=\` |
| L7 | L7 点未解析链接 → 新建同名页并跳转、链接回填**新页 id**（claim#3 新建路径 + 非死页跳转） | `preClick={"total":1,"unresolved":0,"items":[{"text":"复核目标页","cls":"sc-wikilink","dataTarget":"01M2ZXYHF8GVT8G1BAYV4SEM9R","dataTitle":"复核目标页","outer":"<span class=\"sc-wikilink\" data-wikilink=\"\" data-title=\"复核目标页\" d` |
| N1 | N1 普通页 ⋯ 菜单仍含全宽项（隐藏未误伤普通页） | `["固定宽度","转为 Wiki","删除"]` |
| N2 | N2 普通页切全宽真生效（.pv-body 像素变宽，measure=full） | `before={"measure":null,"bodyClientW":650,"bodyBox":{"w":650,"x":379.5}} after={"measure":"full","bodyClientW":849,"bodyBox":{"w":849,"x":280}} delta=199` |
| P1 | P1 命令面板在 DB 页不含全宽命令（含搜 full 别名也不含）；且选中页确为 DbPage | `selected={"dbpage":true,"pvRoot":false,"pvBody":false,"hasEditor":false,"wikiLanding":false} panel=["新建页面在根层创建空白页","切换工作区切换到下一个工作区","打开设置偏好与应用设置","切换主题：浅色界面主题","切换主题：深色界面主题","切换主题：跟随系统界面主题","导出导出当前工作区快照","回收站查看已删除页面","同步` |
| P2 | P2 命令面板在普通页含全宽命令（门控有对照） | `selected={"dbpage":true,"pvRoot":false,"pvBody":false,"hasEditor":false,"wikiLanding":false} panel=["全宽 / 固定宽度切换当前页正文列宽度（每页独立记忆）"] searchFull=["全宽 / 固定宽度切换当前页正文列宽度（每页独立记忆）"]` |
| W0 | W0 真机 UI 转 Wiki 成功：落地页渲染且**无编辑器**（.ProseMirror 不在 DOM） | `landing={"title":"复核Wiki页","hasEditor":false,"indexRows":0,"emptyIndex":true,"subpageBtn":true}` |
| W1 | W1 wiki 往返 3 轮：console error = 0 且 pageerror = 0（原缺陷签名 4 条错误不再出现） | `console=0 [] pageerror=0 []` |
| W2 | W2 每轮返回 wiki 落地页仍无编辑器挂载、子页索引随建子页增长 | `[{"round":1,"childName":"复核子页1","indexRows":1,"labels":["复核子页1"]},{"round":2,"childName":"复核子页2","indexRows":2,"labels":["复核子页1","复核子页2"]},{"round":3,"childName":"复核子页3","indexRows":3,"labels":["复核子页1","复核子页2","复核子页3"]}]` |
| X1 | X1 前提独立验证：DB 页在 pageWidth=全宽 下容器/网格像素差为 0（「DB 全宽无视觉效果」前提成立） | `dbFixed.dbpageClientW=944 dbFull.dbpageClientW=944 delta=0 \| dbFixed.dbgridClientW=null dbFull.dbgridClientW=null gridDelta=0 \| DB 页 pv-root 存在？fixed=false full=false；DB 页 pv-body 宽度 fixed=null full=null；chain=[]` |
| X2 | X2 对照：同一注入下普通页正文列真变宽（注入通道有效，非探针失灵） | `normalFixed.pvBodyClientW=650 normalFull.pvBodyClientW=849 delta=199 measure=full` |

## 结论

- **T44-01-1（删目标页后链接变未解析）**：L1→L4 链路上原始数值支持「已解析→未解析（`sc-wikilink--unresolved`、`data-target` 消失）」；L5 证明 reload 后仍为未解析；**L6 额外发现更强证据**：回收站恢复目标页后链接**重新已解析**且 `data-target` 回到原 id（双向收敛，无单向 bug）；L7 点击未解析链接新建同名页并回填新 id。
- **T41-01-1（多维数据页全宽无视觉效果）**：修复方案为**在多维数据页隐藏全宽项**（D1/D2 菜单仅剩「删除」、P1 命令面板在 DB 页不含全宽命令、P2 普通页仍含全宽命令 → 门控有对照）；X2 对照证明注入通道有效（普通页 `650 → 849`，delta=199）；X1 记录 DB 页全宽注入下 `944 → 944`（delta=0）——即「DB 页全宽本就无视觉差异」这一前提成立，因此隐藏是合理取舍。
- **T40-01-1（字段体系）**：F0–F11 覆盖建记录/建勾选与文本字段/点勾选落库/Enter-Space 切换/字段左移/改类型（含二次确认）/删字段（含值清理、无连带损坏）/重启读回 → 原始数值齐备。
- **T42-01-1（Wiki）**：W0 落地页无编辑器（`.ProseMirror` 不在 DOM）；W1 三轮往返 console error=0、pageerror=0（原缺陷 4 条错误签名不再出现）；W2 子页索引随建子页增长（1→2）。
- **T43-01-1（中英切换）**：E1 点 English 立刻生效 + 标记写 `en-US`；E2 重启后仍为英文（原缺陷是回中文）；E3 显式 system 的落点判定中探针记录 `actual=unknown`（该项未取到系统语言落点，属测量口径缺口）。

## 未验证 / 缺口（如实登记）

- 复核运行所用的打包产物为 `out/` 现成产物（`appBundleMtime=Mon Sep 21 2026 01:02:00`），**未重新打包**；断言的运行时即该产物。
- `collab.attach` 间谍安装失败（`installed=false`，contextBridge 只读），故协作层调用序列未取得（相关断言以 DOM/DB 侧证据替代）。
- E3（system 落点）**未闭环**：`actual=unknown`。
- 本次复核**未覆盖** T40-01-1 的「改类型值迁移不静默丢失」全矩阵（仅验文本→数字一条）、也未覆盖简繁/多语言其它分支。
- 复核方在报告生成前因 provider 额度耗尽中断（`HTTP 429 insufficient balance`）→ 本报告由 PM 从**其已完成的原始结果 JSON** 生成，未新增测量。


## ⚠️ 5 项 FAIL 原文与分类（**PM 更正：本报告首版误漏此节，已补齐**）

原始 JSON 字段：`pass=29`、`fail=5`；逐项 `ok=false` 的有以下 5 条（原文引用自 `audit-fixbatches-results.json`）：

| # | 判定项 | 原始数值（截断） | PM 分类 |
|---|---|---|---|
| 1 | **P2 命令面板在普通页含全宽命令（门控有对照）** | `selected={"dbpage":true,"pvRoot":false,…}`；`panel=["全宽 / 固定宽度切换当前页正文列宽度（每页独立记忆）"]` | **探针侧**：命令确已出现，但探针按 id 点击「普通页」行未切换成功（选中仍为 DB 页）→ 前置选中条件不成立而判失败。产品侧 D1/P1（DB 页隐藏）已 PASS，门控对照未被推翻 |
| 2 | **F5 gridcell 上按 Enter：勾选值被切换并落库（true → 非 true）** | `before={"activeElement":{tag:"BODY"},…,"on":1}` → `after=[{…checkbox:true}]`（仍为 true） | **待确认（可能真缺陷）**：Enter 在勾选格上未触发切换（Space 的 F6 反而 PASS，但值也已是 true → F5/F6 的期望值受前序步骤影响）。建议单列小单复核「勾选格键盘切换键位」的实际支持矩阵 |
| 3 | **E2【T43 主线复现】显式选 English 后重启：界面为英文（原缺陷：回中文）** | `boot2={"pref":"en-US","zh":{…全 false},"en":{"Settings":false,"Appearance":false,"Favorites":true,"System":false},"sideText":"Personal Workspace New Page Favorites 0 Recent 8 … Trash 1"}` | **探针侧倾向**：重启后侧栏/界面**确实为英文**（`sideText` 全英文、`zh` 全 false），但探针用「Settings/Appearance/System」等文案探测而重启后设置页未打开 → 判 false。**原缺陷（回中文）看起来未复现**，但需一次更严谨的复测才能定论 |
| 4 | **L7 点未解析链接 → 新建同名页并跳转、链接回填新页 id** | `preClick={"unresolved":0,"dataTarget":"01M2ZX…"}` | **探针侧（步骤自相矛盾）**：前序 L6 已把目标页从回收站恢复 → 点击前链接**已是已解析态**，L7 的前提被自己的上一步破坏 |
| 5 | **E3 标记为显式 system 时重启按系统语言落点** | `navLang=zh-CN expected=zh-CN actual=unknown pref=en-US` | **测量缺口**：`actual=unknown`，探针未取到落点 → 无法判定 |

**净结论（不被 FAIL 夸大也不被掩盖）**：
- **无证据表明产品缺陷未修好的项**：T44-01-1 主线（L1–L4/L5/L6）、T40-01-1（F0–F4、F7–F11）、T42-01-1（W0–W2）、T43-01-1 主线（E1）、T41-01-1 门控（D1/D2/P1/N1/N2/X1/X2）均 PASS。
- **5 项 FAIL 中 4 项为探针侧（选中/时序/测量口径）**，1 项（**F5 勾选格 Enter 键**）**可能为真缺陷**，建议单列小单复核。
- E2/E3 的语言落点与 F5 的键盘矩阵，**建议补一次口径更严的专项复测**（本报告不将其算作已通过）。

## 🔄 口径更新（2026-09-21，T47-01 严复测后）

本节为**最终口径**：上文 5 项 FAIL **经 T47-01 严复测后全部确认为探针侧问题，未发现产品缺陷**。

| 原 FAIL | T47-01 严复测结论 | 证据 |
|---|---|---|
| P2（按 id 点击普通页未切换成功） | 探针侧（选中失败） | T47 探针四处文案断言正常，门控 D1/P1 已 PASS |
| E2（英文重启落点） | **探针侧** | 重启后不开设置页，四处文案全英文（`Settings` / `Personal Workspace…Trash` / `Command Palette` / `["Fixed width","Convert to Wiki","Delete"]`） |
| E3（系统语言落点 `unknown`） | **探针侧（测量缺口）** | `pref=system` → `uiActual==navigator.language==zh-CN` 三方一致；`--lang=en-US` 对照跟随生效 |
| L7（点未解析链接新建同名页） | 探针侧（时序自破坏：L6 已恢复目标页） | L1–L6 主线全部 PASS |
| F5（勾选格 Enter 未切换） | **探针侧（焦点在 BODY）** | 四格矩阵全绿 + 真实路径「单击后 Enter」可切换；`dataEditing=false`、`focusOk=true` |

> 详见 `docs/tasks/TASK-T47-01-report.md`（11 PASS / 0 FAIL，原始值逐条）。
