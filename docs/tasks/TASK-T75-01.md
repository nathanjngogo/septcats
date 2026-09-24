# TASK-T75-01 · 发布合规面补齐（license 随包 + 体积优化）

> 基线 = main `ef4eb84`。0.4.2 已首发，老板要求「做正式发布、补齐 GitHub 要求」——代码侧缺口两项：
> ① 随包字体 Noto Sans SC（OFL 1.1）**许可文本未进安装包**（OFL 要求分发时附许可副本）；
> ② 安装包 102.5MB 未开最大压缩（GitHub Release 体验向）。
> 工作目录 = 主树 `E:\Hermes Agent工作空间\Septcats`（分支 main）。禁碰 git；不建表、不加依赖。

## 范围

1. **OFL 随包**：
   - 仓库 `apps/desktop/resources/licenses/OFL-NotoSansSC.txt` **PM 已落盘**（从 `cdn.jsdelivr.net/gh/google/fonts@main/ofl/notosanssc/OFL.txt` 逐字节取回，4388 B）——你**不得改这个文件任何字节**；
   - `electron-builder.yml` extraResources 增段：`from: resources/licenses → to: licenses`（与 workbench-templates 段同风格）；
   - 设置→关于 区块（SettingsPage 关于块）加一行「第三方许可」文案链到随包路径（一行级，i18n 成对 zh/en，无新浮层无新按钮样式=不触 §16）。
2. **体积压缩**：`electron-builder.yml` nsis 段加 `compression: maximum`（若已在顶层则确认生效即可）；构建耗时增加可接受。
3. **package.json license 字段**：根与 apps/desktop 两处 `"license": "UNLICENSED"`（private 仓诚实声明，与 README 口径一致；PM 会另改发布仓 README 的 Proprietary 声明）。

## 门禁

- typecheck 0 / desktop vitest 只增不减 / ui vitest 157+（不动 ui 则 168 基线） / no-magic ✓；
- **构建实测**：`pnpm -C apps/desktop dist` 完成后 `ls -la dist/*.exe` 贴体积对比（基线 102,592,320 B）、`python - <<PY` 核 asar 内 `licenses/OFL-NotoSansSC.txt` 字节等值（禁 extract-file，用字节流 in asar 断言）；
- 报告续写 `docs/tasks/TASK-T75-01-report.md`（骨架前置，你填 §2/§3/§6）。

## 红线

- 不改安装/更新行为逻辑；不碰 feed 签名链；组件 CSS 零新增（关于块只是文案）。
- 收尾打印 `CB-T75-01-EXIT=0`。
