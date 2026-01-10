# 模板市场方案（梳理版）

## 目标
- 在右侧主内容区加入“拉绳”交互，向下拉出模板市场。
- 模板市场提供搜索、分类筛选、画幅比例筛选、模板浏览与复用。
- 复用模板后自动回到生图界面，并把模板图加入参考图区；可选带入模板 prompt。
- 模板数据结构清晰，后续可由后端读取配置并返回前端。

## 交互设计
- 顶部悬浮“拉绳”按钮：
  - 向下拖拽超过阈值触发打开模板市场。
  - 松手后自动回弹；支持点击直接打开。
- 模板市场为整版下拉面板（覆盖右侧主内容区）：
  - 自上而下滑入展开。
  - 头部提供“返回生成”和“关闭”按钮。
  - 主体包含：搜索框、分类筛选、画幅比例、模板卡片列表。
- 模板卡片：缩略图、标题、标签、复用按钮。
- 点击缩略图进入模板预览：
  - 复用现有“看大图”的视觉风格（毛玻璃、居中图像）。
  - 仅保留预览与复用相关操作。

## 数据结构（建议）
```json
{
  "meta": {
    "channels": ["全部", "电商", "微信/公众号"],
    "materials": ["全部", "海报"],
    "industries": ["全部", "通用"],
    "ratios": ["全部", "1:1", "3:4"]
  },
  "items": [
    {
      "id": "tpl-001",
      "title": "猫表情包模板",
      "channels": ["社群发圈", "娱乐"],
      "materials": ["海报"],
      "industries": ["生活服务"],
      "ratio": "1:1",
      "preview": "https://.../thumb.jpg",
      "image": "https://.../full.jpg",
      "prompt": "可选：模板提示词...",
      "tips": "可选：模板使用提示/技巧",
      "source": {
        "name": "@贡献者",
        "label": "GitHub",
        "icon": "github",
        "url": "https://example.com/templates/tpl-001"
      },
      "requirements": {
        "minRefs": 2,
        "note": "还需要一张猫照片作为参考"
      },
      "tags": ["猫", "表情", "搞笑"]
    }
  ]
}
```

## 筛选维度（按当前需求）
- 渠道：全部、电商、微信/公众号、社群发圈、生活、娱乐、小红书、短视频平台、线下印刷、线下电商
- 物料：全部、海报、公众号首图、文章长图、小红书配图、小红书封面、全屏海报、电商竖版海报、商品主图、公众号次图、详情页
- 行业：全部、通用、教育培训、金融保险、商品零售、企业行政、美容美妆、食品生鲜、服饰箱包、政务媒体、生活服务
- 画幅比例：全部、1:1、3:4、4:5、9:16、16:9、2:3

## 复用逻辑（前端）
1. 点击“复用此模板”后：
   - 自动切回生成页；
   - 将模板图加入参考图区；
   - 若模板带 prompt：默认追加到当前 prompt（可扩展为覆盖/追加选项）。
2. 若 `requirements.minRefs > 1`：
   - 弹出提示“还需添加 X 张参考图”。

## 后端扩展（后续）
### 读取与缓存策略
- 启动时读取内置模板：`backend/internal/templates/assets/templates.json`（打包内置）。
- 若存在缓存：使用 `templates_cache.json`（位于应用工作目录/用户配置目录）。
- 请求远程模板（GitHub Raw）：成功则覆盖内存并写入缓存；失败则保留缓存或内置模板。
- 远程地址通过配置项控制：`templates.remote_url`，默认指向 GitHub Raw。

### 接口
- `GET /api/v1/templates`：返回 `meta + items`，支持 query 过滤：
  - `q`（关键词）、`channel`、`material`、`industry`、`ratio`

### 配置
```yaml
templates:
  remote_url: "https://raw.githubusercontent.com/ShellMonster/Nano_Banana_Pro_Web/main/backend/internal/templates/assets/templates.json"
  fetch_timeout_seconds: 4
```

### 后续增删模板
- 直接改 `backend/internal/templates/assets/templates.json`（默认内置）。
- 若走线上更新：将同格式 JSON 放到 GitHub Raw 地址即可，客户端启动会拉取最新内容。

## 前端开发顺序（建议）
1. 先做 UI（假数据）：模板抽屉、拉绳交互、筛选/列表/预览。
2. 接入复用逻辑：加入参考图 + prompt 合并 + 自动切回。
3. 接入后端接口与真实模板数据。
