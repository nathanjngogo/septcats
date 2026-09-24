# Septcats Releases

Septcats（本地优先笔记应用）的**官方发布仓库**：安装包下载 + 自动更新 feed（Ed25519 自签）。
源码仓库暂不公开（Proprietary，版权所有）。

## 下载最新版（Windows x64）

- **安装包（GitHub Releases，Latest）**：<https://github.com/nathanjngogo/septcats-releases/releases/latest>
- **自动更新 feed（应用内 updater 读取，勿手动下载）**：
  - `https://github.com/nathanjngogo/septcats-releases/releases/download/latest/latest.yml`
  - 同 tag 下 `latest.yml.sig`（Ed25519 对 latest.yml 原文字节的签名，base64 单行）
  - feed 通道 release 的 tag 名为 `latest`（GitHub Web 界面会把它折叠到预发布视图，属 GitHub 显示规则；直链与 updater 均正常）。

## 安全与隐私

- 安装包未做商业代码签名（Authenticode）：首次运行若出现 Windows SmartScreen，选「更多信息 → 仍要展开」。
- 更新包必须通过应用内硬编码公钥验签（Ed25519）才会安装；feed 被篡改会直接拒绝（`E_FEED_SIGNATURE`），且 `latest.yml` 声明的 SHA-512 与下载字节逐一对账。
- 应用本地优先：默认零外联；AI 仅在你显式配置端点后使用；密钥只进系统凭据库（Windows DPAPI）。

## 许可

- Septcats 本体：**版权所有（All rights reserved）**。
- 随包第三方字体 **Noto Sans SC / Source Han Sans**（Google Fonts，OFL 1.1）：许可文本随安装包分发于
  `resources/licenses/OFL-NotoSansSC.txt`（仓库同路径），设置 → 关于 亦有入口。

| Third party | License |
|---|---|
| Noto Sans SC (Source Han Sans) | SIL Open Font License 1.1 |

## 版本与升级

- 更新说明见各 Release 页面（中英双语）与 CHANGELOG。
- 0.1.x / 0.2.x 老用户建议升级到当前最新版；数据向后兼容（SQLite 迁移自动执行）。

## 联系方式

Issues / 反馈：在本仓库提 Issue（发布仓即反馈入口）。
