// T90-01 取证分层：同进程双窗 mica vs acrylic；双截图法（win.capturePage + 系统全屏）
// 用法：electron glass-verify.cjs <outdir> ；capturePage 在 6s 写 PNG；bounds 即时写
const { app, BrowserWindow, screen } = require('electron');
const fs = require('node:fs');
const PAGE = '<!doctype html><meta charset=utf-8><style>html,body{margin:0;height:100%;background:transparent;font:14px sans-serif}</style><body><div style="background:rgba(244,239,230,.55);padding:18px;border-bottom:1px solid rgba(0,0,0,.12)">半透明纱罩条</div></body>';
const OUTDIR = process.argv[2] || '.';
app.whenReady().then(() => {
  const wa = screen.getPrimaryDisplay().workArea;
  const mk = (mat, i) => {
    const w = new BrowserWindow({
      x: Math.round(wa.x + wa.width * (0.08 + i * 0.46)), y: Math.round(wa.y + wa.height * 0.15),
      width: Math.round(wa.width * 0.4), height: Math.round(wa.height * 0.6),
      title: 'verify-' + mat, frame: false, transparent: false, backgroundColor: '#00000000',
      backgroundMaterial: mat, webPreferences: { sandbox: true },
    });
    w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(PAGE));
    return w;
  };
  const wins = { mica: mk('mica', 0), acrylic: mk('acrylic', 1) };
  const bounds = {};
  for (const [k, w] of Object.entries(wins)) bounds[k] = w.getBounds();
  setTimeout(async () => {
    fs.writeFileSync(OUTDIR + '/VERIFY.bounds.json', JSON.stringify({ scale: screen.getPrimaryDisplay().scaleFactor, bounds }));
    for (const [k, w] of Object.entries(wins)) {
      const img = await w.webContents.capturePage();
      fs.writeFileSync(OUTDIR + '/cap-' + k + '.png', img.toPNG());
    }
    console.log('VERIFY_READY');
  }, 6000);
  setTimeout(() => { console.log('VERIFY_DONE'); for (const w of Object.values(wins)) w.destroy(); app.quit(); }, 16000);
});
