const { app, BrowserWindow, screen } = require('electron');
const PAGE = '<!doctype html><meta charset=utf-8><style>' +
  'html,body{margin:0;height:100%;background:transparent;font:14px sans-serif;color:#222}' +
  '.band{position:absolute;top:0;left:0;right:0;height:36px;-webkit-app-region:drag;background:rgba(255,255,255,0.30);display:flex;align-items:center;padding-left:10px}' +
  '.p{position:absolute;left:10%;top:40%;padding:18px 28px;background:rgba(255,255,255,0.35);border-radius:12px}' +
  '</style><body><div class=band>拖拽带（左=自绘；右=OS overlay 按钮）</div><div id=p class=p></div></body>';
app.whenReady().then(() => {
  const { width } = screen.getPrimaryDisplay().workAreaSize;
  const win = new BrowserWindow({
    width: 900, height: 620, x: 120, y: 90, show: false,
    transparent: true, frame: false, titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#00000000', symbolColor: '#2B2620', height: 36 },
    webPreferences: { sandbox: true },
  });
  let mat = 'n/a';
  try { win.setBackgroundMaterial('acrylic'); mat = 'acrylic'; } catch (e) { mat = 'ERR:' + String((e && e.message) || e); }
  win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(PAGE.replace('<div id=p class=p></div>', '<div id=p class=p>material=' + mat + ' — 四周透出桌面磨砂=成立；黑底=transparent 与材质冲突</div>')));
  win.once('ready-to-show', () => win.show());
  console.log('SMOKE_MATERIAL=' + mat);
  setTimeout(() => { if (!win.isDestroyed()) { win.close(); } }, 9000);
});
app.on('window-all-closed', () => app.quit());
