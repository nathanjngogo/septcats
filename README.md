# Septcats

本地优先、类 Notion 的跨平台笔记与知识管理应用。数据全部在用户设备上，离线可用，真相层是**不可变事件日志分段文件**（可被任意网盘搬运），SQLite 只是本机可重建的物化视图。

当前阶段：**M0 工程骨架 + M2a 纯逻辑核心**（领域层，可脱离 Electron 单测）。

## 环境要求

| 项 | 版本 |
| --- | --- |
| Node.js | >= 22 |
| pnpm | 9.15.9（本仓固定 `packageManager`） |
| 操作系统 | Windows 10/11、macOS 13+ |

首次使用先启用 pnpm（若尚未安装）：

```bash
corepack enable
corepack prepare pnpm@9.15.9 --activate
```

## 三条命令

```bash
pnpm install     # 安装依赖（workspace 全量）
pnpm dev         # 启动 Electron 开发窗口（electron-vite，三进程热更新）
pnpm test        # 跑全部单测（vitest，含收敛性 fuzz）
```

常用补充命令：

```bash
pnpm typecheck       # 所有包 TypeScript strict 检查，0 error
pnpm test:coverage   # 单测 + 覆盖率（packages/core 行覆盖 >= 90%）
pnpm build           # electron-vite build（产出 apps/desktop/out，不出安装包）
```

## 目录结构

```
septcats/
├─ package.json            # 根，private，packageManager=pnpm@9.15.9
├─ pnpm-workspace.yaml
├─ tsconfig.base.json      # strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes
├─ vitest.config.ts        # projects 模式串起各包
├─ packages/
│  ├─ core/                # @septcats/core 纯领域逻辑（零运行时依赖，除 zod）
│  │  ├─ src/{op,clock,sortkey,segment,projection,replay,snapshot}.ts
│  │  ├─ src/util/ulid.ts
│  │  └─ test/             # clock/sortkey/segment/replay/convergence/util 单测
│  └─ schema/              # @septcats/schema zod -> JSON Schema + DESIGN 常量
└─ apps/
   └─ desktop/             # Electron + React 壳（electron-vite）
```

## 关键约束

- `packages/core` **不得 import `electron`**；核心逻辑必须能在纯 Node 下跑测试（`grep -r "from ['\"]electron" packages/` 必须 0 命中）。
- 文件路径一律用 POSIX 风格拼接（`path.join`），代码内禁止 emoji。
- 一期不实现同步引擎、数据库、迁移与打包签名；Op 已为同步预留 `merge_policy` 与 `base` 字段。
- UI 视觉以根目录 `DESIGN.md` 的 token 为单一来源；本阶段渲染器只放占位 tokens。

## 许可

私有项目，未授权请勿分发。
