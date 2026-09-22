/**
 * raw.d.ts —— Vite `?raw` 导入的模块声明（TASK-T56-01 §1②）。
 *
 * 使用说明书的正文（docs/manual/manual.zh.md / manual.en.md）在**构建期**经
 * `?raw` 内联进 renderer bundle：运行时零 fs 读取、零网络请求，隐私红线不破。
 *
 * 放在 src/types（tsconfig.node / tsconfig.web 双 include）——renderer 源码与
 * 引用其渲染器的测试都能解析同一份声明。
 */
declare module '*?raw' {
  const content: string;
  export default content;
}
