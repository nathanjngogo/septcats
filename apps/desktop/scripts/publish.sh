#!/usr/bin/env bash
# publish.sh —— Septcats 发布到 GitHub Releases（feed = release 下载直链）
# 用法：bash apps/desktop/scripts/publish.sh
# 前置：gh 已登录（gh auth login --web）；apps/desktop/dist 已出包并 feed-sign sign。
# 幂等性：gh release create --clear + upload --clobber，重跑安全。
set -euo pipefail
export PATH="$PATH:/c/Program Files/GitHub CLI"

cd "$(dirname "$0")/../../.."   # 仓库根
REPO="septcats-releases"        # 老板已批：纯发布仓，public（generic feed 需匿名下载）
DIST="apps/desktop/dist"

VER="$(node -p "require('./apps/desktop/package.json').version")"
USER="$(gh api user --jq .login)"
FEED_URL="https://github.com/${USER}/${REPO}/releases/download"
echo "== 发布 ${VER} -> github.com/${USER}/${REPO}  feed=${FEED_URL}"

# 1) 发布仓（存在则复用；gh repo create --source 仅当前目录，发布仓用独立 --clone 判断）
if ! gh repo view "${USER}/${REPO}" >/dev/null 2>&1; then
  gh repo create "${REPO}" --public \
    --description "Septcats 安装包与自动更新 feed（源码暂不公开）"
  gh api "repos/${USER}/${REPO}/contents/README.md" -X PUT \
    -f message="init" \
    -f content="$(printf '# Septcats Releases\n\nSeptcats（本地优先笔记应用）的安装包发布仓库，兼作自动更新 feed（Ed25519 自签 latest.yml.sig）。\n\n- 下载最新安装包：见 Releases\n- 源码：暂不公开\n- 安全说明：更新包经应用内硬编码公钥验签后才安装；feed 篡改会直接被拒（E_FEED_SIGNATURE）。\n' | base64 -w0)" \
    -f branch=main
fi

# 2) feed URL 固定指向 tag=latest（GitHub 按 tag 解析资产路径，latest.yml 永远在这条 URL 上）
FEED_BASE="${FEED_URL}/latest"
FEED_BASE="${FEED_BASE}" python - <<'PYEOF'
import io, os, re
p = "apps/desktop/electron-builder.yml"
t = io.open(p, encoding="utf-8").read()
base = os.environ["FEED_BASE"]
t = re.sub(r"(url: )[^\n]+", lambda m: m.group(1) + base, t, count=1)
io.open(p, "w", encoding="utf-8", newline="\n").write(t)
print("publish.url ->", base)
PYEOF
grep -q "url: ${FEED_BASE}" apps/desktop/electron-builder.yml || { echo "publish.url 写入失败"; exit 2; }
git add apps/desktop/electron-builder.yml
git commit -q -m "chore(release): publish feed URL -> GitHub Releases ${USER}/${REPO} (tag=latest 通道)" || true

# 3) 重打包（app-update.yml 由 publish 配置生成，url 变更必须重打）+ 签 feed + 护栏
pnpm -C apps/desktop dist
node -e "const t=require('node:fs').readFileSync('apps/desktop/dist/win-unpacked/resources/app-update.yml','utf8'); if(!t.includes('${FEED_BASE}')) { console.error('app-update.yml feed 不符：'+t); process.exit(1); } console.log('app-update.yml feed 校验通过')"
export SEPTCATS_FEED_KEY="${SEPTCATS_FEED_KEY:?需要 feed 私钥（离线备份在 E:\\密钥备份\\septcats-feed-keys）}"
node apps/desktop/scripts/feed-sign.mjs sign --feed "${DIST}"
node apps/desktop/scripts/feed-sign.mjs verify --feed "${DIST}" --pub apps/desktop/tmp/feed-keys/septcats-feed.pub
pnpm -C apps/desktop dist:check

# 4) 发布双 tag：v<ver>（归档）+ latest（feed 通道，资产覆盖）
#    注意：gh release upload 会归一化含空格的文件名为点（Septcats.Setup.0.1.4.exe），
#    latest.yml 用带空格路径引用，GitHub releases/download 按 tag 解析，点文件名可正确解析。
ASSETS=("${DIST}/Septcats Setup ${VER}.exe" "${DIST}/Septcats Setup ${VER}.exe.blockmap" "${DIST}/latest.yml" "${DIST}/latest.yml.sig")
gh release create "v${VER}" --repo "${USER}/${REPO}" --title "Septcats ${VER}" \
  --notes "Septcats ${VER} 安装包。自动更新 feed：${FEED_BASE}/latest.yml(.sig)。" \
  "${ASSETS[@]}" 2>/dev/null || gh release upload "v${VER}" --repo "${USER}/${REPO}" --clobber "${ASSETS[@]}"
if gh release view latest --repo "${USER}/${REPO}" >/dev/null 2>&1; then
  gh release upload latest --repo "${USER}/${REPO}" --clobber "${ASSETS[@]}"
else
  gh release create latest --repo "${USER}/${REPO}" --title "Septcats latest (${VER})" \
    --notes "自动更新 feed 通道：应用固定拉本 tag 的 latest.yml(.sig)。当前版本 ${VER}。" \
    "${ASSETS[@]}"
fi
# gh 归一化含空格文件名 -> 点（Septcats.Setup.0.1.4.exe）。latest.yml 由 electron-builder 生成用空格路径，
# updater 会 URL-encode 为 %20 -> 404。故把上传的 latest.yml 重写成点文件名，匹配实际资产名。
gh api repos/${USER}/${REPO}/contents/dist/latest.yml --jq .content | base64 -d > "${DIST}/latest.yml" 2>/dev/null || true
python - <<PYEOF
import io, os, re
p = "apps/desktop/dist/latest.yml"
try:
    t = io.open(p, encoding="utf-8").read()
except Exception:
    t = ""
# 仅把安装包路径名中的空格 -> 点（保留 latest.yml.sig 等不动）
t = re.sub(r"Septcats Setup (\d)", r"Septcats.Setup.\1", t)
io.open(p, "w", encoding="utf-8", newline="\n").write(t)
print("latest.yml 归一化路径完成")
PYEOF
# 校验：latest.yml 中每个 files[].url 都能在对应 tag 上匿名下载
for url in $(grep -oE "https://github\.com[^ ]+\.exe" "apps/desktop/dist/latest.yml"); do
  code=$(curl -sL -o /dev/null -w "%{http_code}" "$url")
  echo "check $url -> HTTP=$code"
done

# 5) 公开验证：匿名拉 feed 与包头 1KB
echo "== 验证匿名可拉取 =="
curl -sf "${FEED_BASE}/latest.yml" | head -3
curl -sf "${FEED_BASE}/latest.yml.sig" | head -c 20; echo
curl -sI "${FEED_BASE}/Septcats%20Setup%20${VER}.exe" | grep -iE "^HTTP|content-length" | head -3
echo "== DONE feed=${FEED_BASE} tag=v${VER}+latest =="
