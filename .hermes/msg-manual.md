说明书同步 0.6.10 新功能 + 终包重审闭环

- 双语说明书：快捷键表 +Ctrl+F/F9 两行、正文 +查找/大纲/专注/字数条；manual-markdown 契约 6→8 同步
- 说明书 ?raw 进包 ⇒ 重打包重审：终包 102,742,205 / sha256 70f85252…
- 包审三关全过：静态 17/17（锚点同步）· NSIS 解包逐字节（exe/asar/原生模块 + 79/79 文件集）· 老板机静默重装（asar c9f4d117 一致）
- 已装版真机回归：T99-01 24/24 · IDEA-A 10/10
- 坑入档：pnpm dist 内部 pnpm 子进程 ENOENT（rc=1 产物不动）→ 分步 pnpm build + pnpm exec electron-builder 立即成功
- 至此：功能（T95-T102）+ 方向 B 视觉 + 创意 A-D + 包审 + 说明书 = 0.6.10 全部闭环，publish 只等老板点头
