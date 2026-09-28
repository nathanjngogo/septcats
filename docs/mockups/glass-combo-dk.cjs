// glass-combo-dk.cjs —— D/K 同场对照（排除跨进程环境态漂移）
// 用法：electron glass-combo-dk.cjs <outdir>
// W1 = D 配方：transparent:true + backgroundColor #00000000 + 构造时 backgroundMaterial acrylic + 实心 CSS body（无 osglass 类）
// W2 = K 配方：transparent:false + backgroundColor #00000000 + 构造时 backgroundMaterial acrylic + 运行 2s 后 html/body 加 osglass 翻透明
// 期望：两者截图均透出桌面（sat>20）→ 说明材质构造时挂是对的，K 上次死灰是环境态；若 W1 透 W2 灰 → transparent:true 必需
const { app, BrowserWindow, screen } = require('electron');
const fs = require('node:fs');

const css = (extraTrans) => [
  '<style>',
  '  html, body { margin: 0; height: 100%; font: 14px sans-serif; background: ' + (extraTrans ? 'transparent' : '#F4EFE6') + '; }',
  '  .band { height: 64px; background: ' + (extraTrans ? 'transparent' : 'rgba(244,239,230,.45)') + '; }',
  '  .side { position:absolute; left:0; top:64px; bottom:0; width:200px; background: ' + (extraTrans ? 'transparent' : 'rgba(244,239,230,.5)') + '; }',
  '  .main { position:absolute; left:200px; right:0; top:64px; bottom:0; background: ' + (extraTrans ? 'transparent' : 'rgba(255,255,255,.72)') + '; }',
  '  h3 { padding: 8px; }',
  '</style>'].join('\n');

const PAGE_D = '<!doctype html><meta charset=utf-8>' + css(false) +
  '<body><div class="band">D 标题带</div><div class="side">D 侧栏</div><div class="main"><h3>D：实心CSS + 构造material + transparent:true</h3></div></body>';
const PAGE_K = '<!doctype html><meta charset=utf-8>' + css(false) +
  '<body><div class="band">K 标题带</div><div class="side">K 侧栏</div><div class="main"><h3>K：材质常驻，运行中翻透明链</h3></div></body>' +
  '<script>setTimeout(()=>{document.documentElement.style.background="transparent";document.body.style.background="transparent";for(const el of document.querySelectorAll(".band,.side,.main"))el.style.background="transparent";},2000);</script>';

const OUTDIR = process.argv[2] || '.';

app.whenReady().then(() => {
  const wa = screen.getPrimaryDisplay().workArea;
  const halfW = Math.round(wa.width * 0.33);
  const h = Math.round(wa.height * 0.6);
  const y = Math.round(wa.y + wa.height * 0.18);
  const base = {
    height: h, transparent: false, titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#00000000', symbolColor: '#2B2620', height: 36 },
    webPreferences: { sandbox: true },
  };
  const w1 = new BrowserWindow({
    ...base, x: Math.round(wa.x + wa.width * 0.04), width: halfW,
    title: 'glass-combo-D', backgroundColor: '#00000000', backgroundMaterial: 'acrylic',
  });
  const w2 = new BrowserWindow({
    ...base, x: Math.round(wa.x + wa.width * 0.63), width: halfW,
    title: 'glass-combo-K', backgroundColor: '#00000000', backgroundMaterial: 'acrylic',
  });
  w1.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(PAGE_D));
  w2.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(PAGE_K));
  const bounds = {};
  setTimeout(() => { bounds.D = w1.getBounds(); bounds.K = w2.getBounds(); }, 5000);
  setTimeout(() => {
    fs.writeFileSync(OUTDIR + '/DK.bounds.json', JSON.stringify({ scale: screen.getPrimaryDisplay().scaleFactor, bounds }));
    console.log('DK_DONE ' + JSON.stringify(bounds));
    w1.destroy(); w2.destroy(); app.quit();
  }, 9000);
});
