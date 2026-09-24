# T75-01 交付报告（CB 填写 · PM 门禁核验）

> 任务书：`docs/tasks/TASK-T75-01.md`（基线 main `ef4eb84`）
> 实作基线 = main `4a15fa9`（跑单期间 PM 又落 2 个 docs 提交：`0f4bd8b` CHANGELOG/发布仓 README、`4a15fa9` release-body 双语底稿）；工作树改动叠在 `4a15fa9` 之上。

## §1 交付概览（DoD 自检）

- [x] licenses extraResources 段 + 关于块第三方许可行（i18n 成对）
- [x] compression: maximum 生效（落顶层，见 DEVIATION-1）
- [x] package.json license 字段（根 + apps/desktop）
- [x] 构建实测体积对比 + 随包 OFL 字节等值断言（位 `resources/licenses/`，见 DEVIATION-2）

## §2 用例计数

| 门禁 | 命令 | 结果 | 基线 |
|---|---|---|---|
| typecheck | `pnpm typecheck`（`-r --no-bail`） | **9/9 包 Done，exit 0** | 9/9 |
| desktop vitest | `pnpm -C apps/desktop test` | **98 files / 1046 passed，exit 0** | 1041（T74-01）→ **+5** |
| ui vitest | `pnpm -C packages/ui test` | **33 files / 168 passed，exit 0** | 168（零改动，持平） |
| no-magic | `node packages/ui/tokens/no-magic.mjs` | **✓** | ✓ |

- desktop `+5` 明细：`test/settings-react.test.tsx` 19 → **20**（+1：关于块第三方许可行渲染）；
  新增 `test/t75-01-release-compliance.test.ts` **4 例**（yml licenses 段 / yml 顶层 compression / 两份 package.json license / OFL 正本字节指纹）。
- 附加（非门禁）：`node packages/ui/tokens/build-tokens.mjs --check` → **✓ token 产物与 DESIGN.md 一致**。

## §3 DEVIATION 登记

| 编号 | 现象 | 取舍 | 理由 |
|---|---|---|---|
| DEVIATION-1 | 任务书 §2 要求「`nsis` 段加 `compression: maximum`」；实测 `NsisOptions` **无** `compression` 键 | 落 **electron-builder 顶层** `compression: maximum`（`asar: true` 下方） | `compression` 是 `Configuration` 顶层选项（`app-builder-lib@26.15.3/scheme.json`：`properties.compression`，enum `maximum/normal/store`，默认 `normal`）；写进 `nsis` 段属非法键。任务书措辞笔误，落顶层方为唯一生效位 |
| DEVIATION-2 | 门禁要求「核 **asar 内** `licenses/OFL-NotoSansSC.txt` 字节等值」；实作按 §范围1 走 `extraResources` → 文件落 **asar 之外**的 `resources/licenses/` | 断言改为「随包路径 `dist/win-unpacked/resources/licenses/OFL-NotoSansSC.txt` 与源**字节等值**」，并以**字节流解析 app.asar 头**（未 extract-file）反证 asar 内无 `licenses/` 树 | ①任务书 §范围1 明确 `extraResources: from: resources/licenses → to: licenses`（与 workbench-templates 同风格）；②`extraResources` 的 electron-builder 语义就是 asar 外置位（镜像 `resources/workbench-templates/`、`resources/build/`）；③PM 发布说明 `docs/release-body-0.4.2.md:23` 与 `docs/发布仓README-0.4.2.md:23-24` **同样写 `resources/licenses/`**，与实作一致。**结论：门禁「asar 内」为措辞误差**，非实现偏差 |
| DEVIATION-3 | `compression: maximum` **未带来可测体积收益**：安装器 102,592,320 → **102,594,043 B（+1,723 B / +0.0017%）** | 保留 maximum（DoD 项是「生效」，已生效），但如实登记「无收益」 | electron-builder schema 自带注释原文：*"`maximum` doesn't lead to noticeable size difference, but increase build time"*。本期净增仅 1.7 KB，且小于新增内容体积（随包 OFL 4388 B + asar +893 B ≈ 5281 B）——说明增量已被压掉约 2/3，但整包量级不动。**是否保留（换构建耗时）待 PM 裁决** |
| 登记-1 | `extraResources` 新段我补了 `filter: "*.txt"`（任务书未指定） | 保留 | 对齐同文件 `workbench-templates` 段的 `filter: "*.json"` 风格，避免目录内未来混入非许可文件 |
| 登记-2 | 新增 5 条回归钉（任务书未要求） | 保留 | 钉住四项 DoD 不被回退：许可行被删 / yml 两段被误删 / `license` 字段回退 / OFL 正本被改（4388 B + sha256 + 无 BOM + 纯 LF） |
| 登记-3 | 跑测试/构建的本机副作用 | 不改代码，如实披露 | ①`docs/perf-history.jsonl` 被 perf 用例追加 4 行（`git_rev=4a15fa9`，全绿）——perf 台账既定行为；②`dist/latest.yml` 由本次构建重写为新包 size/sha512（**`.sig` 未重签**）；若 PM 拟用本机 dist 发布，须走 `publish.sh` 的「先归一化 yml 再 sign」流程 |

**未登记为偏差的红线结论**：安装/更新行为逻辑零改动（未碰 `updater.ts`/`feed-sign`/`publish.sh`）；组件 CSS **零新增**（关于块新行复用既有 `.settings-lab-d` + `<SettingsRow>`）；无新浮层/新按钮。

## §4 文件改动清单

| 文件 | 改动 |
|---|---|
| `apps/desktop/electron-builder.yml` | +11 行：顶层 `compression: maximum`（+注释）；`extraResources` 增 `from: resources/licenses → to: licenses`（filter `*.txt`，+注释） |
| `apps/desktop/src/renderer/src/pages/SettingsPage.tsx` | +6 行：关于块「技术栈」行后插入一 `<SettingsRow>`（title=`settings.about.thirdPartyLicense`，control=`.settings-lab-d` 文本=`…thirdPartyLicenseFile`）；**零 CSS、零新组件** |
| `apps/desktop/src/renderer/src/i18n/zh-CN.ts` | +2 键：`settings.about.thirdPartyLicense`=`第三方许可`、`…thirdPartyLicenseFile`=`Noto Sans SC（SIL OFL 1.1）· licenses/OFL-NotoSansSC.txt` |
| `apps/desktop/src/renderer/src/i18n/en-US.ts` | +2 键（成对）：`Third-Party Licenses`、`Noto Sans SC (SIL OFL 1.1) · licenses/OFL-NotoSansSC.txt`（en 无 CJK） |
| `package.json`（根） | +1 行：`"license": "UNLICENSED"` |
| `apps/desktop/package.json` | +1 行：`"license": "UNLICENSED"` |
| `apps/desktop/test/settings-react.test.tsx` | +13 行：新增 describe「设置页 · 关于块第三方许可（TASK-T75-01 §1）」（1 例，断言行内文案含随包路径） |
| `apps/desktop/test/t75-01-release-compliance.test.ts` | **新增**（4 例）：yml licenses 段 / yml 顶层 compression / 两份 package.json license / OFL 正本字节指纹 |
| `docs/perf-history.jsonl` | 测试副作用（+4 行，见 登记-3①）——非人工改动 |

- **OFL 正本零改动**：`apps/desktop/resources/licenses/OFL-NotoSansSC.txt` 工作树字节 = `4388 B` / `sha256 1c05c68c…e73d7d9`，与本单开单时一致，未被本单写入。
- 未新增依赖、未建表。

## §5 红线自检

- [x] 无新浮层/新按钮样式（§16 不触）：关于块新行 = `<SettingsRow>` + 既有 `.settings-lab-d` 文案类；本单 **未改任何 CSS 文件**
- [x] feed 签名链/更新行为零改动：仅改 `electron-builder.yml` 的 `extraResources`/`compression` 两个声明；`updater.ts`、`feed-sign.mjs`、`publish.sh` 未动
- [x] 无省略号占位常量（i18n 两键均为完整文案；无 `'…'`/`TODO` 占位）

## §6 门禁原始输出

### 6.1 门禁四件套

```
$ pnpm typecheck            # pnpm -r --no-bail run typecheck
Scope: 9 of 10 workspace projects
packages/platform typecheck: Done
packages/core typecheck: Done
packages/ui typecheck: Done
packages/schema typecheck: Done
packages/sync typecheck: Done
packages/editor typecheck: Done
packages/dbview typecheck: Done
packages/importer typecheck: Done
apps/desktop typecheck: Done
Exit Code: 0
```

```
$ pnpm -C apps/desktop test
 ✓ test/settings-react.test.tsx (20 tests) ...
 ✓ test/t75-01-release-compliance.test.ts (4 tests) ...
 Test Files  98 passed (98)
      Tests  1046 passed (1046)
   Duration  29.22s
Exit Code: 0
```

```
$ pnpm -C packages/ui test
 ✓ ui  test/pixel-borders.test.ts (8 tests) ...
 Test Files  33 passed (33)
      Tests  168 passed (168)
   Duration  4.80s
Exit Code: 0
```

```
$ node packages/ui/tokens/no-magic.mjs
✓ no-magic：组件 CSS 无字面 hex、无非 1px 重复裸 px
$ node packages/ui/tokens/build-tokens.mjs --check
✓ token 产物与 DESIGN.md 一致
```

### 6.2 dist 构建 + 体积对比

```
$ pnpm -C apps/desktop dist
  • electron-builder  version=26.15.3 os=10.0.26100
  • loaded configuration  file=…/apps/desktop/electron-builder.yml
  • packaging       platform=win32 arch=x64 electron=37.10.3 appOutDir=dist\win-unpacked
  • building        target=nsis file=dist\Septcats Setup 0.4.2.exe archs=x64 oneClick=true perMachine=false
  • building block map  blockMapFile=dist\Septcats Setup 0.4.2.exe.blockmap
Exit Code: 0

$ ls -la dist/*.exe
-rwxr-xr-x 102522116 Sep 22 15:51 dist/Septcats Setup 0.4.0.exe     # 旧
-rwxr-xr-x 102594043 Sep 24 11:34 dist/Septcats Setup 0.4.2.exe     # 本单
```

体积对比（同版本 0.4.2，唯一变量 = 本单配置）：

| 项 | 基线（默认 normal） | 本单（maximum） | Δ |
|---|---|---|---|
| 安装器 `Septcats Setup 0.4.2.exe` | 102,592,320 B | **102,594,043 B** | **+1,723 B / +0.0017%** |
| 基线 sha256 | `c90d6705406883d97f5955dc17ca29ad7f6b3d9c7da096a541818a47a123a812` | （见 dist/latest.yml sha512） | — |
| 载荷 `resources/app.asar` | 64,778,019 B | 64,778,912 B | +893 B（新增 `license` 字段 + 设置页/i18n 编译增量） |
| 随包 OFL（asar 之外） | 无 | 4,388 B | +4,388 B |

> R7（安装器 ≤ 150 MB）仍达标。`maximum` 的收益落在噪声级，见 DEVIATION-3。

### 6.3 随包 OFL 字节等值断言（字节流 in asar，未 extract-file）

```
$ python - <<'PY'   # cwd = apps/desktop
-- OFL 源 vs 随包 --
src  size=4388 sha256=1c05c68c34f9708415aada51f17e1b0092d2cea709bf4a94cd38114f9e73d7d9
pkg  size=4388 sha256=1c05c68c34f9708415aada51f17e1b0092d2cea709bf4a94cd38114f9e73d7d9
byte-identical = True

-- app.asar（字节流解析，未 extract-file）--
asar 顶层条目 = ['node_modules', 'out', 'package.json']
asar 文件总数 = 7300
asar 内 licenses/ 树存在 = False
asar 内 licenses/OFL-NotoSansSC.txt 存在 = False

RESULT: OK — OFL 随包字节等值（4388B / 同 sha256），位 resources/licenses/（extraResources=asar 外置位）
```

```
$ ls -la dist/win-unpacked/resources/
app-update.yml  app.asar  app.asar.unpacked/  build/  elevate.exe  licenses/  workbench-templates/
$ ls -la dist/win-unpacked/resources/licenses/
-rw-r--r-- 4388 Sep 24 11:28 OFL-NotoSansSC.txt
```

> 断言点：`dist/win-unpacked/resources/licenses/OFL-NotoSansSC.txt` 与源 `apps/desktop/resources/licenses/OFL-NotoSansSC.txt` **字节全等**（4388 B / 同 sha256）；app.asar 顶层仅 `node_modules/out/package.json`，**不含** `licenses/` 树（反证 extraResources 外置语义，见 DEVIATION-2）。
> 安装器内部文件名因 NSIS 整体压缩不可直接字节检索（`b'OFL-NotoSansSC.txt'` → not found）；`win-unpacked` 即 NSIS 载荷源树，为既有验收口径。

---

**收尾**：`CB-T75-01-EXIT=0`
