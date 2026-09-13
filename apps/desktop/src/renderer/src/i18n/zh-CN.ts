/**
 * zh-CN.ts —— 中文文案单一来源（TASK-T10-01 §2）。
 *
 * 嵌套字典，key 用 `.` 路径（`settings.appearance.theme`）。
 * 命令表 label/hint 用命令 id 的自然嵌套（`commands.page.new` / `commandHints.page.new`）。
 * 别名（拼音/英文搜索词）不属于展示文案，仍在 palette/commands.ts 里维护。
 */
export const zhCN = {
  settings: {
    title: '设置',
    appearance: {
      title: '外观',
      theme: '主题',
      themeDesc: '跟随系统时随 Windows/macOS 深浅色自动切换',
      themeLight: '浅色',
      themeDark: '深色',
      themeSystem: '跟随系统',
    },
    privacy: {
      title: '数据与隐私',
      syncPath: '同步路径',
      syncPathDesc: '同步文件夹路径，仅展示（改路径归后续里程碑）',
      telemetry: '使用情况遥测',
      telemetryDesc: '一期不采集任何遥测数据',
      linkPreviewOnType: '打字时禁用外链预览',
      linkPreviewOnTypeDesc: '输入链接时不触发网络请求',
    },
    diagnostic: {
      title: '诊断',
      export: '导出诊断包',
      exportDesc: '生成脱敏后的诊断信息，用于排查问题',
      previewTitle: '诊断包预览（已脱敏）',
      confirmSave: '确认保存',
      cancel: '取消',
      savedTo: '已保存到',
      generating: '生成中…',
    },
    about: {
      title: '关于',
      version: '版本',
      stack: '技术栈',
      logo: 'Septcats',
    },
    error: {
      loadFailed: '设置加载失败',
      saveFailed: '设置保存失败',
    },
  },
  commands: {
    page: {
      new: '新建页面',
    },
    workspace: {
      switch: '切换工作区',
    },
    app: {
      settings: '打开设置',
      export: '导出',
      trash: '回收站',
      sync: '同步面板',
      import: '导入',
    },
    theme: {
      light: '切换主题：浅色',
      dark: '切换主题：深色',
      system: '切换主题：跟随系统',
    },
  },
  commandHints: {
    page: {
      new: '在根层创建空白页',
    },
    workspace: {
      switch: '切换到下一个工作区',
    },
    app: {
      settings: '偏好与应用设置',
      export: '导出当前工作区快照',
      trash: '查看已删除页面',
      sync: '查看同步状态',
      import: '导入快照文件',
    },
    theme: {
      light: '界面主题',
      dark: '界面主题',
      system: '界面主题',
    },
  },
} as const;
