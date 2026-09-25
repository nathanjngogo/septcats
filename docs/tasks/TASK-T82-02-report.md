# TASK-T82-02 交付报告（CB 填写 · PM 门禁核验）

> 任务书：`docs/tasks/TASK-T82-02.md` · 发现：`docs/Bug-hunt-R29.md` H-05/H-01/H-07

## §0 开工侦察结论（必答）

### ① A 项：回收站页（deleted_at≠null）重导入的现行语义与应钉语义

**现行语义（读码结论）：回收站页的账本行仍在 → 判重命中 → 整条剔除（skipped）。
即「重导被完全挡住」——既不会恢复原页，也不会新建副本。**

证据链（三处，逐字）：

1. **判重链只看 import_source、不看 page**：`main/importer.ts:521-533` 把 `importSource.list`
   全量预载成 `(source_path, content_hash) → page_id` Map，`plan.ts:130` 命中即整条剔除；
   全程**零 page 表查询**（`plan.ts:122-142` 的 `existingLookup` 注入面签名
   `(path, contentHash) => string | null` 也不携带 page 状态）。
2. **回收站页在库里唯一可能的表达是 `page.deleted_at > 0`**（`db/schema.v2.ts:12-15`：
   `NULL` = 存活；`> 0` = 软删除；`0` = 彻底删除标记）。`pages.ts` 的 `deletePage`
   走 `cascadeDeleteOps` + `commitOps`（`page.setDeleted`，`commit.ts:373-387` 把
   `deleted_at` 写成 `op.at`），**从不触 import_source**；`purgePage`
   （`pages.ts:688-723`）走 `deletionMode: 'purge'`（`deleted_at = 0`），同样不触。
   故 `(path, hash)` 行恒在 → 现行的 `importSource.list`（无 JOIN）恒返回它 → 恒命中。
3. **恢复是独立入口**：`pages.ts:675-686` `restorePage` → `editor/tree.ts:427-456`
   `planRestore`，语义是「把 `alive=0` 的链复活为 `alive=1`」——它**只作用于原页 id**，
   与导入计划无任何耦合（导入侧从不调用它）。

**应钉语义（本单落点）**：判重命中后加页存活校验，**「活页才算是已导入」**：
`page_id` 在 page 表 **且 `alive = 1` 且 `deleted_at IS NULL`** 才算重复；否则
（行不存在 / alive=0 / deleted_at≠null）视作未导入 → 允许重导。

**回收站页重导后是什么**：**新建一份副本**（新 page id），**原回收站页原样保留**。
即本题的答案是「新副本」而非「恢复原页」，理由三条：

- **判重侧只有「跳过 / 不跳过」两种动作，没有「恢复」这个动作**：`plan.ts` 的剔除逻辑
  与 `importer.ts` 的落地逻辑（`importer.ts:476` `ulid(at)` 恒发新 id + 新 upsert op）
  **结构上不可能复活一个已存在的 tombstone**——要「恢复原页」得让导入器去发 `restore`
  语义的 op（`planRestore`），那是**新增一条写入路径**，远超本单「只修判重语义」的边界，
  且会让导入行为依赖回收站状态（不可预期）。
- **回收站页 = 用户已表达「不要它了」**，此时重导的正确期待是拿回内容，而不是弹
  「已导入过」把用户挡在门外（H-05 的原始症状）；拦下来的话用户唯一出路是先去回收站
  恢复/彻底删除，语义绕远且不可发现。
- **`deleted_at > 0`（回收站）与 `deleted_at = 0`（彻底删除标记）必须同判**：两者都不是
  「活页」，判据统一为 `alive = 1 AND deleted_at IS NULL` 即可覆盖，无需分档——分档会
  引入「回收站拦、彻底删除放」的不一致。
- **不动「恢复」语义**：本单只在**导入判重**这一侧加存活过滤，`restorePage` /
  `planRestore` / 回收站列表（`page.listTrash`，`statements.ts:229-236` 只认
  `alive=0 AND deleted_at>0`）**一行不改**，T80 系列已收口的回收站语义不受影响。
  重导产生新页 id（`importer.ts:476` `ulid(at)`），原回收站页照旧留在回收站，
  用户可自行决定恢复或彻底删除——**两种意图都不被本单替用户做选择**。

**不做（任务书明令）**：不清 import_source 历史行（物理清账归 T81 GC）；本项只改判重语义。

### ② C 项：renderer 侧能否消费单一实现 `blockContentOf`？以什么包边界？

**结论：`blockContentOf` 本身 renderer 不可达（main 侧 `apps/desktop/src/main/blocks.ts`），
但它的下游依赖已经在跨侧共享包里——不新增包、不提函数，改提「文本抽取」这一层出口。**

侦察四条：

1. **`blockContentOf` 的位置与依赖**：`apps/desktop/src/main/blocks.ts:119`，依赖
   `@septcats/editor` 的 `normalizeTableContent` / `normalizeToggleContent`
   （`blocks.ts:23`）与 `node` 侧无涉。renderer 经 `preload` 拿到的是 `blocks.list`
   的**结果**（`types/window.d.ts:177-188` `BlocksListResult.blocks: Block[]`），
   拿不到 main 模块本身——**现状确实不可达**。
2. **既有同类先例照抄**：`main/pageExport.ts:27` 的 T79-02 缺陷 A 修法就是
   「删自带副本 → `import { blockContentOf } from './blocks'`」——但那是 **main 内部**的
   同侧收编，不解决跨侧问题。跨侧先例则是 `main/links.ts:16-19`：
   **renderer/main 两侧共用的纯函数一律落在 `@septcats/editor`**（`links.ts` 从
   `@septcats/editor` 取 `extractWikilinksFromContent` 与 `textOfBlockContent`）。
3. **更关键的发现：`@septcats/editor` 里已经有 `textOfBlockContent`**
   （`packages/editor/src/rules/wikilink.ts:174-197`，经 `src/index.ts:26`
   `export * from './rules/wikilink'` 跨侧可达），且注释写明「**code 纯文本与 PM doc
   双形态都支持**」。它是 links 派生索引的上下文片段抽取器——**与 C 项要的
   「结构化 content → 纯文本」是同一件事**，只是还没覆盖 table/toggle 两形。
4. **包边界结论**：**`@septcats/editor` 根出口**（`packages/editor/src/index.ts`）。
   零新包、零新导出面：在既有 `textOfBlockContent` 上补 table/toggle 结构化分支，
   main（`links.ts`）与 renderer（`cards.tsx` / `market.ts`）**引用同一实现**，
   绝不写第三份。`main/blocks.ts:blockContentOf` 保持原样（它是 `content_json → BlockContent`
   的入口，方向相反：本项走 `BlockContent → string`），出题人给的「优先消费
   `blockContentOf`」与「提纯函数到 `@septcats/editor`」两条路中，**后者才是可达路径**
   （`blockContentOf` 需要 `content_json` 字符串，而 renderer 手上已是解析后的 `BlockContent`）。


### ③ B 项：clearKey 失败在 CredentialStore 层的真实形态（抛错/返回 false/静默成功）

**结论：后端可用但写盘失败 → 抛 `Error`；后端不可用 → 抛 `CredentialUnavailableError`（带稳定码）；
「密钥本就不存在」→ 返回 `false`（**唯一**不抛的路径）。三者都不会静默成功。**

逐行证据（`packages/platform/src/credentials.ts`）：

| 层 | 行 | 形态 |
| -- | -- | -- |
| `delete` 入口 | `:299-302` | `assertSegment` 名字非法 → 抛 `CredentialNameError('E_CRED_INVALID_NAME')`；`await assertAvailable()` 后端不可用 → 抛 `CredentialUnavailableError('E_CRED_UNAVAILABLE')`（`:217-221`） |
| Windows 分支 | `:305-314` | `fs.unlink`：`ENOENT`（文件不在 = 本就没密钥）→ `return false`；**其他 fs 错误原样 `throw`**（如 EBUSY / EPERM / 目录不可写） |
| macOS 分支 | `:317-322` | `security delete-generic-password` 非 0 退出 → `return false`（不区分「不存在」与「真失败」，`:322` 只判 `code === 0`） |
| IPC 面 | `main/ai/ipc.ts:180-182` | `ai:clearKey` → `service.clearKey({...})`，**不 try/catch**；`ai/ipc.ts:15` 明写「`CredentialUnavailableError` 原样冒泡」→ 经 `ipcRenderer.invoke` 变成 renderer 侧的 rejected Promise |
| service 面 | `main/ai/service.ts:240-243` | `await this.credentials.delete(...)` 后 `return { ok: true }`——**`delete` 的 `false` 被忽略**，即「密钥本就不存在」被当作成功 |

**对 H-01 修复的含义（三条）**：

1. **失败必是 reject**：真失败（后端不可用 / 写盘失败）走 `throw` → renderer 的 `await` 必进
   `catch`。因此「不吞错」= 不在 `catch` 里静默——原 `.catch(() => {})` 正好吞掉的是这一路。
2. **`false`（本就没密钥）不需要报错**：它 resolve 成 `{ ok: true }`，UI 照常移除该项——
   与「清钥成功」不可区分也无需区分（没有孤儿密文 = 隐私面已达成）。故本单**不**把
   `clearKey` 的返回值升格为「必须 true」，只处理 reject。
3. **清理计划**（§2 实现）：失败 → danger toast（带 `{msg}` 透出稳定码）+ **该项保留在列表**
   并标 error 态 + **不发 providers patch**（阻断「UI 没了、密文还在」的不一致态）。

## §1 A · H-05 导入账本页存活校验

### 1.1 改动面（两处 SQL 白名单，均单条语句、无分号、无破坏性片段）

`apps/desktop/src/db/statements.ts`：

**① `importSource.list`（判重读面）—— JOIN page 收口存活校验**

```sql
SELECT i.source_path AS source_path, i.content_hash AS content_hash, i.page_id AS page_id
FROM import_source i JOIN page p ON p.id = i.page_id
WHERE p.alive = 1 AND p.deleted_at IS NULL
```

- 存活判据 `alive = 1 AND deleted_at IS NULL` 与 `db/schema.v2.ts:12-15` 的取值约定逐字一致
  （`NULL`=存活 / `>0`=回收站 / `0`=彻底删除标记），三态一并覆盖，**不分档**（分档会造成
  「回收站拦、彻底删除放」的不一致）。
- **过滤全在 SQL 内完成**（一条 JOIN），`importer.ts` 的预载循环与 `plan.ts` 的去重链
  **一行不改**——内存侧拿到的 Map 已经天然只含活页命中，大表纪律（禁内存二次过滤）达成。
- 列名保持旧口径（`source_path` / `content_hash` / `page_id`），调用方零改动。

**② `importSource.insert`（落账面）—— `OR IGNORE` → `ON CONFLICT DO UPDATE`**

```sql
INSERT INTO import_source (source_path, content_hash, page_id, created_at)
VALUES (@source_path, @content_hash, @page_id, @created_at)
ON CONFLICT(source_path, content_hash) DO UPDATE SET
  page_id = excluded.page_id,
  created_at = excluded.created_at
```

- **为什么必须一起改**：只改①会造成新的缺陷——页被删后重导会**新建页**（①放行），若落账仍
  `OR IGNORE`，账本行会永远停在死 `page_id` 上，于是**第二次重导又新建一份**（无限副本）。
  改 UPDATE 后「导 → 删 → 重导 → 再重导」闭环幂等（本单用例 ④ 钉死）。
- **幂等不破的证明**：正常重跑路径根本走不到这条语句的冲突分支——计划期判重会把活页命中
  整条剔除（`plan.ts:130-140`），执行期还有 `entry.pageIds` 断点跳过（`importer.ts:473-475`）。
  只有「死引用真被重导」这唯一一条路径会走 UPDATE，正是本项要修的语义。既有幂等用例
  （`importer-exec.test.ts` 的「幂等重跑」与「幂等不破」两例）**原样全绿**（§4）。

### 1.2 不做（照任务书）

- **不清历史行**：死引用的 `import_source` 行与 tombstone `page` 行都原地保留（用例 ⑤ 断言
  `COUNT(*) = 4` 恒定），物理清账归 T81 GC 范围。
- **不动回收站/恢复语义**：`pages.ts` 的 `deletePage` / `restorePage` / `purgePage`、
  `editor/tree.ts` 的 `planRestore`、`page.listTrash` 语句、`commitOps` 的 `deletionMode`
  全部零改动——T80 系列已收口语义未受触碰。
- **不替用户做「恢复原页还是留副本」的选择**：重导产生新页 id，原回收站页照旧留在回收站；
  §0-① 已把这条语义钉死（用例 ① 断言「两行并存：一 tombstone + 一活页」）。

### 1.3 测试（`apps/desktop/test/importer-exec.test.ts`，真 SQLite 5 例）

| # | 用例 | 断言要点 |
| -- | -- | -- |
| ① | 导 → 软删（回收站，`deleted_at > 0`）→ 重导 | `skippedDuplicate = 3`（修前 4）、`pages = 1`、账本 `page_id` 改指新活页且 `≠` 原 id、原 tombstone 仍在（两行并存） |
| ② | 导 → 彻底删除（purge，`deleted_at = 0`）→ 重导 | 同上（`skippedDuplicate = 3`），验证两态同判 |
| ③ | 账本行指向不存在的页（死引用，老板真机形态） | 视作未导入 → 只重导该条、`page_id` 不复为 ghost |
| ④ | 活页重导仍 skipped；导→删→重导→再重导 | 活页 `skippedDuplicate = 4 / pages = 0`（幂等原样）；闭环后仍 4 skipped、`页二` 恒两行（**不产第三份**） |
| ⑤ | 不清历史行 | 账本恒 4 行（无新增无物理删）、死引用 `page` 行仍在且 `alive = 0` |

`apps/desktop/test/statements.test.ts`（白名单 2 例）：`importSource.list` 断言含
`JOIN page` + `p.alive = 1` + `p.deleted_at IS NULL` + 三列 alias 保持；`importSource.insert`
断言含 `ON CONFLICT(...) DO UPDATE SET` 且**不含** `INSERT OR IGNORE`。


## §2 B · H-01 clearKey 显性报错

### 2.1 改动面（`apps/desktop/src/renderer/src/settings/AiSection.tsx`）

**删除入口 `confirmRemove` 重写**（原 `:463` 的 `.catch(() => {})` 是缺陷本体）：

```ts
const target = removeConfirmId;
setRemoveConfirmId(null);
// 密钥顺带清除：失败必须显性（不吞错），且阻止该项被移除
try {
  await window.septcats.ai.clearKey({ providerId: target });
} catch (cause) {
  setKeyClearFailedFor(target, true);
  pushToast(fillTemplate(t('settings.ai.keyClearFailed'), { msg: describeAiError(cause) }), 'danger');
  return;                                  // ← 早退：绝不落到 providers patch
}
setKeyClearFailedFor(target, false);
const providers = toConfigs(aiState).filter((p) => p.id !== target);
// …原成功路径逐字保留（含 activeProviderId 悬空清理）
```

三条语义（对应 §0-③ 的侦察结论）：

1. **失败 = reject → danger toast**：文案 `settings.ai.keyClearFailed` 带 `{msg}` 槽位，
   透出 `describeAiError(cause)`（`Error.message` 自带 `E_CRED_UNAVAILABLE：` 前缀，与
   `AiSection.tsx:37-39` 既有口径一致）。
2. **该项保留在列表 + error 态可重删**：新增 state `keyClearFailed: ReadonlySet<string>`；
   命中时卡片加 `settings-ai-card--error` 类（CSS 只 `var(--sc-color-danger)` /
   `var(--sc-color-danger-soft)`）+ 行内 `role="alert"` 提示
   （`data-testid="settings-ai-key-clear-failed-<id>"`，文案 `settings.ai.keyClearFailedHint`）。
   用户原地再点「删除」即可重试（重试成功 → `setKeyClearFailedFor(id, false)` 清态）。
3. **早退不发 providers patch**：这是隐私面的关键——若照旧移除项，就复现「UI 没了、密文还在」
   的不一致态。`return` 位置在 patch **之前**，用例以「`patch` 从未收到 `providers` 数组」正面钉死。
4. **成功路径零行为变化**：`clearKey` 的 `false` 返回值（密钥本就不存在，§0-③）被当作成功
   照常移除；`activeProviderId === target` 的清空分支逐字保留。

### 2.2 i18n（双语键齐平 + 禁词纪律）

| 键 | zh-CN | en-US |
| -- | -- | -- |
| `settings.ai.keyClearFailed` | 密钥未能从凭据库删除，请重试：{msg} | The API key could not be deleted from the credential store. Please retry: {msg} |
| `settings.ai.keyClearFailedHint` | 密钥仍在系统凭据库中，该项已保留。请重试删除。 | The key is still in the system credential store, so this entry was kept. Please retry the removal. |

- **键齐平**：两词典同批新增同两键（`i18n.test.ts` 门禁① 递归拍平后键集合等价，§4 绿）。
- **禁词纪律**：zh 文案用**「凭据库」**（对应系统凭据存储 CredentialStore），
  **未出现「数据库」三字**（i18n 门禁⑥ 全局扫描，§4 绿）；en 值无 CJK（门禁②）。
- **零硬编码 CJK**：新增文案全走 `t()`，无 JSX 字面量/属性字面量（门禁③④⑤）。

### 2.3 测试（`apps/desktop/test/settings-react.test.tsx`，2 例）

| # | 用例 | 断言要点 |
| -- | -- | -- |
| ① | `clearKey` reject（`E_CRED_UNAVAILABLE`） | store 中恰 1 条 toast、`tone='danger'`、`message` 含「密钥未能从凭据库删除，请重试」与 `E_CRED_UNAVAILABLE`；卡片 `className` 含 `--error`；`settings-ai-key-clear-failed-plocal1` 在场；**`patch` 从未收到 `providers` 数组** |
| ② | `clearKey` resolve（默认桥） | `patch` 收到的 `providers` 为 `[]`（唯一项被移除）；失败提示不在场；toast 队列为空 |

> 口径说明：`SettingsPage` 自身不挂 `ToastViewport`（全局视口在 `App.tsx:705` 根层），
> 故用例按 **store 载荷**断言 toast（`pagesStore.getState().toasts`），与真机渲染路径同源。

## §3 C · H-07 卡片摘要结构化分支

### 3.1 单一实现落点（照 §0-② 结论）

**零新包、零新导出面**：唯一实现在既有 **`packages/editor/src/content.ts`**（经
`packages/editor/src/index.ts:14` 的 `export * from './content'` 跨侧可达）：

```ts
export function blockContentTextLines(content: unknown): string[]
```

三分支分流（覆盖 `model.ts:138-144` 的 `blockContentSchema` 全部形态）：

| 形态 | 产行规则 |
| -- | -- |
| `string`（code 块） | 该串一行（空串不产行） |
| 结构化 `{rows: string[][], header, colWidths?}` | **逐单元格一行**（阅读序；空单元格不产行） |
| 结构化 `{title: string, body: string[]}` | title 一行 + body 逐行 |
| PM doc / 内联节点 | **块级子节点各成一行**（段内多 text 节点先拼成一行再上抛） |
| divider / image / null / 非法形态 | 空数组（不产行、不抛） |

判形顺序说明：table 判据用 `isStringGrid(record['rows'])`（**不看 `header`**，避免
「有 rows 无 header」的残缺形态漏判）；toggle 判据要求 `title` 为串且 `body` 全为串数组
（PM 节点的 `attrs` 不命中，不会误吞）。两形都排在 PM 兜底之前。

**两侧消费点（全部改为引用同一实现，无第三份）**：

| 侧 | 位置 | 改法 |
| -- | -- | -- |
| editor（main 侧派生索引） | `packages/editor/src/rules/wikilink.ts:174` `textOfBlockContent` | 删自带递归 → `blockContentTextLines(content).join('')`（**逐字等价**，见 §4 回归断言） |
| renderer（最近页摘抄卡） | `apps/desktop/src/renderer/src/workbench/cards.tsx:842` `firstTextOfBlock` | 删自带递归 → `blockContentTextLines(content)[0] ?? null` |
| renderer（模板市场种子正文） | `apps/desktop/src/renderer/src/workbench/market.ts:239` `extractPlainText` | 删自带 PM-doc-only 副本 → 逐块 `blockContentTextLines` 后以 `\n` 连接 |

**为什么不动 `main/blocks.ts:blockContentOf`**：它是 `content_json: string → BlockContent`
的**入口**（方向相反）；renderer 经 `preload` 拿到的是 `blocks.list` 结果
（`types/window.d.ts:177-188` 已是解析后的 `Block[]`）——`blockContentOf` 对 renderer
**确实不可达**，且即使可达方向也不对。任务书给的两条路中选「提纯函数到 `@septcats/editor`」，
并复用**既有出口**（`textOfBlockContent` 已在 `links.ts:16-19` 跨侧共用，是现成先例）。

### 3.2 测试（三形各钉 + 同源防分叉）

| 文件 | 例数 | 覆盖 |
| -- | -- | -- |
| `packages/editor/test/wikilink.test.ts` | +5 | table 逐格 / toggle title+body / PM doc 多段成一行的两读数 / 单段+字符串+null+非法值 / divider·image 不产行 |
| `apps/desktop/test/t71-cards.test.ts` | +3 | `firstTextOfBlock` 的 table（含首格空→取下一格、全空→null）/ toggle（title 空→body 首行）/ **同源一致性**（6 形态逐一断言 renderer 首行 == `blockContentTextLines[0]`，且 main 侧 `join('')` 以之开头） |
| `apps/desktop/test/t72-market-model.test.ts` | +6 | `extractPlainText` 的 PM doc 回归 / table 逐格 / toggle 逐行 / code+divider+空数组 / 三形混排拼接序 / **同源一致性**（三处文本逐形一致） |

**防实现再次分叉（T79 缺陷 A 教训）**：两侧用例都对**同一份形态夹具**调用
「renderer 侧函数 vs `@septcats/editor` 单一实现 vs main 侧 `textOfBlockContent`」，
断言文本一致——若日后有人再复制一份分流实现，先分叉的那一侧会立刻红。


## §4 门禁原始输出

### 4.1 环境说明（沙箱约束，非产品问题；DEVIATION 见 §5 D-1）

本机沙箱（workspace-write）**禁止带管道 stdio 的子进程**（读子进程 stdout 的
`spawn`/`exec`/`fork` 一律 `EPERM`）。命中的正是 vitest 启动链路的两处：
①`vite` 在 Windows 的 `exec('net use')` 探测（`windowsSafeRealPathSync`）；
②`esbuild` 的服务子进程（TS 转译）与 vitest 的 forks 进程池（`tinypool`）。
原生 `pnpm --filter @septcats/desktop test` 因此无法起（实测报错见 4.2）。

为**不交没跑过的测试**，本单照 **T80-04 / T80-06 先例**用**进程内等价垫片**在沙箱内跑
**同一份测试文件**（`--configLoader native` + 同一 include 面；用例零改动）：

| 垫片 | 位置（**非产线，收尾已删**） | 等价口径 |
| -- | -- | -- |
| ① 转译 | `apps/desktop/vitest.t82verify.config.mts` 的 `t82-inprocess-transpile` 插件 | `esbuild: false` 后以 `typescript.transpileModule` 进程内按文件转译（`isolatedModules` + JSX automatic，同 tsconfig 语义） |
| ② 原生模块 | `_scratch/t82-verify/sqlite-shim.mjs`（+ setup 的 `Module._load` 补丁） | 原生 `better-sqlite3` 是 Electron ABI 136 / Node 需 127 → 以 `node:sqlite` 垫片使 **DB 用例真跑**（真 SQLite 引擎、真事务、真 FTS5） |
| ③ net use | `_scratch/t82-verify/register.mjs` | 探测短路为「无网络盘映射 → 空输出」（本机确无映射盘，语义等价） |
| ④ esbuild | `_scratch/t82-verify/esbuild-shim.mjs` | vite 仅 `import { version }` + `transform`，垫片补齐 |

垫片与验证配置**仅用于本次验证，未落产线**（收尾已全部删除，见 §5 D-1）。
**PM 在正常环境直接跑原生命令即为最终口径。**

### 4.2 原生命令（沙箱内被拒的原始报错，证垫片必要性）

```
$ pnpm --config.enable-pre-post-scripts=false --filter @septcats/desktop test
> @septcats/desktop@0.5.0 test E:\Hermes Agent工作空间\Septcats\apps\desktop
> vitest run

failed to load config from E:\Hermes Agent工作空间\Septcats\apps\desktop\vitest.config.ts
⎯⎯⎯ Startup Error ⎯⎯⎯
Error: spawn EPERM
    at ChildProcess.spawn (node:internal/child_process:420:11)
    at Object.spawn (node:internal/child_process:787:9)
    at ensureServiceIsRunning (...\esbuild@0.28.2\node_modules\esbuild\lib\main.js:2272:29)
    at build (...\esbuild\lib\main.js:2170:26)
    at bundleConfigFile (...\vite@7.3.6...\vite\dist\node\chunks\config.js:35895:23)
  errno: -4048, code: 'EPERM', syscall: 'spawn'
ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL  @septcats/desktop@0.5.0 test: `vitest run`
```

### 4.3 三项**新用例的「红前」实证**（缺陷态下先红，证明测试真能抓到缺陷）

把三处修复**临时回退到缺陷语义**（随后已还原，无残留）再跑同一批用例：

**A 项**（`importSource.list` 退回无 JOIN 全量预载 + `insert` 退回 `OR IGNORE`）：

```
$ node --import <垫片> node_modules/vitest/vitest.mjs run --config vitest.t82verify.config.mts \
    --configLoader native test/importer-exec.test.ts test/statements.test.ts
 ❯ test/importer-exec.test.ts (11 tests | 4 failed) 196ms
   × H-05 ①：导 → 软删（进回收站）→ 重导 = 真入账（非 skipped），账本指向新活页
     → expected 4 to be 3        ← 缺陷态：全量静默跳过（老板真机 424/424 形态）
   × H-05 ②：导 → 彻底删除（purge，deleted_at=0）→ 重导 = 真入账（非 skipped）
     → expected 4 to be 3
   × H-05 ③：账本行指向不存在的页（死引用）→ 视作未导入，可重导
     → expected 4 to be 3
   × H-05 ④：活页重复导仍 skipped（幂等不破）；导→删→重导→再重导闭环（不产第三份）
     → expected 4 to be 3
 ❯ test/statements.test.ts (26 tests | 2 failed) 52ms
   × importSource.list：JOIN page 收口存活校验（alive=1 且 deleted_at IS NULL）
     → expected 'SELECT source_path, content_hash, pag…' to contain 'FROM import_source i JOIN page p ON p…'
   × importSource.insert：冲突时 DO UPDATE page_id（重导闭环幂等，非 OR IGNORE）
     → expected 'INSERT OR IGNORE INTO import_source (…' to contain 'ON CONFLICT(source_path, content_hash…'
 Test Files  2 failed (2)
      Tests  6 failed | 31 passed (37)
```

**B 项**（`AiSection.confirmRemove` 退回 `.catch(() => {})` 吞错）：

```
 ❯ test/settings-react.test.tsx (22 tests | 1 failed) 2323ms
   × T82-02 H-01：clearKey reject → danger toast「密钥未能从凭据库删除」且项未移除
     → expected [] to have a length of 1 but got +0   ← 缺陷态：toast 一条都没有（失败被吞）
   ✓ T82-02 H-01：clearKey resolve → 项移除且无失败提示（成功路径行为不变）
```

**C 项**（两函数退回各自的 PM-doc-only 递归/两层复制）：

```
 ❯ test/t72-market-model.test.ts (23 tests | 5 failed) 19ms
   × table 结构化：逐单元格一行（修复前整片丢失 → 空正文）
     → expected '' to be '格A\n格B\n格C'              ← 缺陷态：结构化正文全丢
   × toggle 结构化：title + body 逐行（修复前整片丢失 → 空正文）
   × code 纯文本串、divider/null：串原样、无内容不产行
   × 三形混排：按块序拼接（table / toggle / doc 同源分流）
   × 与 main 侧 textOfBlockContent 同源：三形逐字一致
 ❯ test/t71-cards.test.ts (16 tests | 3 failed) 4ms
   × T82-02：table 结构化 → 首个非空单元格（不是 null）
   × T82-02：toggle 结构化 → title（title 为空则落到 body 首行）
   × T82-02：与 main 侧 textOfBlockContent 同源（同一实现，文本一致）
```

### 4.4 修复后：改动面定向复跑（5 文件全绿）

```
$ node --import <垫片> node_modules/vitest/vitest.mjs run --config vitest.t82verify.config.mts \
    --configLoader native test/importer-exec.test.ts test/settings-react.test.tsx \
    test/t71-cards.test.ts test/t72-market-model.test.ts test/statements.test.ts
 Test Files  5 passed (5)
      Tests  98 passed (98)
   Duration  4.16s (transform 1.31s, setup 11ms, collect 1.90s, tests 1.48s, environment 401ms, prepare 160ms)
```

### 4.5 `apps/desktop` 全量（原生 `pnpm --filter @septcats/desktop test` 等价口径）

```
$ node --import <垫片> node_modules/vitest/vitest.mjs run \
    --config vitest.t82verify.config.mts --configLoader native      # cwd = apps/desktop

 Test Files  1 failed | 105 passed (106)
      Tests  2 failed | 1227 passed | 1 skipped (1230)
   Duration  83.73s (transform 3.81s, setup 71ms, collect 6.45s, tests 75.98s, environment 486ms, prepare 177ms)
```

仅 `test/perf.test.ts` 2 例红，**与本次改动无关**（未碰 perf 路径）：

```
 FAIL  test/perf.test.ts > 冷进程打开 1 万页真库 → 第一次搜索 ≤150ms（搜索红线的冷态账）
Error: spawn EPERM
 ❯ test/perf.test.ts:128:24   const child = spawn(process.execPath, ['--import', 'tsx', COLD_CHILD_PATH, ...])
 FAIL  test/perf.test.ts > 1 万页库冷打开 + migrate + 首查 <800ms（首屏预算的 DB 段）
Error: spawn EPERM
 ❯ test/perf.test.ts:128:24
```

**基线对比（只增不减）**：同一命令、同一垫片环境下，改动前（HEAD 工作树 + 本单仅新增
测试文件、未改任何源文件时）的基线为 **1212 用例**。需如实说明：基线首测出现
`8 failed | 1203 passed | 1 skipped`，其中 6 例是**垫片早期版本的保真度缺口**
（`migrations` 的文件级还原 1 例 + `portable-import` 的 close/reopen 1 例 + 既有 flaky
`manual-view` / `settings-react` 若干），与本单改动无关；补齐垫片（vite alias 指向
`node:sqlite`、`close` 幂等）后这 6 例转绿，垫片最终版红例**恒为 perf 的 2 例**。

| | 用例总数 | passed | failed（沙箱 perf） | skipped |
| -- | -- | -- | -- | -- |
| 改动前（基线） | 1212 | 1209（最终垫片下） | 2 | 1 |
| 改动后 | **1230** | **1227** | 2 | 1 |
| 差值 | **+18** | **+18** | 0 | 0 |

新增 18 例 = `importer-exec 6→11`、`statements 24→26`、`t71-cards 13→16`、
`t72-market-model 17→23`、`settings-react 20→22`（五文件 80 → **98**，逐文件核数见 §4.4）。
**无任何既有用例被删改或转红**：§4.4 的 5 文件定向复跑全绿，且
`packages/editor` 275 例（含既有 270 例）全绿。

### 4.6 `packages/editor`（改过 `content.ts` / `rules/wikilink.ts`）

```
$ node --import <垫片> node_modules/vitest/vitest.mjs run \
    --config <scratch>/vitest.editor.config.mts --configLoader native      # cwd = packages/editor

 ✓ |editor| test/wikilink.test.ts (20 tests) 16ms
 …
 Test Files  15 passed (15)
      Tests  275 passed (275)
   Duration  3.95s (transform 743ms, setup 166ms, collect 1.01s, tests 2.12s, environment 439ms, prepare 85ms)
```

`wikilink.test.ts` 由 15 → **20 例**（+5 为 T82-02 结构化三形状与回归保护）；
其余 14 个测试文件全绿（含 jsdom 的真 Tiptap/React 链路）。

### 4.7 `pnpm typecheck`（10/10 工程：8 packages + apps/desktop 两工程）

```
$ node node_modules/typescript/bin/tsc -p <each project>/tsconfig.json --noEmit
packages/core        exit 0
packages/schema      exit 0
packages/platform    exit 0
packages/ui          exit 0
packages/editor      exit 0
packages/dbview      exit 0
packages/sync        exit 0
packages/importer    exit 0
apps/desktop/node    exit 0
apps/desktop/web     exit 0     → 10/10 Done（0 error）
```

### 4.8 no-magic / i18n / CSS 纪律

```
$ node packages/ui/tokens/no-magic.mjs
✓ no-magic：组件 CSS 无字面 hex、无非 1px 重复裸 px
no-magic-exit=0

$ node --import <垫片> node_modules/vitest/vitest.mjs run --config vitest.t82verify.config.mts \
    --configLoader native test/i18n.test.ts test/ui-interaction-audit.test.ts test/blocks.test.ts
 ✓ test/blocks.test.ts (16 tests) 82ms
 ✓ test/ui-interaction-audit.test.ts (9 tests) 5ms
 ✓ test/i18n.test.ts (18 tests) 54ms        ← 含门禁①键齐平 / ②en 无 CJK / ⑥zh 无「数据库」
 Test Files  3 passed (3)
      Tests  43 passed (43)
```

### 4.9 红线复核

```
$ <扫描 packages/**/*.ts(x) 的 'electron' import>
（空输出 = packages/* 未 import electron）

$ <扫描本次改动 4 文件（AiSection.tsx / cards.tsx / market.ts / content.ts）的网络调用面>
（新增代码零 fetch / zero-egress；命中的 http://127.0.0.1:1234 等为既有本地端点预设，
  shell.openExternal 为既有用户点击路径，均非本单新增，无启动期外联）
```


## §5 DEVIATION 清单（若有）

| # | 偏离/前提与代码不符 | 处置（最小改动） | 需 PM |
| -- | -- | -- | -- |
| D-1 | 沙箱（workspace-write）禁带管道 stdio 的子进程（vite 的 `net use` 探测 + esbuild 服务 + tinypool forks），原生 `pnpm --filter @septcats/desktop test` 起不来（§4.2 原始报错 `spawn EPERM`）；审批通道不可用 | 照 **T80-04 / T80-06 先例**用**进程内等价垫片**跑**同一份测试文件**（§4.1：`typescript.transpileModule` 进程内转译 + `node:sqlite` 原生模块垫片 + net use 短路 + threads 单线程）；垫片全程**未落产线**（收尾已删除：`apps/desktop/vitest.t82verify.config.mts`、`apps/desktop/test/t82-verify.setup.mjs`、`_scratch/t82-verify/*`）。PM 环境请以原生命令复跑 §4.4–4.8 | 知悉 |
| D-2 | 任务书 C 项修法写「**优先消费 `main/blocks.ts:blockContentOf`**，renderer 不可达则提纯函数到 `@septcats/editor` 或 shared」 | §0-② 侦察结论：`blockContentOf` 对 renderer **确实不可达**，且**方向相反**（它是 `content_json: string → BlockContent` 入口；renderer 手上已是解析后的 `BlockContent`）。故走第二条路，并**复用既有出口** `@septcats/editor` 的 `textOfBlockContent`（`links.ts:16-19` 已是跨侧共用先例）作为落点，新增 `blockContentTextLines` 于同包 `content.ts`。**未新增包、未新增导出面以外的生产者**（`index.ts` 的 `export * from './content'` 已在位） | 追认 |
| D-3 | 任务书 A 项修法只提「判重加页存活校验」（SQL 一条 LEFT JOIN） | **连同 `importSource.insert` 一起改**（`OR IGNORE` → `ON CONFLICT DO UPDATE SET page_id`）。只改判重会引入新缺陷：重导新建页后账本仍停死 `page_id` → 第二次重导又新建一份（无限副本）。改后「导→删→重导→再重导」闭环幂等（用例 ④ 钉死），且既有幂等用例原样全绿 | 追认 |
| D-4 | 任务书 A 项测试要求「回收站页重导按现状 plan.ts 语义给出结论并钉死」 | 结论见 §0-①：**重导 = 新建副本，原回收站页保留**（不替用户做「恢复 or 清理」的选择）。用例 ① 以「两行并存：一 tombstone(`alive=0`) + 一活页(`alive=1`)」正面钉死 | 追认 |
| D-5 | 任务书 B 项测试要求「mock clearKey reject → 断言 toast 出现」 | `SettingsPage` 自身不挂 `ToastViewport`（全局视口在 `App.tsx:705` 根层），jsdom 里单纯 render `SettingsPage` 看不到 toast DOM。故用例改为按 **`pagesStore.getState().toasts` 载荷**断言（tone + message 内容），与真机渲染路径同源；卡片 error 态仍按 DOM 断言 | 知悉 |
| D-6 | `@septcats/editor` 的 `textOfBlockContent` 原为自带递归实现（`wikilink.ts`） | 一并收编为 `blockContentTextLines(content).join('')`（**逐字等价**）——否则就成了任务书禁的「第三份实现」。已加 2 例**逐字等价回归断言**（多段 doc / 单段·字符串·null 三形）钉死旧口径不变 | 追认 |
| D-7 | `importSource.list` 加了 `JOIN page` 后，SQL 白名单总数未变（仍 79 条） | 本单**未新增语句**（只改既有两条的 SQL 文本），故 `statements.test.ts` 的 `SQL_IDS.length` 预算钉（79 / <85）无需随动 | 知悉 |

## §6 遗留与观察项

1. **A 项只修语义、不清账**（任务书明令）：死引用的 `import_source` 行会**持续累积**
   （每次「删页 → 重导」都在同一 PK 上 UPDATE，行数不增；但「彻底删除的页且不再重导」
   会永久留一行死引用）。表体量与正确性均不受影响，但建议在 **T81 GC** 里补一条
   `DELETE FROM import_source WHERE page_id NOT IN (SELECT id FROM page WHERE alive = 1)` 的
   物理清账（含 workspace 无关的设备级口径）。本单未做（越界）。
2. **macOS 的 `delete` 返回 `false` 不区分「不存在」与「真失败」**（`credentials.ts:317-322`
   只判 `code === 0`）：本单按 §0-③ 只把 **reject** 当失败（Windows 路径的语义），
   macOS 上「钥匙串删除失败」会静默以 `false` → `{ok:true}` 通过。**这是既有平台缺口**，
   不在本单范围；若 PM 要在 macOS 上也守住隐私红线，需单独立账（让 `delete` 在非
   errSecItemNotFound 时抛错）。
3. **J-① 回环**：`importSource.insert` 改为 DO UPDATE 后，若**同一计划内**出现两条相同
   `(path, hash)`（理论上被重名后缀机制排除，见 `plan.ts:99-120`），后者会覆盖前者的
   `page_id`——与旧 `OR IGNORE`（保留前者）行为不同。已核对 `finalizePlan` 的 `seenPaths`
   铁律：最终 path 唯一，故不可达；记录备查。
4. **C 项文本口径的两个设计选择**（已固化为用例，供 PM 复核是否合意）：
   ①**table 取全部非空单元格**（不只首格）→ `extractPlainText` 会把整表压成逐行文本
   （种子页正文因此包含表格内容，符合「正文抽取」预期）；`firstTextOfBlock` 只取首行
   （= 首个非空格），符合「摘抄首文本」预期。②**toggle 取 `title` 起头**（title 为空才
   落到 body）——若 PM 认为摘要应只取 body，改一行（`content.ts` 的 toggle 分支调序）即可。
5. **未跑真机**（任务书 §门禁）：A 项的 PM 真机复验（scratch 夹具「导→删→重导」全链探针）
   与 B/C 项的 PM DOM 探针（禁词/文案/摘要文本断言）均由 PM 代跑，本单未自造探针。

---

DSH-T82-02-EXIT=0

---

## §7 PM 复跑（原生环境，最终口径；2026-09-25 21:0x）

**环境两坑（PM 落盘记录，非产品缺陷）**：①PATH 首位若为 hermes tools `node-26.7.0`，其内建
`localStorage`（需 `--localstorage-file`）会抢走 jsdom 用例的 `window.localStorage` → **309 用例
整片假红**；跑测前 `export PATH="/c/Users/Administrator/AppData/Local/hermes/node:$PATH"`（`node -v`
= **v22.23.2**）。②`TMPDIR/TEMP/TMP` 若为 8.3 短路径 `C:\Users\ADMINI~1\...`，libuv 在 Windows
watch 短路径目录触发 `Assertion failed: !_wcsnicmp(filename, dir, dirlen), file src\win\fs-event.c`
→ worker 未跑用例就 abort（表现为 `Channel closed`）；跑前把三者指到长路径
`C:\Users\Administrator\AppData\Local\Temp`。③`ensure-abi` 的 `pnpm rebuild` 在本机（无 VS +
GitHub 不通）必败且**会删掉原生模块**；已从 npmmirror 取
`better-sqlite3-v12.11.1-node-v127-win32-x64.tar.gz` 回填（N-API，node/electron 两 ABI 均可加载），
副本存 `_scratch/abi/`（electron ABI 副本一并留档，切 ABI 用拷贝代替 rebuild）。

**PM 实跑结果（原生命令，非垫片）**：

| 口径 | 命令 | 结果 |
| -- | -- | -- |
| typecheck | `pnpm -r typecheck` | **9/9 Done(0)** |
| desktop | `pnpm -C apps/desktop test` | **1230 passed / 106 files**（基线 1212 → +18） |
| sync | `pnpm -C packages/sync test` | **109 passed** |
| editor | `pnpm -C packages/editor test` | **275 passed**（基线 270 → +5，C 项新增） |
| importer | `pnpm -C packages/importer test` | **99 passed** |
| ui | `pnpm -C packages/ui test` | **168 passed** |
| CSS 纪律 | `node packages/ui/tokens/no-magic.mjs` | ✓ 无字面 hex、无非 1px 裸 px |
| 探针纪律 | `node docs/mockups/probe-discipline.mjs` | 73 脚本 / **0 违规** |
| 探针台账 | `node docs/mockups/probe-ledger.mjs` | 803 断言 / **0 红** |

**真机（PM 自造探针，scratch 双钉，真实根 mtime 不变）**：

| 探针 | 结果 |
| -- | -- |
| `cdp-e2e-t82-02.mjs`（A 项 H-05：导→软删→重导→软删+purge→重导→重启） | **16 PASS / 0 FAIL** |
| `cdp-e2e-t80-02.mjs`（便携包导入全链回归） | 21 PASS / 0 FAIL |
| `cdp-e2e-t80-01.mjs`（便携包导出） | 23 PASS / 0 FAIL |
| `cdp-e2e-t79-01.mjs` | 16 PASS / 0 FAIL |
| `cdp-e2e-t76-01.mjs` | 13 PASS / 0 FAIL |
| `cdp-e2e-t80-05.mjs`（便携包导入 UI 链） | 11 PASS / 0 FAIL |

**真机关键实证（A 项）**：回收站态（`alive=0, deletedAt>0`）重导 → `new=1 skipped=0`（修复前
为 `new=0 skipped=1` 静默跳过）；`purge` 态（`alive=0, deletedAt=0`）重导 → `new=1`；重导产生
**新页 id**（`01M3CBNWAEEV4JA77Q889NCNB1` ≠ 原 id）且原回收站页原样保留；重启后活页仍在。
活页重复导仍 `skipped=1`（幂等不破）。

**DEVIATION 复核**：D-1~D-7 **全部追认**（D-3「连 `importSource.insert` 一起改」是必要补强——
只改判重会造成无限副本，PM 已在真机 P3-4/P5-1 复核闭环保住；D-2 走既有 `@septcats/editor`
出口而非新增包，符合最小改动）。§6 遗留 4 条：①复用 `import_source` 死行清账 → 归 T81-01；
②macOS `delete` 静默 false → 既有平台缺口，PM 另立账；③`DO UPDATE` 同计划重名不可达（已核
`finalizePlan`）；④C 项文本口径两处选择（table 取全格 / toggle 取 title 起头）PM 认可。
