// glass-combo-k.cjs —— T90-01 配方实验 K：产品链路仿真
// 构造时 alpha 底 + acrylic 材质常驻 + 实心 CSS；运行中只翻 CSS 透明链（材质全程不调 setBackgroundMaterial）。
// K1 = 8s 系统截图（透明链开，期望透出壁纸）；K2 后 = 透明链关回实心（期望 #F4EFE6 干净实心）
// 用法：electron glass-combo-k.cjs <outdir>
const { app, BrowserWindow, screen } = require('electron');
const fs = require('node:fs');

const PAGE = [
  '<!doctype html><meta charset=utf-8>',
  '<style>',
  '  :root { --canvas: #F4EFE6; }',
  '  html, body { margin: 0; height: 100%; background: var(--canvas); font: 14px sans-serif; }',
  '  .band { height: 64px; background: rgba(244,239,230,.45); border-bottom: 1px solid rgba(0,0,0,.08); }',
  '  .side { position: absolute; left: 0; top: 64px; bottom: 0; width: 240px; background: rgba(244,239,230,.5); }',
  '  .main { position: absolute; left: 240px; right: 0; top: 64px; bottom: 0; background: rgba(255,255,255,.72); }',
  '  /* 透明链开关 = looks.css [data-osglass="1"][data-look="glass"] 那组规则的仿真 */',
  '  body.osglass, body.osglass html, html.osglass, html.osglass body { background: transparent; }',
  '  body.osglass .band, body.osglass .side, body.osglass .main { background: transparent; }',
  '</style>',
  '<body><div class="band">标题带</div><div class="side">侧栏</div><div class="main">主区（编辑器仿真）</div>',
  '<script>',
  '  setTimeout(() => { document.documentElement.classList.add("osglass"); document.body.classList.add("osglass"); }, 2000);',
  '</script></body>',
].join('\n');

const OUTDIR = process.argv[2] || '.';

app.whenReady().then(() => {
  const wa = screen.getPrimaryDisplay().workArea;
  const win = new BrowserWindow({
    width: Math.round(wa.width * 0.7),
    height: Math.round(wa.height * 0.7),
    x: Math.round(wa.x + wa.width * 0.15),
    y: Math.round(wa.y + wa.height * 0.12),
    transparent: false,
    title: 'glass-combo-K',
    backgroundColor: '#00000000',
    backgroundMaterial: 'acrylic',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#00000000', symbolColor: '#2B2620', height: 36 },
    webPreferences: { sandbox: true },
  });
  win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(PAGE));
  setTimeout(() => {
    const b = win.getBounds();
    fs.writeFileSync(OUTDIR + '/K.bounds.json', JSON.stringify(b));
    console.log('K_BOUNDS ' + JSON.stringify(b));
    console.log('K_DONE');
    win.destroy();
    app.quit();
  }, 9000);
});
