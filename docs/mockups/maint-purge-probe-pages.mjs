/* maint-purge-probe-pages.mjs —— 真实库维护一次性脚本（老板 2026-09-24 授权）
 * @probe-realroot —— 维护脚本：按老板授权清理真实库探针页，走产品 remove/purge 通道（白名单双门闸）
 * 背景：T76~T79 探针漏钉 rootPath 夹具，测试页写进了真实数据根 C:\\Users\\Administrator\\.septcats。
 * 纪律：① 白名单逐 id + 标题模式二次校验，任一不符即中止；② 走产品自身通道 pages.remove→purge（op-log/FTS 一致）；
 *       ③ 备份已先行（_scratch/reallib-backup-*）；④ 删后树 + 只读库双复核；⑤ 只处理白名单，绝不触碰老板自有页。
 * 用法：node docs/mockups/maint-purge-probe-pages.mjs  （真实 UD + 真实根，刻意不钉夹具）*/
import { createRequire } from 'node:module';
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire('C:/Users/Administrator/.workbuddy/binaries/node/workspace/package.json');
const { chromium } = require('playwright-core');

const REPO = 'E:/Hermes Agent工作空间/Septcats';
const EXE = join(REPO, 'apps', 'desktop', 'dist', 'win-unpacked', 'Septcats.exe');
const SHOTS = join(REPO, 'docs', 'mockups', 'screens-maint');
const PORT = 9251;
const REAL_ROOT = 'C:\\Users\\Administrator\\.septcats';
const PROBE_TITLE = /^(T7|DBG|CELL|诊断|C4 诊断)/;

const WHITELIST = [
 {
  "id": "01M34P0VYP4PXZQTABRCQ45C2E",
  "title": "诊断页"
 },
 {
  "id": "01M38WZGBY2X8C0QS3V6CWWWG4",
  "title": "T76 表格页"
 },
 {
  "id": "01M38X128MPAVQA00X22EJAJNM",
  "title": "T76 表格页"
 },
 {
  "id": "01M38X32M2KV4EP1GV0WVD0278",
  "title": "T76 表格页"
 },
 {
  "id": "01M3971JYV0G3JBSNXPSMAJ4AZ",
  "title": "T77 代码页"
 },
 {
  "id": "01M3974EJFXMBGMHF6Z4SNVW3D",
  "title": "C4 诊断页"
 },
 {
  "id": "01M3975CQS4FD3QZMDJK0AQT04",
  "title": "C4 诊断页"
 },
 {
  "id": "01M3976JTDZAZ119JQN2BMRTTS",
  "title": "C4 诊断页"
 },
 {
  "id": "01M3978D6B03YCEAP4JGB5T8WH",
  "title": "T77 代码页"
 },
 {
  "id": "01M397ABDPCT6TW2ZQKXXMNJGD",
  "title": "T77 代码页"
 },
 {
  "id": "01M397Q0C9MZ8BDJ7CT7KNAP1R",
  "title": "T77 代码页"
 },
 {
  "id": "01M397QKFK9VPDKBM35860YJJ7",
  "title": "T77 图片页"
 },
 {
  "id": "01M397ZMN4CGVK0R8Q599JRADT",
  "title": "T77 代码页 muf9h33o"
 },
 {
  "id": "01M3980A34HBZY0CKYZWBJV3ZM",
  "title": "T77 代码页 muf9h33o 图"
 },
 {
  "id": "01M3981FZ5Z2G5EH8A2AQ6GK99",
  "title": "T77 代码页 muf9idyv"
 },
 {
  "id": "01M39825CCSENV4CNX6HK5J3B0",
  "title": "T77 代码页 muf9idyv 图"
 },
 {
  "id": "01M3987A3NDB8WDYH2Z1T1B922",
  "title": "T76 表格页"
 },
 {
  "id": "01M399TGX3XB8D7EAZWPKX569E",
  "title": "T78 多选页 mufamfrr"
 },
 {
  "id": "01M399Z95WB8BYTH08DBDPB3W1",
  "title": "T78 多选页 mufaps6v"
 },
 {
  "id": "01M39A2SSAB97RF6BT7DCCC7Z7",
  "title": "T78 多选页 mufas96v"
 },
 {
  "id": "01M39A5Z37T5N089QVWCPTTJ3Y",
  "title": "T78 多选页 mufauh7g"
 },
 {
  "id": "01M39ABQDR4SNGX6MW645AQXJE",
  "title": "T77 代码页 mufayivc"
 },
 {
  "id": "01M39ACCX0BVY3KJW9Z7XTW3HG",
  "title": "T77 代码页 mufayivc 图"
 },
 {
  "id": "01M39ACM3BER2D8EY8E84STY4C",
  "title": "T76 表格页"
 },
 {
  "id": "01M39EYMJ3MB4K5WNJFKSJXWW0",
  "title": "T79 导出页 mufdtpa4"
 },
 {
  "id": "01M39EZ2Y7ET3XY95C31MXSVCB",
  "title": "T79 子页 mufdtpa4"
 },
 {
  "id": "01M39F2KTN0ZXKTGCS0WP6N3PN",
  "title": "DBG2 dmufdwhwo"
 },
 {
  "id": "01M39F8AKG652D6YC02J046N3Z",
  "title": "DBG3 d3mufe0i9k"
 },
 {
  "id": "01M39FBDD1T5ZQ5HNH49EE7660",
  "title": "T79 导出页 mufe2ob1"
 },
 {
  "id": "01M39FBSAYBDCACY9T1CKCZJW4",
  "title": "T79 代码页 mufe2ob1"
 },
 {
  "id": "01M39FFKC8ZD2NKMFTS3RR42ZV",
  "title": "T79 导出页 mufe5m7d"
 },
 {
  "id": "01M39FG1Q7V62CYX9PGQ0PTXJJ",
  "title": "T79 代码页 mufe5m7d"
 },
 {
  "id": "01M39FGBHT7KX2EKK6T4D20XE0",
  "title": "T79 子页 mufe5m7d"
 },
 {
  "id": "01M39FTAJZP0E50FHEVX3HJ4PJ",
  "title": "CELL 定案页"
 }
];
const KEEP = [
 {
  "id": "01M2K4VKTXDFC65M29F3DB2491",
  "title": "双子星页"
 },
 {
  "id": "pg-01M2W0EVYX2EK06G3B813XQMJ4",
  "title": "双子星页"
 },
 {
  "id": "pg-01M2W5MX88AX5V9M0TKFQ5Y0BZ",
  "title": "双子星页"
 },
 {
  "id": "pg-01M2W8QKK22G1JQJ87DBTY74Y3",
  "title": "双子星页"
 },
 {
  "id": "01M2WKY16GY1CE46K9VVQ8BDT6",
  "title": "未命名"
 },
 {
  "id": "01M2WY0EA3Z4XMRAKB8GRJ3M7H",
  "title": "未命名"
 },
 {
  "id": "01M2WY0PP4PXRJE9K8J9JKCS5W",
  "title": "1212"
 },
 {
  "id": "pg-01M2X2ZE94EB1SG4PNH8WAKE6R",
  "title": "双子星页"
 },
 {
  "id": "01M3277M3XXK7RQWRBYWE9S0GN",
  "title": "请问请"
 },
 {
  "id": "01M397WWQQWR9W98GBPHXH2Y17",
  "title": "未命名"
 },
 {
  "id": "01M397X5F2DZ058RYJZ30ANYG3",
  "title": "未命名"
 },
 {
  "id": "01M397XFHEV4SAQ5DY4SJNNB0Z",
  "title": "未命名"
 },
 {
  "id": "01M397XYAD2WSYJN9KBY478MNC",
  "title": "未命名"
 },
 {
  "id": "01M397YXN2T2E3QZR4NRTW93H2",
  "title": "未命名"
 }
];

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function killTree(pid) { try { execSync(`taskkill /PID ${String(pid)} /T /F`, { stdio: 'ignore' }); } catch { /* gone */ } }
function septcatsProcs() {
  try {
    const out = execSync('tasklist /FI "IMAGENAME eq Septcats.exe" /NH', { encoding: 'utf8' });
    return (out.match(/Septcats\.exe/g) ?? []).length;
  } catch { return 0; }
}

async function launch() {
  const child = spawn(EXE, [`--remote-debugging-port=${String(PORT)}`], { detached: false, stdio: 'ignore' });
  let browser = null;
  for (let i = 0; i < 40; i += 1) {
    await wait(800);
    try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${String(PORT)}`); break; } catch { /* retry */ }
  }
  if (browser === null) throw new Error('CDP 连不上（打包 exe 未起）');
  const ctx = browser.contexts()[0];
  let page = null;
  for (let i = 0; i < 40 && page === null; i += 1) {
    for (const cand of ctx.pages()) {
      try {
        const ok = await cand.evaluate(() => typeof window.septcats !== 'undefined' && typeof window.septcats.pages !== 'undefined');
        if (ok === true) { page = cand; break; }
      } catch { /* 页面还在加载 */ }
    }
    if (page === null) await wait(700);
  }
  if (page === null) throw new Error('未找到挂载 window.septcats 的渲染页');
  return { child, browser, page };
}

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  const report = { startedAt: new Date().toISOString(), realRoot: REAL_ROOT, whitelist: WHITELIST.length, removed: [], purged: [], errors: [], verified: null };

  // G0：启动前不得有在跑的 Septcats（单实例锁会让本次启动静默退出）
  const before = septcatsProcs();
  if (before > 0) { console.log(`ABORT 启动前发现 ${String(before)} 个 Septcats 进程——请先关闭应用`); process.exitCode = 2; return; }
  console.log('G0 PASS 启动前无 Septcats 进程');

  const { child, browser, page } = await launch();
  try {
    await page.waitForLoadState('domcontentloaded');
    await wait(2500);

    // G1：定位真实库（白名单页必须都在，且标题命中探针模式）
    const ws = await page.evaluate(async () => await window.septcats.workspaces.list());
    const activeId = ws.activeId ?? (ws.items[0] && ws.items[0].id);
    if (activeId == null) throw new Error('无活动工作区');
    const tree = await page.evaluate(async (w) => await window.septcats.pages.tree({ workspaceId: w }), activeId);
    const alive = tree.filter((n) => n.alive === 1);
    const byId = new Map(alive.map((n) => [n.id, n.title ?? '']));
    const missing = WHITELIST.filter((w) => !byId.has(w.id));
    const badTitle = WHITELIST.filter((w) => byId.has(w.id) && !PROBE_TITLE.test(byId.get(w.id)));
    const keepAlive = KEEP.filter((k) => byId.has(k.id)).length;
    console.log(`G1 alive=${String(alive.length)} 白名单命中=${String(WHITELIST.length - missing.length)}/${String(WHITELIST.length)} 缺=${String(missing.length)} 标题不符=${String(badTitle.length)} 保留页命中=${String(keepAlive)}/${String(KEEP.length)}`);
    report.gate = {
      aliveBefore: alive.length,
      whitelistHit: WHITELIST.length - missing.length,
      missing: missing.map((m) => m.id),
      badTitle: badTitle.map((b) => ({ id: b.id, title: byId.get(b.id) })),
      keepHit: keepAlive,
      sampleTitles: alive.slice(0, 6).map((n) => `${String(n.title)}(alive=${String(n.alive)})`),
    };
    writeFileSync(join(SHOTS, 'purge-results.json'), JSON.stringify(report, null, 1), 'utf8');
    if (missing.length > 0 || badTitle.length > 0) {
      console.log(`ABORT 白名单校验不过——零删除。缺=${String(missing.length)} 标题不符=${String(badTitle.length)} 现场alive=${String(alive.length)} 样例=${JSON.stringify(report.gate.sampleTitles)}`);
      process.exitCode = 3;
      return;
    }
    console.log('G1 PASS 真实库白名单校验通过，进入删除');

    // 删除：白名单逐个 remove→purge（产品通道；cascade 会先带走子页，失败一律记录不中断）
    for (const w of WHITELIST) {
      try {
        const r = await page.evaluate(async (id) => await window.septcats.pages.remove({ id }), w.id);
        report.removed.push({ id: w.id, title: w.title, deleted: r && r.deleted });
      } catch (e) { report.errors.push({ id: w.id, op: 'remove', msg: String(e && e.message ? e.message : e).slice(0, 160) }); }
      try {
        const r2 = await page.evaluate(async (id) => await window.septcats.pages.purge({ id }), w.id);
        report.purged.push({ id: w.id, purged: r2 && r2.purged });
      } catch (e) { report.errors.push({ id: w.id, op: 'purge', msg: String(e && e.message ? e.message : e).slice(0, 160) }); }
      await wait(120);
    }
    console.log(`删除完成 removed=${String(report.removed.length)} purged=${String(report.purged.length)} errors=${String(report.errors.length)}`);

    // 复核（树面）：白名单不得再有 alive 节点；保留页必须全在
    const tree2 = await page.evaluate(async (w) => await window.septcats.pages.tree({ workspaceId: w }), activeId);
    const alive2 = tree2.filter((n) => n.alive === 1);
    const wlSet = new Set(WHITELIST.map((w) => w.id));
    const leftover = alive2.filter((n) => wlSet.has(n.id));
    const keep2 = KEEP.filter((k) => alive2.some((n) => n.id === k.id));
    report.verified = { aliveAfter: alive2.length, leftover: leftover.length, keepPresent: keep2.length, keepExpected: KEEP.length };
    console.log(`复核 alive=${String(alive2.length)} 残留白名单=${String(leftover.length)} 保留页在场=${String(keep2.length)}/${String(KEEP.length)}`);

    await page.evaluate(() => window.close());
    await wait(2500);
  } finally {
    try { await browser.close(); } catch { /* noop */ }
    killTree(child.pid);
    await wait(1200);
  }
  writeFileSync(join(SHOTS, 'purge-results.json'), JSON.stringify(report, null, 1), 'utf8');
  const ok = (report.verified && report.verified.leftover === 0 && report.verified.keepPresent === report.verified.keepExpected);
  console.log(`RESULT ${ok ? 'OK' : 'CHECK'} 残留=${String(report.verified && report.verified.leftover)} 保留=${String(report.verified && report.verified.keepPresent)} 错误=${String(report.errors.length)}`);
  process.exitCode = ok ? 0 : 1;
}

main().catch((e) => { console.log('FATAL', String(e && e.message ? e.message : e)); process.exitCode = 1; });
