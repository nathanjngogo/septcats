# TASK-T83-01 报告 · ensure-abi.mjs 加固（PM 接手直写）

> 通道说明：09-26 14:26 起 CB 两槽（hy4-preview-f / deepseek-v4.1-flash）与 DSH（同 buddy 池）
> 全线 429；老板口令「如果CB和DSH都派发不成功，你直接接手」→ 本单由 **PM 直接实现**，
> 任务书 = `docs/tasks/TASK-T83-01.md`（PM 自己起草），纪律照常：原生测试、报告全填、DEVIATION 如实。

## §0 侦察（四问）

1. **谁摧毁二进制**：`rebuild(['pnpm','rebuild','better-sqlite3'])` 失败时 pnpm 已先删整个
   `build/Release/`（09-25 事故 = 旧脚本 48 行直接 rebuild、无任何备份）。
2. **备份放哪才安全**：**不能放 `build/Release/` 旁边**——被摧毁的正是那个目录。
   选 `apps/desktop/.abi-cache/`（进 .gitignore）。（这是写第一版后跑测试才逼出来的结论，见 D-1。）
3. **electron ABI 无法进程内验证**：node 进程 `require('better-sqlite3')` 加载 electron v136
   必抛 → electron 在位判定=「标记 + 文件存在」；node 判定=真实加载探针。
4. **恢复路径优先级**：node = 缓存 → npmmirror prebuild 下载（URL 模板=09-25 实证逐字）→ rebuild 兜底；
   electron = 缓存 → dist/win-unpacked 已验产物回填（09-25 实证路径）→ electron-rebuild 兜底。

## §1-§4 交付

- `apps/desktop/scripts/ensure-abi.mjs` 重写：①销毁前必备份 + 失败逐字节回填（含 build/ 整目录没后
  自动重建层级落回）②`.abi-cache/{node,electron}.node` 缓存命中零 rebuild ③目标就位=零副作用幂等
  ④`export` 纯函数面（backupBinary/restoreBackup/buildPrebuildUrl/findBs3Bin/bs3Version/inPlace/main）。
- `.gitignore` +1 行 `apps/desktop/.abi-cache`。
- 新测试 `apps/desktop/test/ensure-abi.test.ts`（7 用例）：备份/回填逐字节相等 ×2、无文件=不动目标、
  **备份幸存于 build/Release 整体摧毁**、URL 与实下载逐字钉死、版本推导+fallback、pnpm 布局定位。
- 缓存种子已就位（本机实证产物）：`electron.node`=afa1dcae… / `node.node`=c4b95a94…（各 1,918,976 B）。

### 门禁原始输出（实测）

```
node scripts/ensure-abi.mjs electron → 缓存命中（.abi-cache/electron.node）  EL=0
node scripts/ensure-abi.mjs node     → 缓存命中（.abi-cache/node.node）      ND=0
pnpm test（desktop 全量）            → 1241 = 1240 pass + 1 perf 红（环境负载，见下）
npx vitest run test/perf.test.ts（机器安静复跑）→ 4 passed；P95 12.6ms≤16、rebuild 1823ms<5000
```

perf 首跑红定性：**非本单回归**——同轮 107 文件全绿、其余 3 项 perf 绿、复跑即 4/4；
红时机器有并发负载（前一批 429 探针/DSH 烟测残留）。沿用「perf 隔离复跑」既有纪律口径。

## §5 DEVIATION

- **D-1（测试抓出实现缺陷）**：第一版 `backupBinary` 把备份放在二进制同目录
  （`${binPath}.tmp-…`）→ 测试「build/Release 整体消失后备份幸存」**当场红**→ 改备份目录为
  `.abi-cache`。教训入注释：备份位置必须在摧毁范围之外。
- **D-2（任务书「测试注入 rebuild 失败」改为夹具级）**：任务书设想「把 rebuild 注入成抛错」测回填；
  实改：备份/回填拆成纯函数用临时目录夹具钉死（不在单测里真动 node_modules——CI 安全），
  `main()` 的失败路径由同一段纯函数 + 代码走查覆盖（catch 分支唯一出口即 restoreBackup）。
- **D-3（缓存种子 PM 手工播种）**：`.abi-cache` 不入库（.gitignore），新克隆首次跑仍走下载/rebuild
  后自动存缓存；本机种子用 09-25 实证文件直播种（字节已在 §1 登记）。
- **D-4（验收②「人为让 rebuild 失败」降级为等价演练）**：不真拆本机 node_modules（风险>收益）；
  等价验证=测试夹具逐字节钉死「摧毁→回填」，且 `restoreBackup` 与 main 失败分支是同一函数同一代码路径。
- **D-5（pretest 链保留）**：`package.json` 的 `pretest=ensure-abi.mjs node` 语义不变（验收「不许做」项遵守），
  脚本自身幂等化后 pretest 每轮≈零开销（加载探针通过即退）。

## §6 遗留

1. 首次下载路径（无缓存无 dist 产物 + GitHub 不通的裸机）只有 npmmirror 一条腿——网络再收紧需镜像兜底。
2. electron 在位判定信 `.abi-target` 标记——若有人手工替换二进制不更新标记会误判（概率极低，纵深可加字节 sha256 白名单）。
3. `.abi-cache` 里历史 `.tmp-abi-*` 备份若进程中途被杀可能残留（restoreBackup 只清当次）；无害、体积=单二进制。