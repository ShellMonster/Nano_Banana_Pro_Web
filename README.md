# Nano Banana Pro Web (纳米香蕉图片生成平台)

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![React](https://img.shields.io/badge/React-18.3.1-blue.svg)
![Go](https://img.shields.io/badge/Go-1.24.3-00ADD8.svg)
![Gemini](https://img.shields.io/badge/GenAI%20SDK-1.40.0-orange.svg)

Nano Banana Pro Web 是一个高性能、易扩展的批量图片生成平台，专为创意工作者设计。它基于 Google Gemini API，支持高分辨率（最高 4K）的文生图与图生图功能，并提供直观的批量任务管理界面。

## 🌟 核心特性

- **🚀 极速生成**：基于 Go 语言后端与 Worker 池化技术，支持多任务并发处理。
- **🎨 4K 超清支持**：深度优化 Gemini 3.0 模型参数，完美支持 16:9、4:3 等多种画幅的 4K 超清生成。
- **📸 智能图生图**：支持多张参考图输入，精准控制生成风格与内容。
- **📦 批量处理**：一键开启批量生成模式，实时进度监控。
- **💾 历史记录管理**：完整的任务历史追踪，支持失败任务一键重试与本地缓存恢复。
- **🔌 灵活扩展**：模块化 Provider 设计，可轻松接入其他主流 AI 模型。

## 🛠️ 技术栈

### 后端 (Backend)
- **语言**: Go v1.24.3 (高性能静态语言，负责核心并发逻辑)
- **框架**: Gin v1.11.0 (轻量级 HTTP Web 框架，负责 API 路由)
- **模型集成**: Google GenAI SDK v1.40.0 (官方 SDK，负责与 Gemini 系列模型通信)
- **数据库**: SQLite + GORM v1.25.12 (轻量级数据库及 ORM，负责任务与图片元数据持久化)
- **存储**: 阿里云 OSS SDK v3.0.2 / 本地存储 (负责图片文件的云端/本地异步存储)
- **配置管理**: Viper v1.21.0 (全功能配置解决方案，支持 YAML/环境变量等)

### 前端 (Frontend)
- **框架**: React v18.3.1 (现代 UI 开发框架)
- **构建工具**: Vite v6.0.7 (极速前端构建工具)
- **状态管理**: Zustand v5.0.2 (轻量级状态管理库，负责生成任务与 UI 状态同步)
- **样式**: Tailwind CSS v3.4.17 (原子类 CSS 框架，负责响应式 UI 设计)
- **图标**: Lucide React v0.468.0 (美观一致的矢量图标库)
- **网络请求**: Axios v1.7.7 + React Query v5.59.20 (负责异步请求、自动重试及数据缓存)
- **类型系统**: TypeScript v5.6.3 (强类型支持，提升代码健壮性)

## 🚀 快速开始

### 1. 克隆项目
```bash
git clone git@github.com:ShellMonster/Nano_Banana_Pro_Web.git
cd Nano_Banana_Pro_Web
```

### 2. 后端启动
```bash
cd backend
# 复制并配置环境 (如有 .env 或 config.yaml)
# 修改 internal/config/config.yaml 中的 Gemini API Key
go mod download
go run cmd/server/main.go
```
后端服务默认运行在 `http://localhost:8080`。

### 3. 前端启动
```bash
cd frontend
npm install
npm run dev
```
前端开发环境默认运行在 `http://localhost:5173`。

## 📂 项目结构

```text
.
├── backend/               # Go 后端代码
│   ├── cmd/               # 入口程序
│   ├── internal/          # 内部业务逻辑 (API, Provider, Model等)
│   ├── scripts/           # 工具脚本与测试
│   └── storage/           # 本地图片存储目录
├── frontend/              # React 前端代码
│   ├── src/
│   │   ├── components/    # UI 组件
│   │   ├── hooks/         # 自定义 React Hooks
│   │   ├── services/      # API 请求层
│   │   └── store/         # Zustand 状态库
│   └── tailwind.config.js # 样式配置
└── README.md              # 项目文档
```

## 📝 许可证

本项目采用 MIT 许可证。
