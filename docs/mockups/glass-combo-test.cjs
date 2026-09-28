// D 单窗前台复验：transparent:true + alpha底 + 构造 acrylic + CSS 自始透明（当初成功配方）
const { app, BrowserWindow, screen } = require('electron');
const fs = require('node:fs');
const PAGE = '<!doctype html><meta charset=utf-8><style>html,body{margin:0;height:100%;background:transparent;font:13px sans-serif}.m{background:rgba(244,239,230,.5);padding:14px;border-bottom:1px solid rgba(0,0,0,.1)}</style><body><div class="m">D 复验：自始透明+构造acrylic+transparent:true</div></body>';
const OUTDIR = process.argv[2] || '.';
app.whenReady().then(() => {
  const wa = screen.getPrimaryDisplay().workArea;
  const w = new BrowserWindow({ x: Math.round(wa.x+wa.width*0.15), y: Math.round(wa.y+wa.height*0.12), width: Math.round(wa.width*0.7), height: Math.round(wa.height*0.7), title: 'glass-D-recheck', frame: false, transparent: true, backgroundColor: '#00000000', backgroundMaterial: 'acrylic', webPreferences: { sandbox: true } });
  w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(PAGE));
  w.focus();
  w.setAlwaysOnTop(true, 'screen-saver');
  setTimeout(() => { fs.writeFileSync(OUTDIR+'/DR.bounds.json', JSON.stringify({ scale: screen.getPrimaryDisplay().scaleFactor, b: w.getBounds(), focused: w.isFocused(), active: w.isActive() })); console.log('DR_READY focused=' + w.isFocused() + ' active=' + w.isActive()); }, 2500);
  setTimeout(() => { console.log('DR_DONE'); w.destroy(); app.quit(); }, 20000);
});
