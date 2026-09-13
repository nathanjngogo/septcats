# tokens/DESIGN.source.md —— 这不是副本，是指针

本文件**不包含任何 token 值**，存在的意义只有一个：说明 `packages/ui` 的 token 唯一来源在哪。

- 唯一来源：仓库根 `DESIGN.md`（PM 维护，Google design.md 规范）。
- `tokens/build-tokens.mjs` 默认读取 `../../DESIGN.md`（相对本包参数化），可用 `--source=<path>` 覆盖。
- 严禁在此目录复制一份 DESIGN.md 或 token 值：两套真相会在 §16.1 的 CI 门禁里被判违规。

生成与校验：

```
node tokens/build-tokens.mjs --write   # 生成 src/tokens.css 与 src/tokens.ts
node tokens/build-tokens.mjs --check   # 与已提交产物比对，漂移则 exit 1
node tokens/no-magic.mjs               # 组件 CSS 魔法值扫描，0 命中
```
