# TASK-T84-04 收口报告：双端真机验收 + §9.3 注入矩阵 7.8 附件条目

> 状态：✅ 完成（09-26 当轮）。commit `f08b47f`，已推 origin/main。
> 前置：T84-02/03 附件引擎（`63aa965`/`3fb02ac`）。探针 `docs/mockups/cdp-e2e-t84-04.mjs`。

## 交付

**双端真机探针 20/20**（三独立数据根 A/B/C + 同盘 SHARED 替身网盘，env merge=3s）：

| 腿 | 覆盖 PRD-T84 DoD | 结果 |
|---|---|---|
| F1 加密双端 E2E | DoD 1+2+5 | A 推 100MB `.enc` → B 恢复码拉回**逐字节等值**；传输窗口 electron CPU **12.4% < 20%**（流式分块铁证）；status.attachments 在位 |
| F2 混态 | DoD 3 后半 | B 关加密推明文 → A 加密态 sha 复验照收（形态分账跨设备口径） |
| F3 暂停/恢复 | DoD 6 | `setEnabled(false)` 即停不上行；恢复后 `.part` 残尸被 sweep |
| F4 垃圾注入 | DoD 3 前半 | files/ 真名假内容 → sha 不符隔离，不落活附件+sync.log 留痕 |
| F5 S10 恢复码 | DoD 5 + §9.3 | 无码首触 **key_mismatch 红条**（非静默）；假码拒收；真码导入 → 附件（100MB 逐字节）+段层（树含 A 页）全量追平 |
| F6 双钉 | 纪律 | 真实档案根零触碰；files/ 只增不删 |

## 排查实录（三轮 FAIL 全为探针夹具缺陷，产品零缺陷）

1. **out2：B 半程死** → 事后查明=前台超时留 20 个僵尸 electron 抢单实例锁污染环境；`killAll` 前置后消失。
2. **out3/out4：F1-5 下行拉回 FAIL** → B 端 sync.log 只有导入行、无周期轮 → **教训钉：`settings.patch` 只改文件，不唤醒 runtime 周期；开同步必须走 `sync.setEnabled` IPC（用户 UI 同口径）**。夹具改 `patch{encrypt}`+`setEnabled{on}` 后 20/20。
3. **stdio:'ignore' 丢死亡证据** → launch 改 stdout/stderr 落 `stdout-{name}.log` + `child.on('exit')` 写 result.log（探针可审计性纪律）。

## CI 双端六败治本（同 commit，全 runner 口径）

- `looks-t85` rules() 严格模式 TS2532/TS2322（5cc8e2b）
- `*.txt text eol=lf` 落实 → OFL 4388B 断言不再被 runner CRLF checkout 破坏
- page-width/tabs CSS 读盘 `process.cwd()` → `import.meta.dirname`（根聚合 cwd=仓库根）
- perf commitOps P95：CI 腿预算 200ms 量级哨兵（共享 runner 核争用 164.8ms 实证；精确预算=本地门禁）
- t84-02 下行 1.5MB 测试显式 30s（慢盘冷启动 5s 超时）
- credentials mac 形态：钥匙串不落文件（断言=credDir 零文件；argv hex 诚实留档）

## 门禁

- 本地 desktop 全量 1276=1273+3 抖动败（search-lock/page-export/t67-lock 单独复跑 31/31 全绿，并跑 CPU 争用，既有口径）
- probe-discipline **80 脚本 0 违规**；平台/ ui 腿本地全绿
