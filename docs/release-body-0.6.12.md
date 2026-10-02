# Septcats 0.6.12 —— 多维表格·删除视图（挂账收口）

0.6.11 之后的单点收口：视图条上的「删除视图」不再是灰掉的占位按钮，而是接了真实通道的可用操作。全部本地完成、零外部请求；安装包逐字节审过。

## 新增
- **删除视图**：视图条点「删除视图」即可移除当前视图。删除不可撤销，所以做了防误触三件套——
  1. 首次点击只是「上膛」，按钮文案变成「确认删除 · 〈视图名〉」并出现一行引导（说明再点才生效、移开焦点可取消）；
  2. 失焦或切换视图 = 自动解除上膛（绝不会发生"写着删 A、实际删了 B"）；
  3. 二次点击才真正删除。
- **护栏**：一张表至少保留一个视图。只剩最后一个时按钮禁用并说明原因（鼠标悬停可见）。删除后列表重载不闪断（软刷新），重启后顺序保持。

## 数据兼容
- 操作段格式版本与 0.6.9–0.6.11 **相同（v3）**，直接升级，无需中间版本。
- 数据仍全部留在你自己机器上。

## 下载
- `Septcats Setup 0.6.12.exe`（102,750,155 字节）
- 自动更新 feed：`https://github.com/nathanjngogo/septcats-releases/releases/download/latest/latest.yml(.sig)`

## 关于签名（诚实说明）
本安装包未购买商业代码签名证书，因此 Windows SmartScreen 可能提示「未知发布者」。这是客观限制而非缺陷：更新包用 **Ed25519 自签**，应用内以硬编码公钥验签后才安装，篡改或缺签一律拒绝。若需手动安装并被拦截：点击「更多信息」→「仍要展开」。

---

# Septcats 0.6.12 — Multi-table: delete view (closing the last stub)

A single follow-up after 0.6.11: the "Delete view" button on the view bar is no longer a greyed-out placeholder — it now runs through the real channel. Fully local, zero external requests; installer verified byte-for-byte.

## New
- **Delete view**: tap "Delete view" on the view bar to remove the current view. Deletion is irreversible, so there are three guardrails against accidental taps —
  1. The first click only "arms" the button: its label becomes "Confirm delete · ⟨view name⟩" and a hint line appears (click again to delete, blur to cancel);
  2. Blurring or switching views automatically disarms it ("labeled A but deleting B" cannot happen);
  3. Only the second click deletes.
- **Invariant**: every table keeps at least one view. With a single view left, the button is disabled and explains why (hover to see). Removing a view refreshes the list without flashing (soft refresh), and the state survives restarts.

## Compatibility
- Op segment format is **v3, identical to 0.6.9–0.6.11** — direct upgrade, no intermediate step.

## Download
- `Septcats Setup 0.6.12.exe` (102,750,155 bytes)
- Update feed: `https://github.com/nathanjngogo/septcats-releases/releases/download/latest/latest.yml(.sig)`

## On signing
No commercial certificate, so SmartScreen may warn "unknown publisher". Updates are **Ed25519 self-signed** and verified against an embedded public key before install; tampered or unsigned payloads are refused. If blocked: "More info" → "Run anyway".
