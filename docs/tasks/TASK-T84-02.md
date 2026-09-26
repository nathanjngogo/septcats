# TASK-T84-02 · 附件同步 files/ 面（**待老板拍板方案 A 后动工**）

> 前置：T84-01 ✅。方案 SSOT = `docs/PRD-T84-附件同步方案.md`（A：附件独立 files/ 内容寻址）。
> 老板 09-26 七条令之「3 先给方案」——方案已交，**动工需等老板对方案 A/只增不删两点拍板**。

## 范围（对应 PRD §5 拆单 T84-02~04）
1. **上行**：SyncRuntime 侧附件拷贝队列——本地 `attachments/<name>` 引用变化 →
   原子拷入 `<syncRoot>/files/<name>`（tmp+rename）；并发≤3；磁盘预检（余量>文件×1.2）；
   流式 pipe；失败退避（指数，上限 5min）；可暂停/取消。
2. **下行**：merger 应用块后 `attachment://` 本地缺失 → 从远端 `files/<hash>*` 拉取
   （扩展名变体 findHashFile 口径）→ sha256 复验（不符=隔离告警）→ 原子落 attachments/。
3. **进度面**：SyncStatusSnapshot 扩 `attachments:{pending,active,bytesDone,bytesTotal,failed}`；
   SyncStatus 面板 + 托盘状态行消费。
4. **加密**：files/ 内容走同一 DEK 信封（流式分块 AES-256-GCM，块头 IV+序号）；encrypt=false 明文。
5. **一期口径**：files/ 只增不删（网盘空间换简单；删除 GC 随 G6 决议）。

## 验收（PRD §4 题库 1~7）
双 runtime 图片逐字可见；102MB 大附件传输输入延迟不红；半截文件自愈；
双写同 hash 幂等；加密往返；暂停即停无残留；满盘挂起告警。真机探针 + 故障注入。

## 红线
- 账本/段格式零改动（附件不进 op payload）；
- 隐私默认不变（队列只在 syncEnabled 内跑）；
- T83-02 六路引用枚举复用，不另造第二套判定。
