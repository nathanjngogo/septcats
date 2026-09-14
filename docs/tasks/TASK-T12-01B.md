# TASK-T12-01B · M10-B 自动更新（electron-updater + feed 自签 + 差量 + 回滚）

> PM：Hermes ｜ 工程师：CodeBuddy ｜ 前置：T12-A（`a26117e`）打包已合入，latest.yml/blockmap 已能产出
> 必读：docs/PROJECT_PLAN.md §M10（更新器全文）、§3 决策表「自动更新」行（照抄 Notion 优点：
> latest.yml + sha512 + blockmap 差量 + 发布者名校验 + pending 目录；避开弱点：feed 自签）、
> docs/tasks/TASK-T12-01-report.md（T12-A 现状与产物形态）。
> 纪律：每写完一个文件立即跑对应验证；不碰 git；禁占位符；不碰 src/** 功能代码之外的顺手重构。

## 0. 架构裁决（PM 已定，不再讨论）

1. **依赖**：`electron-updater`（进 apps/desktop dependencies，本任务唯一新增外部依赖）。
2. **Provider**：generic，feed URL 由 `app-update.yml`（builder 的 publish 占位生成）+
   运行期覆盖 `setFeedURL` 支持本地测试注入（host 白名单：localhost/127.0.0.1 仅当
   `SEPTCATS_DEV_FEED=1` 环境变量在场时允许——生产拒本地源，这是隐私默认的一部分）。
3. **feed 自签（对 Notion 弱点的修复）**：
   - 密钥：Ed25519（Node stdlib `crypto.generateKeyPairSync('ed25519')` 即可，零新依赖）；
   - 发布工具 `scripts/feed-sign.mjs`：对 latest.yml 内容（原文字节）签名 → 产出
     `latest.yml.sig`（base64 单行文件，与 yml 同目录发布）；私钥路径由环境变量
     `SEPTCATS_FEED_KEY` 指定，**私钥永不入库**（.gitignore + 报告说明交付方式）；
   - 更新器消费流程：拉 latest.yml → **先验 sig（失败→拒绝并上报 E_FEED_SIGNATURE）**→
     再交 electron-updater 走 sha512/blockmap；实现方式 = 在 electron-updater 的
     `update-available` 事件里拿 yml 文本自验（或包一层 GenericProvider 子类，选最小改动者，
     写 DEVIATIONS 说明）；
   - 验签公钥：硬编码常量进 `src/main/updater.ts`（PEM 注释标明轮换流程）。
4. **更新器服务面（main）**：新建 `apps/desktop/src/main/updater.ts`：
   - 状态机：idle → checking → available(downloading→downloaded) / not-available / error；
   - IPC 通道（对齐仓内 handle 模式）：`update:check`（手动/启动 5s 后自动一次）、
     `update:state`（主→渲染推送）、`update:download`、`update:install`（= quitAndInstall，
     前置 confirm:true）、`update:rollbackHint`（安装失败 electron-updater 自身回 pending，
     本端只做日志与状态透出）；
   - 发布者名校验：Windows 安装时 electron-updater 默认行为保留 + NSIS 配置里
     `artifactName` 路径不含空格目录问题已在 T12-A 解决，确认即可。
5. **渠道**：feed 目录结构 `stable/latest.yml(.sig)` 与 `beta/latest.yml(.sig)`，
   应用内渠道选择一期固定 stable（设置页 UI 归 M9 后续，不做）。
6. **UI**：设置页「关于」区块加一行：当前版本 + 「检查更新」按钮 + 状态文案
   （四态：检查中/已是最新/下载中 N%/重启更新）；点击「重启更新」弹 confirm。
   CSS 只吃 var(--sc-*)，双主题。
7. **pending 目录**：electron-updater Win 默认行为即是下载→NSIS 暂存→重启应用；
   不额外造轮子，测试里断言下载缓存在 `%LOCALAPPDATA%/@septcatsdesktop_updater`（或实际
   路径，跑出来为准）。

## 1. 交付物

| 文件 | 内容 |
|---|---|
| `apps/desktop/src/main/updater.ts` | 状态机 + 五通道 + 自签验签 + dev-feed 门 |
| `apps/desktop/src/shared/updater.ts` | IPC 契约类型（UpdateState 联合、通道名） |
| `apps/desktop/src/main/index.ts` | 接线（仅 import + register，别动无关逻辑） |
| `apps/desktop/src/preload/index.ts` + `types/window.d.ts` | update 桥 + 类型 |
| `apps/desktop/src/renderer/src/pages/SettingsPage.tsx` | 「关于」行 + 四态 + confirm |
| `apps/desktop/scripts/feed-sign.mjs` | 发布签名工具（keygen 子命令 + sign 子命令） |
| `apps/desktop/test/updater.test.ts` | 见 §2 |
| `apps/desktop/electron-builder.yml` | publish 段补 beta 通道（一行级） |
| `.gitignore` | + 私钥模式（`*.feed.key`、`feed-keys/`） |

## 2. 测试底线（node 侧可全验，真机端到端归 PM）

- **yml 验签**：签→验通过；篡改 yml 一字节→E_FEED_SIGNATURE；无 sig 文件→拒；错误密钥→拒。
  （用 `feed-sign.mjs keygen` 在 tmp 生成临时密钥对，测试不依赖真实私钥。）
- **feed URL 门**：无 `SEPTCATS_DEV_FEED` 时 localhost feed 被拒（纯函数可测）。
- **状态机**：事件流注入 → idle→checking→available→downloaded 序列 + IPC payload 形状
  （对齐 shared/updater.ts 契约，zod parse 断言）。
- 存量 139 desktop 测试零破坏；`pnpm -r typecheck && pnpm -r test && selftest && no-magic && build` 全绿。

## 3. 报告

`docs/tasks/TASK-T12-01B-report.md`：交付表、关键裁决、验证原文、DEVIATIONS、
「PM 真机验收指引」一节（给出本地假 feed 的启动命令：改版本号出 0.1.1 包 +
feed 目录 + SEPTCATS_DEV_FEED 跑法，PM 照单执行两版升级实测）。

## 4. DoD

```
pnpm -r typecheck && pnpm -r test
node packages/ui/tokens/no-magic.mjs
pnpm -C apps/desktop selftest && pnpm -C apps/desktop build
```
