# 多语言方案（i18next）

## 目标
- 支持中文（zh-CN）与英文（en-US），后续可按 key 拓展更多语言。
- 首次启动根据设备语言自动选择；用户可在设置中切换并持久化。
- 桌面端使用 Tauri 系统语言能力；Web 端使用浏览器语言。
- macOS 应用名称本地化（InfoPlist.strings）。
- ESLint 阻止 UI 中硬编码中文，降低遗漏风险。

## 实施范围
- desktop 与 frontend 两套前端代码。
- Settings 页面新增语言选择。
- 所有 UI 文案、toast、提示语等统一迁移到 i18n 资源。

## 技术方案
1. i18next + react-i18next：各包新增 `src/i18n` 初始化与资源文件。
2. 语言检测：
   - desktop：`@tauri-apps/plugin-os` 读取系统 locale；失败时降级 `navigator.language`。
   - frontend：直接用 `navigator.language`。
3. 语言持久化：配置 store 新增 `language` 字段；首次无值时写入检测结果。
4. 标题与 App 名称：
   - 运行时：`document.title` / Tauri 窗口标题随语言变化更新。
   - macOS：`desktop/src-tauri/Resources/*/InfoPlist.strings` 本地化显示名。
5. ESLint：新增 “禁止中文硬编码” 规则（忽略 `src/i18n/**`）。

## 迁移步骤
- 新增 i18n 初始化、资源文件与语言检测工具。
- Settings 加入语言切换入口。
- 将 UI 文案与提示语替换为 `t()`。
- 增加 ESLint 规则并修复违例。
- 更新 Tauri 插件与 capability；添加 InfoPlist 本地化。

## 验收点
- 初次启动根据系统语言展示；设置切换即时生效并持久化。
- macOS Finder 与 Dock 中 App 名称随语言切换显示。
- ESLint 能阻止硬编码中文。
