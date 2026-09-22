# assets/brand —— Septcats 品牌资产（3D 像素浮雕布偶猫）

> 口径来源：老板 2026-09-21「重新设计图标：3D像素画风，布偶猫图像，正方形圆角，白底，黑白灰图案。」
> 覆盖旧「单线描猫 + 琥珀铃铛」决议（`docs/PROJECT_PLAN.md` §17 已改写）。
> 本目录是**设计资产真源**：只由下面的脚本生成/覆盖，禁止手改 SVG 与 `dist/png/**`。

***

## 0. 老板三选一决策区

| 变体 | 构图 | 判读 | 当前状态 |
| :-- | :-- | :-- | :-- |
| **A** | 侧坐全身（尾巴左绕，姿态感） | 全身叙事完整，小尺寸脚/尾易粘连 | 保留待选 |
| **B** | 正面大头（小尺寸最稳） | 16–32px 最稳，缺身体叙事 | 保留待选 |
| **C** | 正面坐姿 + 环绕尾 | **8/10 一眼布偶猫**（PM 判读定论） | ✅ **默认已接线**（应用图标 `icon.png` = C-256；`icon.ico` 的 48/256 层 = C） |
| **T** | 16×16 原生简化子型（双尖耳 + 面罩大眼 + 圆头） | 16px **语义 + 硬边双证合格**（1 格 = 1 物理像素） | ✅ **默认已接线**（托盘 `icon-tray.png` = T-16、`icon-tray@2x.png` = T-32；`.ico` 的 16/24/32 层 = T） |

- **换型一行命令**（老板改选 A 或 B 时，把 `C` 换成 `A`/`B` 即可；托盘 T 子型不动）：

  ```bash
  sed -i 's/3dpix-C/3dpix-A/g' scripts/build-pixel-ico.mjs && node scripts/generate-pixel-icons.mjs && node scripts/build-pixel-ico.mjs
  ```

  等价操作：手改 `scripts/build-pixel-ico.mjs` 的 `LAYERS` 里两处 `septcats-3dpix-C.svg` → 目标变体，再跑后两条 node 命令。改完 `apps/desktop/build/` 四份产物即换新，**无需改产品代码**（接线在 `apps/desktop/src/main/iconAssets.ts`，只认文件名不认变体名）。

***

## 1. 生成命令（全链两条，纯 stdlib 零依赖零网络）

```bash
# ① 出 SVG + 全套原生直画 PNG（A/B/C: 16/32/48/256；T: 16/24/32）
node scripts/generate-pixel-icons.mjs

# ② 组 Windows .ico + 装包用 PNG（五层，PNG 表项）
node scripts/build-pixel-ico.mjs
```

产物落点：

| 产物 | 来源 | 消费方 |
| :-- | :-- | :-- |
| `assets/brand/septcats-3dpix-{A,B,C,T}.svg` | ①（`scripts/gen-icon-3dpix.mjs`） | 设计稿/文档/二次渲染 |
| `assets/brand/dist/png/septcats-3dpix-<变体>-<尺寸>.png` | ①（`scripts/pixel-png.mjs` 原生直画） | ② 的输入 + 评审素材 |
| `apps/desktop/build/icon.ico` | ② 五层：**T16/T24/T32 + C48/C256**（全 PNG 表项） | 安装器/可执行文件图标 |
| `apps/desktop/build/icon.png` | ②（= C-256） | `BrowserWindow.icon`（任务栏 / Alt-Tab） |
| `apps/desktop/build/icon-tray.png` | ②（= T-16） | 系统托盘 |
| `apps/desktop/build/icon-tray@2x.png` | ②（= T-32） | 托盘高 DPI |

生成器细节：`gen-icon-3dpix.mjs` 出 28×28 正面像素语法（基元重叠绘制 + 右下 1 格挤出浮雕 + 每格上/左亮 bevel、下/右暗 bevel）；`pixel-png.mjs` 是 SVG → 任意分辨率的**原生直画**渲染核心（零超采样、零重采样）。

***

## 2. 质检断言（生成器内建，不过即退出码非 0）

**A/B/C 变体（28×28 网格，`gen-icon-3dpix.mjs`）**

1. **连通性 = 1 个 4-连通体**（`连通块=1`）——耳/尾/脚不得悬空成碎块；不达标时脚本会打印每个小连通体的格坐标；
2. **不触边**：包围盒须落在 `x∈[1, 26] / y∈[1, 26]`（四周各留 1 格安全区）；
3. **零彩色**：灰阶调色板全部满足 `R = G = B`（纯灰，与 T53-01 黑白灰口径同谱）。

**T 托盘子型（16×16，`flat` 路径）**

4. 直角满幅（**不切圆角**：16px 上圆角光栅化会引入 AA 半透明边 = 糊）；
5. 同样走上面的连通性 + 不触边断言。

**PNG 渲染（硬边铁律的机器证据）**

6. **全档半透明 = 0**：任意尺寸下 alpha 只有 0（背景）与 255（实心），无中间值；
7. **全纯灰**：所有非透明像素 `R = G = B`。

   6/7 两条为 PM 亲验 + T55-02 工程师独立解码复算（24 份产物：`build/` 三份 PNG + `.ico` 五层 + `dist/png/**` 十六档）——alpha 档实测只有 `{0,255}`（T 子型因直角满幅更只有 `{255}`），带彩像素 **0**。

**装包产物（机器复现断言，`apps/desktop/test/t55-icons.test.ts`）**

8. `icon.ico` 回读：**层数 = 5**、尺寸序列 = `[16, 24, 32, 48, 256]`、每层为 PNG 表项（8 字节签名 + IHDR 宽 = 目录声明宽）、层数据首尾相接不越界；
9. 逐字节同源：`.ico` 的 16 层 = `icon-tray.png`、32 层 = `icon-tray@2x.png`、256 层 = `icon.png`。

***

## 3. 接线点（产品代码只认文件名，不认变体）

| 位置 | 作用 |
| :-- | :-- |
| `apps/desktop/src/main/iconAssets.ts` | 纯函数查找序列：文件名优先于基目录（`icon-tray.png` 三处探完才轮到 `icon.ico`） |
| `apps/desktop/src/main/tray.ts` | `resolveTrayIconPath()`：`<resources>/build` → `appPath/build` → `out/main/../../build` |
| `apps/desktop/src/main/index.ts` | `resolveWindowIconPath()`：同序列取 `icon.png` → `BrowserWindow.icon` |
| `apps/desktop/electron-builder.yml` | `extraResources`：把四份图标复制到 `<resources>/build/`（`buildResources` 本身不进包） |

真机取证：`node docs/mockups/cdp-e2e-t55-02.mjs`（断言托盘解析命中 `icon-tray.png` + 文件存在、窗口标题、任务栏/托盘区窗口级截图）。
