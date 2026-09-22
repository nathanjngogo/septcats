/*
 * gen-icon-3dpix.mjs —— Septcats 品牌图标：3D 像素（挤出浮雕）布偶猫，白底圆角·黑白灰。
 *
 * 老板 2026-09-21 指令：「重新设计图标：3D像素画风，布偶猫图像，正方形圆角，白底，黑白灰图案。」
 * 覆盖旧「单线描猫+铃铛」决议（§17）。
 *
 * 语法（v2；v1=gen-icon-pixel.mjs 的 iso 体素堆叠被视觉判读否决：耳悬空/尾脱节/碎块）：
 *   正面 28×28 像素画（基元重叠绘制 → 连通性由构造保证 + BFS 质检断言兜底），
 *   整块 silhouette 右下 +1 格挤出统一中灰厚度（3D 硬币浮雕感），
 *   每格上/左缘亮 bevel、下/右缘暗 bevel（2px），灰阶全部纯灰（零彩色）。
 *   布偶猫特征用明度差：重点色深灰（耳/面罩/尾）、身体浅灰、胸毛/袜白、眼黑带白高光。
 *
 * 用法：node scripts/gen-icon-3dpix.mjs [A|B|C|all]   （缺省 all → assets/brand/septcats-3dpix-<v>.svg）
 * 渲染 PNG：node scripts/render-svg-png.mjs assets/brand/septcats-3dpix-*.svg --out assets/brand/png --sizes 16,48,256
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const repoDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const brandDir = join(repoDir, 'assets', 'brand');

const N = 28;            // 网格边长（格）
const EXT = 1;           // 挤出厚度（格，右下方向）

/* 灰阶调色板（全部 R=G=B 纯灰，T53 灰阶谱内取档） */
const INK = {
  B: { base: '#B9B9B9', hi: '#EDEDED', lo: '#7E7E7E' }, // 身体中浅灰（对白底有轮廓对比）
  W: { base: '#FFFFFF', hi: '#FFFFFF', lo: '#BFBFBF' }, // 胸毛/口鼻/白袜
  D: { base: '#454545', hi: '#666666', lo: '#1F1F1F' }, // 重点色（耳/面罩/尾）
  K: { base: '#141414', hi: '#141414', lo: '#141414' }, // 眼/鼻（平涂）
  H: { base: '#FFFFFF', hi: '#FFFFFF', lo: '#FFFFFF' }, // 眼高光（平涂）
};
const SHADOW = '#6E6E6E'; // 统一挤出厚度色（深=白底强轮廓）

const PRIO = { '.': 0, B: 1, W: 1, D: 2, K: 4, H: 5 };

function empty() {
  return Array.from({ length: N }, () => Array(N).fill('.'));
}
function put(g, x0, y0, c) {
  const x = Math.round(x0); const y = Math.round(y0);
  if (x < 0 || x >= g[0].length || y < 0 || y >= g.length) return;
  const prev = g[y][x];
  if (PRIO[c] >= PRIO[prev]) g[y][x] = c;
}
/** 强制写入（无视优先级）：用于「开脸白梁压面罩」这类前景细节 */
function force(g, x, y, c) {
  const xi = Math.round(x); const yi = Math.round(y);
  if (xi < 0 || xi >= g[0].length || yi < 0 || yi >= g.length) return;
  g[yi][xi] = c;
}
function disc(g, cx, cy, rx, ry, c) {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1.02) put(g, x, y, c);
    }
  }
}
function chain(g, pts, c) {
  for (const [x, y] of pts) put(g, x, y, c);
}
/** 折线：对角步补角格，保证 4-连通（尾巴/曲线笔画用） */
function path4(g, pts, c) {
  for (let i = 0; i < pts.length; i++) {
    put(g, pts[i][0], pts[i][1], c);
    if (i + 1 < pts.length) {
      const [x0, y0] = pts[i];
      const [x1, y1] = pts[i + 1];
      if (x0 !== x1 && y0 !== y1) put(g, x1, y0, c); // 补直角
    }
  }
}
/** 2 格粗尾巴：中心线 path4 + 厚度偏移（起点必须埋进身体） */
function tail(g, pts, tdx, tdy) {
  path4(g, pts, 'D');
  path4(g, pts.map(([x, y]) => [x + tdx, y + tdy]), 'D');
}
/** 前景折线（force 写入，压过一切底色/袜/身——尾巴这种「在身前」的笔画专用） */
function strokeF(g, pts, c) {
  for (let i = 0; i < pts.length; i++) {
    force(g, pts[i][0], pts[i][1], c);
    if (i + 1 < pts.length) {
      const [x0, y0] = pts[i]; const [x1, y1] = pts[i + 1];
      if (x0 !== x1 && y0 !== y1) force(g, x1, y0, c); // 对角补角=4-连通
    }
  }
}

/* ---------- 变体 C（默认接线版）：正面坐姿 + 环绕尾 ---------- */
function buildC() {
  const g = empty();
  // 身体（梨形：下宽；底缘收在 y≈22，脚下留给尾巴，不渗浅色碎点）
  disc(g, 14, 18.4, 6.5, 4.0, 'B');
  disc(g, 14, 15.2, 5.0, 3.2, 'B');
  // 头
  disc(g, 14, 10, 7.5, 6.5, 'B');
  // 耳（深三角，底边埋进头顶 y5-7 重叠）
  chain(g, [[8, 2], [7, 3], [8, 3], [9, 3], [7, 4], [8, 4], [9, 4], [10, 4], [7, 5], [8, 5], [9, 5], [10, 5], [8, 6], [9, 6], [10, 6], [11, 6], [10, 7], [11, 7],
    [19, 2], [18, 3], [19, 3], [20, 3], [17, 4], [18, 4], [19, 4], [20, 4], [17, 5], [18, 5], [19, 5], [20, 5], [16, 6], [17, 6], [18, 6], [19, 6], [16, 7], [17, 7]], 'D');
  // 布偶面罩：对称双 D 斑（眼周），鼻梁/额头自然留 B——v5 实证判读无瑕疵的画法
  disc(g, 10.5, 9.5, 2.6, 2.3, 'D');
  disc(g, 17.5, 9.5, 2.6, 2.3, 'D');
  // 口鼻白区 + 鼻（K）
  disc(g, 14, 12.9, 2.2, 1.5, 'W');
  chain(g, [[13, 12], [14, 12], [15, 12], [14, 13]], 'K');
  // 大眼（K 2×2 嵌 D 斑内 + 单格白高光）
  chain(g, [[10, 9], [11, 9], [10, 10], [11, 10], [17, 9], [18, 9], [17, 10], [18, 10]], 'K');
  put(g, 11, 9, 'H');
  put(g, 17, 9, 'H');
  // 胸白毛（领圈，下缘锯齿=蓬松）
  disc(g, 14, 16.8, 3.2, 2.4, 'W');
  put(g, 12, 19, 'W'); put(g, 14, 19, 'W'); put(g, 16, 19, 'W');
  // 白袜（前脚两团，y20-21）
  chain(g, [[10, 20], [11, 20], [12, 20], [10, 21], [11, 21], [12, 21],
    [15, 20], [16, 20], [17, 20], [15, 21], [16, 21], [17, 21]], 'W');
  // 左侧立尾（决定版）：尾巴在「受光侧」独立探出——右下的 3D 挤出与它零粘连，踏板歧义根除。
  // 根部埋进身体左缘 (8,16)，尾梢沿左弧下垂、在左脚旁向右收拢；2 格粗
  tail(g, [[8, 16], [7, 17], [6, 18], [5, 19], [4, 20], [4, 21], [5, 22], [7, 23], [9, 23], [11, 23]], 0, 1);
  return g;
}

/* ---------- 变体 B：正面大头（小尺寸最稳） ---------- */
function buildB() {
  const g = empty();
  disc(g, 14, 15, 9.5, 8.5, 'B'); // 大头
  chain(g, [[8, 3], [7, 4], [8, 4], [9, 4], [6, 5], [7, 5], [8, 5], [9, 5], [10, 5], [6, 6], [7, 6], [8, 6], [9, 6], [10, 6], [6, 7], [7, 7], [8, 7], [9, 7], [10, 7],
    [19, 3], [18, 4], [19, 4], [20, 4], [17, 5], [18, 5], [19, 5], [20, 5], [21, 5], [17, 6], [18, 6], [19, 6], [20, 6], [21, 6], [17, 7], [18, 7], [19, 7], [20, 7], [21, 7]], 'D'); // 耳
  disc(g, 9.5, 14.5, 3.2, 2.8, 'D'); // 面罩左
  disc(g, 18.5, 14.5, 3.2, 2.8, 'D'); // 面罩右
  disc(g, 14, 19, 2.6, 1.9, 'W'); // 口鼻
  disc(g, 14, 23.5, 5.0, 2.4, 'W'); // 胸毛（底）
  chain(g, [[13, 18], [14, 18], [15, 18], [14, 19]], 'K'); // 鼻
  chain(g, [[8, 14], [9, 14], [8, 15], [9, 15], [10, 15], [8, 16], [9, 16], [10, 16],
    [17, 14], [18, 14], [17, 15], [18, 15], [19, 15], [17, 16], [18, 16], [19, 16]], 'K'); // 大眼
  put(g, 9, 15, 'H');
  put(g, 18, 15, 'H');
  return g;
}

/* ---------- 变体 A：侧坐全身（尾巴左绕，姿态感） ---------- */
function buildA() {
  const g = empty();
  tail(g, [[12, 22], [10, 23], [8, 24], [7, 25], [8, 26], [10, 26], [12, 26]], 0, -1); // 尾（粗，左绕；起点埋身体）
  disc(g, 14, 20.5, 6.2, 5.0, 'B'); // 身体
  disc(g, 14, 16, 4.6, 3.4, 'B');
  disc(g, 14, 9.5, 6.8, 6.0, 'B'); // 头
  chain(g, [[9, 2], [8, 3], [9, 3], [10, 3], [8, 4], [9, 4], [10, 4], [11, 4], [8, 5], [9, 5], [10, 5], [11, 5], [9, 6], [10, 6], [11, 6],
    [19, 2], [18, 3], [19, 3], [20, 3], [17, 4], [18, 4], [19, 4], [20, 4], [17, 5], [18, 5], [19, 5], [20, 5], [17, 6], [18, 6], [19, 6]], 'D'); // 耳
  disc(g, 14, 15.8, 3.0, 2.4, 'W'); // 胸
  disc(g, 11, 9, 2.4, 2.1, 'D'); // 面罩
  disc(g, 17, 9, 2.4, 2.1, 'D');
  disc(g, 14, 11.8, 1.9, 1.4, 'W');
  chain(g, [[13, 11], [14, 11], [15, 11], [14, 12]], 'K'); // 鼻
  chain(g, [[10, 8], [11, 8], [10, 9], [11, 9], [16, 8], [17, 8], [16, 9], [17, 9]], 'K');
  put(g, 11, 8, 'H');
  put(g, 16, 8, 'H');
  chain(g, [[12, 24], [13, 24], [14, 24], [12, 25], [13, 25], [14, 25],
    [16, 24], [17, 24], [16, 25], [17, 25]], 'W'); // 白袜
  return g;
}

/* ---------- 质检：连通性（碎块必须=1 个连通体）+ 安全区 ---------- */
function components(g) {
  const N = g.length;
  const seen = Array.from({ length: N }, () => Array(N).fill(false));
  const sizes = [];
  const cells = [];
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      if (g[y][x] !== '.' && !seen[y][x]) {
        const comp = [];
        const q = [[x, y]];
        seen[y][x] = true;
        while (q.length) {
          const [cx, cy] = q.pop();
          comp.push([cx, cy]);
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = cx + dx; const ny = cy + dy;
            if (nx >= 0 && nx < N && ny >= 0 && ny < N && !seen[ny][nx] && g[ny][nx] !== '.') {
              seen[ny][nx] = true;
              q.push([nx, ny]);
            }
          }
        }
        sizes.push(comp.length);
        cells.push(comp.map(([px, py]) => ({ c: g[py][px], x: px, y: py })));
      }
    }
  }
  return { count: sizes.length, sizes, cells };
}

function bbox(g) {
  const N = g.length;
  let minX = N, maxX = -1, minY = N, maxY = -1;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      if (g[y][x] !== '.') {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  return { minX, maxX, minY, maxY };
}

/** 缝合：把每个碎块沿折线（先横后竖）以同色补画到最大连通体，直到全图 1 个连通体。
 *  用途：曲线尾巴等笔画若与主体脱节，自动补一段「搭桥」（视觉=尾巴贴住身体，自然）。 */
function stitch(g) {
  const N = g.length;
  for (let iter = 0; iter < 8; iter++) {
    const { count, sizes, cells } = components(g);
    if (count <= 1) return;
    const order = sizes.map((n, i) => [i, n]).sort((a, b) => b[1] - a[1]);
    const mainIdx = order[0][0];
    const main = new Set(cells[mainIdx].map((o) => `${o.x},${o.y}`));
    // 取一个碎块
    const fragIdx = order[1][0];
    const frag = cells[fragIdx];
    const [f] = frag;
    // 最近主体格（曼哈顿）
    let best = null, bd = 1e9;
    for (const key of main) {
      const [mx, my] = key.split(',').map(Number);
      const d = Math.abs(mx - f.x) + Math.abs(my - f.y);
      if (d < bd) { bd = d; best = [mx, my]; }
    }
    if (!best || bd <= 1) { // 异常：距离>1 却 4-不连通不应发生——强制走一步
      best = best ?? [f.x + 1, f.y];
    }
    // 折线搭桥（先横后竖），跳过已是主体的格
    let x = f.x, y = f.y;
    while (x !== best[0]) { x += Math.sign(best[0] - x); if (!main.has(`${x},${y}`)) put(g, x, y, f.c); }
    while (y !== best[1]) { y += Math.sign(best[1] - y); if (!main.has(`${x},${y}`)) put(g, x, y, f.c); }
    if (!main.has(`${x},${y}`)) put(g, x, y, f.c);
  }
}

/* ---------- SVG 渲染（挤出厚度 + bevel；opts.flat=16px 托盘简化子型：无挤出无 bevel） ---------- */
function toSvg(g, opts = {}) {
  const n = opts.n ?? N;
  const cell = opts.cell ?? 8;          // 主图 28 格×8=224；tray 16 格×16=256（1:1 像素级）
  const ext = opts.flat ? 0 : EXT;
  const total = (n + ext) * cell;
  const ox = Math.floor((256 - total) / 2);
  const oy = Math.floor((256 - total) / 2);
  const px = (x) => ox + x * cell;
  const py = (y) => oy + y * cell;
  const at = (x, y) => (x >= 0 && x < n && y >= 0 && y < n ? g[y][x] : '.');
  const rects = [];

  // ① 挤出厚度层（L 形；flat 版跳过）
  if (!opts.flat) {
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        if (at(x, y) === '.') continue;
        if (at(x + 1, y) === '.') rects.push(`<rect x="${px(x + EXT)}" y="${py(y)}" width="${cell}" height="${cell + EXT * cell}" fill="${SHADOW}" />`);
        if (at(x, y + 1) === '.') rects.push(`<rect x="${px(x)}" y="${py(y + EXT)}" width="${cell}" height="${cell}" fill="${SHADOW}" />`);
        if (at(x + 1, y) === '.' && at(x, y + 1) === '.' && at(x + 1, y + 1) === '.') rects.push(`<rect x="${px(x + EXT)}" y="${py(y + EXT)}" width="${cell}" height="${cell}" fill="${SHADOW}" />`);
      }
    }
  }
  // ② 主像素 + bevel（flat 版只铺底色）
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const c = at(x, y);
      if (c === '.') continue;
      const ink = INK[c];
      const X = px(x); const Y = py(y);
      rects.push(`<rect x="${X}" y="${Y}" width="${cell}" height="${cell}" fill="${ink.base}" />`);
      if (opts.flat || c === 'K' || c === 'H') continue; // 平涂件不加 bevel
      const bw = 2;
      if (at(x, y - 1) === '.') rects.push(`<rect x="${X}" y="${Y}" width="${cell}" height="${bw}" fill="${ink.hi}" />`);
      if (at(x - 1, y) === '.') rects.push(`<rect x="${X}" y="${Y}" width="${bw}" height="${cell}" fill="${ink.hi}" />`);
      if (at(x, y + 1) === '.') rects.push(`<rect x="${X}" y="${Y + cell - bw}" width="${cell}" height="${bw}" fill="${ink.lo}" />`);
      if (at(x + 1, y) === '.') rects.push(`<rect x="${X + cell - bw}" y="${Y}" width="${bw}" height="${cell}" fill="${ink.lo}" />`);
    }
  }

  const rx = opts.flat ? 0 : 48; // 托盘 16px：直角满幅（圆角在 16px 光栅化会引入 AA 半透明边=「糊」）
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256" shape-rendering="crispEdges" role="img" aria-label="Septcats 3D 像素布偶猫图标">`,
    `  <rect width="256" height="256" rx="${rx}" fill="#FFFFFF" />`,
    ...rects.map((r) => `  ${r}`),
    `</svg>`,
  ].join('\n');
}

/* ---------- 16×16 原生托盘简化子型（1 网格=1 物理像素，零重采样不糊） ---------- */
const TN = 16;
function buildTray() {
  // 手写 16×16：只保「双尖耳 + 面罩大眼 + 圆头」——判读结论里 16px 能站住的三指纹。
  // 尾/脚/胸在 16px 会粘连，按任务书允许（§1.3 附 16px 简化子型）舍弃。
  // 判读修正（原生 16 网格）：耳根与面罩隔 1 行浅灰、眼=K 底+H 瞳、鼻 1 格（行宽精确 16 字符）
  const rows = [
    '................',
    '...D......D.....',
    '..DDD....DDD....',
    '..BBB....BBB....', // 耳根浅灰行：与面罩分离
    '.BBBBBBBBBBB....',
    '.BBHKBBBBHKBB...', // 眼行 1：H 白瞳 + K 眼
    '.BBKKBBBBKKBB...', // 眼行 2：K 眼
    '..BDDWWWWDDBB...', // 面罩内缘 + 白口鼻
    '...BBWKKWBBB....', // 鼻 K（嵌白区）
    '....BWWWWB......',
    '.....BBBB.......',
    '................',
    '................',
    '................',
    '................',
    '................',
  ];
  return rows.map((r) => [...r, ...Array(16 - r.length).fill('.')]);
}

/* ---------- main ---------- */
const BUILDERS = { A: buildA, B: buildB, C: buildC };
const want = process.argv[2] && process.argv[2] !== 'all' ? process.argv[2].toUpperCase() : 'ABC';
const variants = want === 'ABC' ? ['A', 'B', 'C'] : [want];

mkdirSync(brandDir, { recursive: true });
let bad = 0;
for (const v of variants) {
  const tray = v === 'T';
  const g = tray ? buildTray() : BUILDERS[v]();
  if (!tray) stitch(g);
  const comp = components(g);
  const bb = bbox(g);
  const total = g.flat().filter((c) => c !== '.').length;
  console.log(`\n===== 变体 ${v} =====`);
  for (const row of g) console.log(row.join('').replace(/\./g, '·'));
  console.log(`连通块=${comp.count} 尺寸=${comp.sizes.join(',')} 格数=${total} 包围盒 x[${bb.minX},${bb.maxX}] y[${bb.minY},${bb.maxY}]`);
  let vbad = 0;
  if (comp.count !== 1) {
    console.error(`✗ ${v}: 碎块 ${comp.count} 个（要求 1 个连通体）`);
    const order = comp.cells.map((c, i) => [i, c.length]).sort((a, b) => b[1] - a[1]);
    for (const [i] of order.slice(1)) console.error(`   小连通体: ${comp.cells[i].map((o) => `${o.c}(${o.x},${o.y})`).join(' ')}`);
    vbad++;
  }
  const GN = g.length;
  if (bb.minX < (tray ? 0 : 1) || bb.minY < (tray ? 0 : 1) || bb.maxX > GN - 2 || bb.maxY > GN - 2) { console.error(`✗ ${v}: 内容触边`); vbad++; }
  bad += vbad;
  if (!vbad) {
    const svg = tray ? toSvg(g, { n: TN, cell: 16, flat: true }) : toSvg(g);
    const file = join(brandDir, `septcats-3dpix-${v}.svg`);
    writeFileSync(file, svg);
    console.log(`→ ${file.replace(repoDir, '')}（${svg.length} B）`);
  }
}
process.exit(bad ? 1 : 0);
