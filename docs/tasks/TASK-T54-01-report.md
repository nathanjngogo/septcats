


## §PM 复跑（2026-09-22 凌晨，独立）—— **29 PASS / 0 FAIL**

- CB 会话跑满 200 轮未写本报告（模式同 T31/T47/T49），代码+探针+截图+results.json 全落盘（01:45），PM 接手补收口。
- PM 亲跑 `cdp-e2e-t54-01.mjs`：**29 PASS / 0 FAIL**（与 results.json 29/0 一致）。关键原始值：G8-2 重启后编辑器可见全部五段文本（TRAY/DARK/REMEMBER/QUIT/TRAYQUIT，editorLen=57 hasAll=true）= 不丢数据硬证；G8-3 退出路径真退干净（alive=false）；G9-1 真档案 untouched（mtime 1789991614995.1055 前后一致）；G9-2 electron 杀净 count=0。
- 全仓 `pnpm -r test` 无红（core 51 / platform 41+1skip / ui 86 / schema 3 / sync 109 / editor 197 / dbview 122 / **desktop 693**=663+30 含 close-guard+close-ask-ui）；typecheck 0 错；双门禁 ✓；`SELFTEST OK`。
- 代码审读：closeGuard.ts 纯函数化状态机（idle→flushing→asking→exiting；FLUSH_TIMEOUT_MS=2000 超时 WARNING 兜底；quittingFlag 放行；parseCloseDecision 非法入参抛错）；CloseAskDialog overlay/2px 描边/pixel+modal shadow 全吃 T53 token、零内联 hex；remember 走 Checkbox。
- 截图目检（视觉判读）：三钮+「记住我的选择」+说明文案在位、默认钮像素描边成立、弹框区纯灰阶、无重叠错位。视觉模型误报「弹框无框/无遮罩」——代码实证 overlay（--sc-color-overlay）与 border/shadow token 俱在，判读以代码+CSS 为准；其「说明文字偏淡」提示登记观察项（ink-muted 4.81 过线，暂不动）。
- **红线合规**：`packages/core` 与 `packages/sync` 零改动（op 层未动）；无新增依赖；无新色值（询问框 CSS 仅引用 T53 token）。
