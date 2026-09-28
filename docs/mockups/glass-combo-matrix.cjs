// glass-combo-matrix.cjs —— T90-01 终局真值表：同进程四窗 2×2（排除跨进程/跨时段环境漂移）
// 维度1: transparent true/false（backgroundColor 恒 #00000000 + backgroundMaterial acrylic 恒构造挂）
// 维度2: CSS 透明自始 vs 运行 2s 后翻（= 产品链「材质常驻+运行中翻透明链」仿真）
// 用法：electron glass-combo-matrix.cjs <outdir> ；外部在启动 ~7s 内系统截图，9.5s 自动退出
const { app, BrowserWindow, screen } = require('electron');
const fs = require('node:fs');

function page(id, transFromStart, flip) {
  const bg = transFromStart ? 'transparent' : '#F4EFE6';
  const flipJs = flip
    ? '<scr' + 'ipt>setTimeout(()=>{for(const s of [document.documentElement,document.body,...document.querySelectorAll(".m")])s.style.background="transparent";},2000);</scr' + 'ipt>'
    : '';
  return '<!doctype html><meta charset=utf-8><style>html,body{margin:0;height:100%;background:' + bg +
    ';font:13px sans-serif}.m{background:' + bg + ';border-bottom:1px solid rgba(0,0,0,.12);padding:14px}</style>' +
    '<body><div class="m">' + id + ' (实心区在翻前/透区在翻后)</div>' + flipJs + '</body>';
}

const OUTDIR = process.argv[2] || '.';

app.whenReady().then(() => {
  const wa = screen.getPrimaryDisplay().workArea;
  const cw = Math.round(wa.width * 0.44);
  const chh = Math.round(wa.height * 0.4);
  const defs = [
    ['W1_transparent_cssStart', { transparent: true,  transStart: true,  flip: false }],
    ['W2_transparent_cssFlip',  { transparent: true,  transStart: false, flip: true  }],
    ['W3_opaque_cssStart',      { transparent: false, transStart: true,  flip: false }],
    ['W4_opaque_cssFlip',       { transparent: false, transStart: false, flip: true  }],
  ];
  const bounds = {};
  const wins = [];
  defs.forEach(([tag, cfg], i) => {
    const x = wa.x + (i % 2) * Math.round(wa.width * 0.51);
    const y = wa.y + Math.floor(i / 2) * Math.round(wa.height * 0.49);
    const w = new BrowserWindow({
      x, y, width: cw, height: chh,
      title: tag, frame: false,
      transparent: cfg.transparent,
      backgroundColor: '#00000000',
      backgroundMaterial: 'acrylic',
      webPreferences: { sandbox: true },
    });
    w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(page(tag, cfg.transStart, cfg.flip)));
    bounds[tag] = w.getBounds();
    wins.push(w);
  });
  setTimeout(() => {
    fs.writeFileSync(OUTDIR + '/MX.bounds.json', JSON.stringify({ scale: screen.getPrimaryDisplay().scaleFactor, bounds }));
    console.log('MX_READY');
  }, 3000);
  setTimeout(() => { console.log('MX_DONE'); for (const w of wins) w.destroy(); app.quit(); }, 9500);
});
