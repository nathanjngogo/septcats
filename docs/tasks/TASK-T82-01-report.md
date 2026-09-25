# TASK-T82-01 交付报告（CB 填写 · PM 门禁核验）

> 任务书：`docs/tasks/TASK-T82-01.md` · 发现：`docs/Bug-hunt-R29.md` H-04（P0）
> 落盘方式：只 Write/Edit，未碰 git。

## §0 开工侦察结论（四问）

### ① 现判据的误判面有哪些
（待填：`runtime.ts:1113` 计数启发式的所有偏差来源——快照竞态 / INSERT OR IGNORE 去重 / 并发 commit / CRDT 落账）

### ② `replace` 语义的所有调用点清单
（待填：runtime 自愈、vendor/测试桩、T80-02 便携包导入侧；逐点标注应改 `merge` 还是保留 `replace`）

### ③ `merge` 语义下 FTS 与派生索引怎么重建
（待填：fts_defer flag / FTS_RESYNC / page_link_index / mention 的重建顺序与成本）

### ④ 覆盖度校验成本
（待填：963 op 与 1 万页账本两档实测毫秒数）

## §1 修复实现

（待填：覆盖度守卫、去竞态判据、`mode: 'replace'|'merge'` 参数与默认值）

## §2 测试

（待填：新增红测复现 442→1 场景 / 覆盖完整时 replace 绿测 / merge 并集测 / 测试桩语义修正）

## §3 门禁原始输出

（待填）

## §4 DEVIATION 清单（若有）

（待填）

## §5 遗留与观察项

（待填）

## §6 同类面排查表（preload 无参 invoke × main 对象守卫）

（待填：`channel | preload 形态 | main 守卫要求 | 判定（修/不需修+理由）`——已知 portable preview 一行修先例）