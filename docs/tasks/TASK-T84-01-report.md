# TASK-T84-01 · 同步文件夹向导 + 托盘同步状态行 ✅

> 老板 09-26 七条令之「4 要开始做」（网盘向导）+「4④ 向导未做」销账。
> 提交：`d7dfa95`（实现）+ 本卡探针收口。

## 交付
1. **settings.sync.folder**（platform zod + desktop 契约）：'' = 默认 `<数据根>/sync`；
   非空必须绝对路径——`patchAppSettings` 侧 `assertSyncFolderValid` 拒相对路径
   （E_SETTINGS_INVALID），防 SyncRuntime 落进不可预期 cwd。
2. **六处同源解析** `syncFolderFor(ctx)`：SyncRuntime rootDir、便携导出 syncDir、
   便携导入 syncDir、诊断包 syncDir、settings:get/patch 的 data.note 回显。
3. **设置页三步向导**（SettingsPage）：`更改…` → 原生目录选择器（sync:pickFolder，
   取消=向导不出现）→ 确认对话框（含「数据不搬移/新文件夹从首设备起步」风险文案）→
   patch 落盘 → 「重启以生效」步（立即重启 app:restart / 稍后手动）。
4. **重启链** `app:restart`：restartPending 去重 + app.relaunch + quit
   （quittingFlag 经 before-quit 正常置位，走冲刷放行链不弹询问框）。
5. **托盘同步状态行**（T84-01 §M8.8）：菜单顶部不可点行——
   未开启 / 已同步 / 待传 N / 同步中 (N) / 出错 / 文件夹不可访问；
   runtime.onState 跃迁即 refreshTrayMenu；数据源抛错兜 null 不炸托盘；
   中英分隔符各随语种（：/: ）。
6. i18n 双语 10 键 + CSS `.settings-sync-path-row`；测试夹具 13 处补 folder 字段。

## 验证
- 单测：desktop **1247/1247**（+2 新用例：close-guard 状态行 7 态、settings folder 守卫）；
  platform 41；sync 133；六包全绿；tsc node+web 0 错；build OK。
- 真机探针 `docs/mockups/cdp-e2e-t84-01.mjs`：**15/15 PASS**——
  默认回显→改 folder 落盘→相对路径被拒且原值不动→restart 进程真退→
  relaunch 同参自动拉起→新目录 manifest.json 起步→**旧默认目录 manifest 字节停更**
  （换根铁证）→真实根 `.septcats` mtime 零触碰。
- 原生选择器 OS 级弹出不在自动化范围（Electron 行为，风险面=落盘→重启→换根链，已全覆盖；
  探针头部如实注记）。

## 边界与遗留
- 改 folder 后**旧同步文件夹内容不搬移**（向导文案明说，用户自理）——符合「换设备/换盘」心智。
- 附件 files/ 面 = T84-02（老板拍板方案 A）。
