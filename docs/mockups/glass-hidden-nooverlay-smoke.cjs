// C 轮建窗烟测：titleBarStyle:'hidden' 不配 titleBarOverlay —— OS 按钮消失？框架/圆角/resize 保留？
const { app, BrowserWindow, screen } = require('electron');
app.whenReady().then(() => {
  const wa = screen.getPrimaryDisplay().workArea;
  const w = new BrowserWindow({
    x: Math.round(wa.x + wa.width * 0.2), y: Math.round(wa.y + wa.height * 0.2),
    width: 900, height: 600,
    title: 'SC-HIDDEN-NO-OVERLAY', backgroundColor: '#F4EFE6',
    titleBarStyle: 'hidden',
    // 故意不设 titleBarOverlay
    webPreferences: { sandbox: true },
  });
  w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(
    '<body style="margin:0;height:100vh;background:transparent;font:13px sans-serif">'
    + '<div style="height:36px;-webkit-app-region:drag;background:rgba(180,120,90,.35)">DRAG ZONE (双击=最大化?) 右上应为纯背景，无 OS 按钮</div>'
    + '<div id=log>boot</div></body>'));
  setTimeout(() => { w.focus(); console.log('SMOKE_READY frameless-hidden focused=' + w.isFocused()); }, 2000);
  setTimeout(() => { w.destroy(); app.quit(); }, 15000);
});
