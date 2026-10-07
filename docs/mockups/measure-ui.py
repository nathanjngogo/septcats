#!/usr/bin/env python3
"""measure-ui.py —— UI 截图度量工具（无第三方依赖：zlib 自解 PNG）。

用途：把「真实 Notion 截图」与「我们的界面截图」放同一把尺子上量——
  · 竖直分界线（侧栏宽 / 内容列左右缘 / 顶栏高）
  · 文本行墨迹剖面（字号→首行高/cap 高、行距、段间距）
  · 主色/底色/描边色取值（用于对齐 token）

用法：
  python3 measure-ui.py <png> [--scale N] [--band y0,y1] [--vlines] [--rows]

约定：坐标为**图像像素**；若截图是 2x（Retina）用 --scale 2 换算回 CSS px。
输出的"墨迹行"指该行上"非背景色像素"的计数，用它可读出文字块的上下缘与行距。
"""
import sys, zlib, struct
from collections import Counter


def read_png(path):
    data = open(path, 'rb').read()
    assert data[:8] == b'\x89PNG\r\n\x1a\n', '不是 PNG'
    pos, idat, w, h, depth, ctype = 8, b'', 0, 0, 0, 0
    while pos < len(data):
        ln = struct.unpack('>I', data[pos:pos + 4])[0]
        typ = data[pos + 4:pos + 8]
        chunk = data[pos + 8:pos + 8 + ln]
        if typ == b'IHDR':
            w, h, depth, ctype = struct.unpack('>IIBB', chunk[:10])
        elif typ == b'IDAT':
            idat += chunk
        elif typ == b'IEND':
            break
        pos += 12 + ln
    assert depth == 8 and ctype in (2, 6), f'仅支持 8bit RGB/RGBA（当前 depth={depth} ctype={ctype}）'
    ch = 3 if ctype == 2 else 4
    raw = zlib.decompress(idat)
    stride = w * ch
    out = bytearray(w * h * ch)
    prev = bytearray(stride)
    p = 0
    for y in range(h):
        f = raw[p]; p += 1
        line = bytearray(raw[p:p + stride]); p += stride
        if f == 1:
            for i in range(ch, stride):
                line[i] = (line[i] + line[i - ch]) & 255
        elif f == 2:
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 255
        elif f == 3:
            for i in range(stride):
                a = line[i - ch] if i >= ch else 0
                line[i] = (line[i] + ((a + prev[i]) >> 1)) & 255
        elif f == 4:
            for i in range(stride):
                a = line[i - ch] if i >= ch else 0
                b = prev[i]
                c = prev[i - ch] if i >= ch else 0
                pa, pb, pc = abs(b - c), abs(a - c), abs(a + b - 2 * c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[i] = (line[i] + pr) & 255
        out[y * stride:(y + 1) * stride] = line
        prev = line
    return w, h, ch, out


def px(buf, ch, w, x, y):
    i = (y * w + x) * ch
    return buf[i], buf[i + 1], buf[i + 2]


def bg_color(buf, ch, w, h):
    """背景 = 全图出现最多的颜色（UI 截图里通常就是画布底色）。"""
    c = Counter()
    for y in range(0, h, 3):
        for x in range(0, w, 3):
            c[px(buf, ch, w, x, y)] += 1
    return c.most_common(1)[0][0]


def ink_rows(buf, ch, w, h, bg, tol=28, band=None):
    """每行"墨迹像素"数（与背景色差异超 tol 即算墨迹）。"""
    y0, y1 = band if band else (0, h)
    rows = []
    for y in range(y0, y1):
        n = 0
        for x in range(w):
            r, g, b = px(buf, ch, w, x, y)
            if abs(r - bg[0]) + abs(g - bg[1]) + abs(b - bg[2]) > tol:
                n += 1
        rows.append(n)
    return rows


def vlines(buf, ch, w, h, bg, tol=18, min_run=0.5):
    """竖直分界线：整列"非背景"占比超 min_run 的 x（侧栏宽/内容列缘/顶栏分隔）。"""
    hits = []
    for x in range(w):
        n = 0
        for y in range(0, h, 2):
            r, g, b = px(buf, ch, w, x, y)
            if abs(r - bg[0]) + abs(g - bg[1]) + abs(b - bg[2]) > tol:
                n += 1
        if n / (h / 2) > min_run:
            hits.append(x)
    # 合并相邻列，取每段中心
    segs, cur = [], [hits[0]] if hits else []
    for x in hits[1:]:
        if x - cur[-1] <= 2:
            cur.append(x)
        else:
            segs.append((cur[0], cur[-1]))
            cur = [x]
    if cur:
        segs.append((cur[0], cur[-1]))
    return segs


def runs(rows, thr=1):
    """把墨迹行剖面压成"有墨/无墨"段（用于读文字块与行距）。"""
    segs, start = [], None
    for i, v in enumerate(rows):
        if v >= thr and start is None:
            start = i
        elif v < thr and start is not None:
            segs.append((start, i - 1))
            start = None
    if start is not None:
        segs.append((start, len(rows) - 1))
    return segs


def hscan(buf, ch, w, h, y, scale=1.0, tol=10):
    """沿第 y 行扫描，返回颜色突变点（x 像素 + 左右颜色）——量面板/侧栏/菜单边界的正解。"""
    edges = []
    prev = px(buf, ch, w, 0, y)
    for x in range(1, w):
        cur = px(buf, ch, w, x, y)
        if abs(cur[0] - prev[0]) + abs(cur[1] - prev[1]) + abs(cur[2] - prev[2]) > tol:
            edges.append((x, prev, cur))
        prev = cur
    merged = []
    for x, a, b in edges:
        if merged and x - merged[-1][0] <= 2:
            continue
        merged.append((x, a, b))
    return merged


def vscan(buf, ch, w, h, x, scale=1.0, tol=10):
    """沿第 x 列扫描，返回颜色突变点（y 像素）——量顶栏高/行高等。"""
    edges = []
    prev = px(buf, ch, w, x, 0)
    for y in range(1, h):
        cur = px(buf, ch, w, x, y)
        if abs(cur[0] - prev[0]) + abs(cur[1] - prev[1]) + abs(cur[2] - prev[2]) > tol:
            edges.append((y, prev, cur))
        prev = cur
    merged = []
    for y, a, b in edges:
        if merged and y - merged[-1][0] <= 2:
            continue
        merged.append((y, a, b))
    return merged


def main():
    path = sys.argv[1]
    scale = 1.0
    band = None
    args = sys.argv[2:]
    hscan_y = None
    vscan_x = None
    for i, a in enumerate(args):
        if a == '--scale':
            scale = float(args[i + 1])
        if a == '--band':
            y0, y1 = args[i + 1].split(',')
            band = (int(y0), int(y1))
        if a == '--hscan':
            hscan_y = int(float(args[i + 1]))
        if a == '--vscan':
            vscan_x = int(float(args[i + 1]))
    w, h, ch, buf = read_png(path)
    bg = bg_color(buf, ch, w, h)
    print(f'# {path}')
    print(f'尺寸: {w}x{h} 像素  (scale={scale} → 约 {round(w / scale)}x{round(h / scale)} CSS px)')
    print(f'背景众数色: rgb{bg}')
    seg = vlines(buf, ch, w, h, bg)
    if seg:
        print('竖直分界线 x（像素 / CSS px）:')
        for a, b in seg[:12]:
            print(f'   x={a}..{b}  → {round((a + b) / 2 / scale, 1)} CSS px')
    if hscan_y is not None:
        print(f'水平扫描 y={hscan_y}（像素）的色彩突变点 x：')
        for x, a, b in hscan(buf, ch, w, h, hscan_y):
            print(f'   x={x} ({round(x / scale, 1)} CSS px)  {a} → {b}')
    if vscan_x is not None:
        print(f'竖直扫描 x={vscan_x}（像素）的色彩突变点 y：')
        for y, a, b in vscan(buf, ch, w, h, vscan_x):
            print(f'   y={y} ({round(y / scale, 1)} CSS px)  {a} → {b}')
    rows = ink_rows(buf, ch, w, h, bg, band=band)
    rs = runs(rows)
    print(f'文字/元素行段（像素 y）：共 {len(rs)} 段，前 18 段：')
    for a, b in rs[:18]:
        print(f'   y={a}..{b}  高={b - a + 1}px → {round((b - a + 1) / scale, 1)} CSS px')
    # 行距：相邻段起点的差（同段内多行会被并成一段，故仅作参考）
    if len(rs) > 1:
        gaps = [rs[i + 1][0] - rs[i][0] for i in range(min(len(rs) - 1, 12))]
        print('相邻段起点间距（像素）:', gaps)


if __name__ == '__main__':
    main()