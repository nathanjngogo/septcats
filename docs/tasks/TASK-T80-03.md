# TASK-T80-03 · 缺陷修复：设置页「导出便携包」预览真机必失败（E_MALFORMED）

> 发现：PM 真机探针 `docs/mockups/cdp-e2e-t80-01.mjs` 首跑（09-24 深夜，T80-01 交付后）
> 级别 **P1 功能不可用**（用户点按钮即报错，预览面板永不出现）
> **状态：主修已由 PM 一行级完成**（`preload/index.ts` preview 补传 `{}`，属分工允许的一行级修改）；复跑探针 **P1/P2 全绿（23 PASS/0 FAIL）**。本单保留项=**同类面排查**（§同类面），并入 T82-01 派 CB 一起做。
> 施工面：只 Write/Edit 落盘，不碰 git、不跑全仓（PM 复跑门禁 + 探针复跑）。

## 症状（真机可复现）

设置页点「导出便携包」→ 渲染侧抛：
`Error invoking remote method 'portable:export:preview': Error: E_MALFORMED: IPC 参数必须是对象`

## 根因（三行对照，实锤）

| 位置 | 代码 | 结果 |
| :-- | :-- | :-- |
| `shared/portable.ts` 契约 | `preview(input: PortableExportInput)` | 需要对象 |
| `preload/index.ts:289` | `preview: () => ipcRenderer.invoke(PORTABLE_EXPORT_CHANNELS.preview)` | **不传参** → 线上是 `undefined` |
| `main/portable.ts:418` | `if (typeof raw !== 'object' \|\| raw === null \|\| Array.isArray(raw)) throw E_MALFORMED` | 拒绝 |

R27 的 `pageExport` 同族写法是**传了** input 的（`preview: (input) => ipcRenderer.invoke(ch, input)`，UI 侧 `pageExport.preview({})`）——本单漏了同口径。

## 修法（最小 diff）

`apps/desktop/src/preload/index.ts`：

```ts
preview: () =>
  ipcRenderer.invoke(PORTABLE_EXPORT_CHANNELS.preview, {}) as ReturnType<SeptcatsApi['portable']['preview']>,
```

（`confirm` 已是 `(input) => invoke(ch, input)`，UI 传 `{}`，无需改。）

## 同类面排查（**必做**，防同类缺陷复发）

全仓扫一遍「**preload 不传参 invoke ↔ main 侧要求对象入参**」的组合，列出清单并逐条定性（需要修的当场修、不需要的写明理由）：
- 方法：列出所有 `ipcRenderer.invoke(<CHANNEL>)`（**单参**）调用点 → 对每个 channel 找 main 侧注册处 → 看入参守卫是否要求 object；
- 已知同族：`CHANNEL_PAGE_EXPORT_PREVIEW` 等 R27 通道、`blocks/pages/search/templates/lockIpc/shell` 的 E_MALFORMED 守卫族（`grep -rn "IPC 参数必须是对象" apps/desktop/src/main` 共 13 处）；
- 产出写进报告 §1 表格：`channel | preload 形态 | main 守卫要求 | 判定（修/不需修+理由）`。

## 验收

1. 单测：`apps/desktop` 全量不回归（若渲染侧有 observable 测试，补一条「preview 调用携带空对象」的钉子）；
2. 真机探针：`node docs/mockups/cdp-e2e-t80-01.mjs` → **P1-0/P1-1/P1-2/P1-3/P1-5 与 P2-2/P2-3 全绿**（PM 复跑；当前首跑为红：P1-0 FAIL `E_MALFORMED`、P2-2/P2-3 FAIL）；
3. 报告 `docs/tasks/TASK-T80-03-report.md` 前置骨架，§1 必须含上述同类面清单表。