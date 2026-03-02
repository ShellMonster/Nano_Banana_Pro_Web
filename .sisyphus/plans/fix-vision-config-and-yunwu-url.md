# fix: vision model config persistence + yunwu.ai URL validation

## TL;DR

> 两个 bug 修复：
> 1. App 重启后识图模型信息丢失，导致识图请求报 400/404
> 2. yunwu.ai Base URL 输入框需要特殊校验，防止用户多输入 `/v1` 等路径
>
> **Deliverables**:
> - `desktop/src/components/Settings/SettingsModal.tsx` — 修复 visionModel 继承逻辑 + 添加 yunwu.ai URL 校验
> - `desktop/src/i18n/locales/*.json` (4 文件) — 新增 yunwu.ai 提示翻译
>
> **Estimated Effort**: Short
> **Parallel Execution**: YES — Wave 1 并行，Wave 2 i18n 可并行
> **Critical Path**: Task 1 → Task 2-5 并行 → Task 6 commit

---

## Context

### Bug 1: 识图模型信息丢失

**问题现象**：App 重启后，发起识图请求时报 400 或 404 错误。

**根因分析**：

在 `desktop/src/components/Settings/SettingsModal.tsx` 的 `fetchConfigs` 函数里（第 255-264 行）：

```tsx
} else {
  // 如果没有独立的识图配置，默认继承生图配置
  const imageCfg = imageConfig || data.find((p) => p.provider_name === imageProvider);
  if (imageCfg) {
    setVisionApiBaseUrl(imageCfg.api_base);
    setVisionApiKey(imageCfg.api_key);
    // ❌ 问题：这里没有设置 visionModel！
  }
  setVisionTimeoutSeconds(150);
  setVisionSyncedConfig(null);
}
```

当后端没有独立的 vision 配置时，代码继承了生图配置的 `api_base` 和 `api_key`，但**没有继承 `model`**！
导致 `visionModel` 可能为空字符串，发起请求时 URL 缺少模型参数，返回 400/404。

**修复方案**：在 else 分支里添加 `setVisionModel(imageCfg.model)` 或从 `getDefaultModelId(imageCfg.models)` 获取。

---

### Bug 2: yunwu.ai URL 校验

**问题现象**：用户在 Base URL 输入框中输入 `https://yunwu.ai/v1` 或 `https://yunwu.ai/v1beta`，导致请求失败。

**原因**：
- yunwu.ai 支持 Gemini 和 OpenAI 两种 API 格式
- 对于 Gemini 类型：后端会自动追加 `/v1beta`，用户只需输入 `https://yunwu.ai`
- 对于 OpenAI 类型：后端会自动追加 `/v1/chat/completions`，用户只需输入 `https://yunwu.ai` 或 `https://yunwu.ai/v1`

**修复方案**：
1. 新增 `hasYunwuExtraPathWarning(baseUrl, providerType)` 函数
2. 检测 URL 是否包含 `yunwu.ai` 且带有 `/v1`、`/v1beta`、`/chat/completions` 等路径
3. 根据 provider 类型显示不同的警告信息

---

## Work Objectives

### Must Have
- 识图配置在没有独立后端配置时，正确继承生图配置的 model
- yunwu.ai URL 校验：检测多余路径并显示警告

### Must NOT Have
- 不修改后端代码
- 不改 frontend（frontend 没有识图功能）
- 不改现有 Gemini Base URL 校验逻辑

---

## Execution Strategy

```
Wave 1 (串行，核心修复):
└── Task 1: desktop/SettingsModal.tsx — 修复 visionModel 继承 + 添加 yunwu.ai 校验函数

Wave 2 (并行，i18n):
├── Task 2: zh-CN.json — 添加 yunwu.ai 警告文案
├── Task 3: en-US.json — 同上
├── Task 4: ja-JP.json — 同上
└── Task 5: ko-KR.json — 同上

Wave 3 (串行):
└── Task 6: 验证 + commit + push + PR
```

---

## TODOs

- [ ] 1. 修复 `desktop/src/components/Settings/SettingsModal.tsx`

  **What to do**:

  ### 改动 A：修复 visionModel 继承（第 255-264 行）

  找到以下代码：
  ```tsx
  } else {
    // 如果没有独立的识图配置，默认继承生图配置
    const imageCfg = imageConfig || data.find((p) => p.provider_name === imageProvider);
    if (imageCfg) {
      setVisionApiBaseUrl(imageCfg.api_base);
      setVisionApiKey(imageCfg.api_key);
    }
    setVisionTimeoutSeconds(150);
    setVisionSyncedConfig(null);
  }
  ```

  改为：
  ```tsx
  } else {
    // 如果没有独立的识图配置，默认继承生图配置
    const imageCfg = imageConfig || data.find((p) => p.provider_name === imageProvider);
    if (imageCfg) {
      setVisionApiBaseUrl(imageCfg.api_base);
      setVisionApiKey(imageCfg.api_key);
      // 继承生图配置的模型
      const modelFromConfig = getDefaultModelId(imageCfg.models);
      if (modelFromConfig) {
        setVisionModel(modelFromConfig);
      }
    }
    setVisionTimeoutSeconds(150);
    setVisionSyncedConfig(null);
  }
  ```

  ### 改动 B：添加 yunwu.ai URL 校验函数（在 `hasGeminiBasePathWarning` 函数之后）

  添加新函数：
  ```tsx
  // 检测 yunwu.ai 是否多输入了路径（/v1, /v1beta 等）
  const hasYunwuExtraPathWarning = (baseUrl: string, providerType: 'gemini' | 'openai'): boolean => {
    const raw = String(baseUrl || '').trim().toLowerCase();
    if (!raw) return false;
    if (!raw.includes('yunwu.ai')) return false;

    let pathname = '';
    try {
      pathname = new URL(raw).pathname.toLowerCase();
    } catch {
      const withoutOrigin = raw
        .replace(/^[a-z]+:\/\/[^/]+/i, '')
        .split(/[?#]/)[0]
        .toLowerCase();
      pathname = withoutOrigin;
    }

    const path = pathname.replace(/\/+$/, '');
    if (!path || path === '/') return false;

    // 检测是否有额外的 API 路径
    return (
      path === '/v1' ||
      path.startsWith('/v1/') ||
      path === '/v1beta' ||
      path.startsWith('/v1beta/') ||
      path.includes('/chat/completions') ||
      path.includes('/responses')
    );
  };
  ```

  ### 改动 C：在生图/识图/对话 Base URL 输入区域添加 yunwu 警告显示

  找到现有的 `imageBaseWarn` 变量定义（约第 131 行），改为：
  ```tsx
  const imageBaseWarn = (isGeminiProvider(imageProvider) && hasGeminiBasePathWarning(imageApiBaseUrl)) ||
    hasYunwuExtraPathWarning(imageApiBaseUrl, imageProvider === 'gemini' ? 'gemini' : 'openai');
  ```

  找到 `visionBaseWarn` 变量（约第 132 行），改为：
  ```tsx
  const visionBaseWarn = (isGeminiProvider(visionProvider) && hasGeminiBasePathWarning(visionApiBaseUrl)) ||
    hasYunwuExtraPathWarning(visionApiBaseUrl, visionProvider === 'gemini-chat' ? 'gemini' : 'openai');
  ```

  找到 `chatBaseWarn` 变量（约第 133 行），改为：
  ```tsx
  const chatBaseWarn = (isGeminiProvider(chatProvider) && hasGeminiBasePathWarning(chatApiBaseUrl)) ||
    hasYunwuExtraPathWarning(chatApiBaseUrl, chatProvider === 'gemini-chat' ? 'gemini' : 'openai');
  ```

  ### 改动 D：添加 yunwu 警告提示 UI（3 处）

  在生图 Base URL 输入区域（约第 875 行附近），找到：
  ```tsx
  {imageBaseWarn && (
    <p className="text-xs text-amber-600 px-1">{t('settings.provider.geminiBasePathHint')}</p>
  )}
  ```

  改为：
  ```tsx
  {imageBaseWarn && (
    <p className="text-xs text-amber-600 px-1">
      {hasYunwuExtraPathWarning(imageApiBaseUrl, imageProvider === 'gemini' ? 'gemini' : 'openai')
        ? t('settings.provider.yunwuExtraPathHint')
        : t('settings.provider.geminiBasePathHint')}
    </p>
  )}
  ```

  同样修改识图（约第 1003 行）和对话（约第 1130 行）的警告显示。

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: [`frontend-ui-ux`]

  **Parallelization**:
  - **Can Run In Parallel**: NO（核心修改，需先完成）
  - **Blocked By**: None

  **References**:
  - `desktop/src/components/Settings/SettingsModal.tsx:255-264` — visionModel 继承问题位置
  - `desktop/src/components/Settings/SettingsModal.tsx:69-94` — hasGeminiBasePathWarning 函数参考
  - `desktop/src/components/Settings/SettingsModal.tsx:131-133` — imageBaseWarn/visionBaseWarn/chatBaseWarn 位置
  - `desktop/src/components/Settings/SettingsModal.tsx:875/1003/1130` — 警告 UI 位置

  **Acceptance Criteria**:
  - [ ] `npm run type-check` 通过
  - [ ] `npm run lint` 无新增 error
  - [ ] 代码中存在 `hasYunwuExtraPathWarning` 函数
  - [ ] 代码中存在 visionModel 继承逻辑

---

- [ ] 2. 添加 i18n — `desktop/src/i18n/locales/zh-CN.json`

  **What to do**:

  在 `settings.provider` 下添加新 key（约第 161 行后）：
  ```json
  "yunwuExtraPathHint": "云雾 API 建议仅填写域名（如 https://yunwu.ai），无需带 /v1 或 /v1beta 路径，后端会自动处理"
  ```

  **Parallelization**: YES（与 Task 3-5 并行）

---

- [ ] 3. 添加 i18n — `desktop/src/i18n/locales/en-US.json`

  **What to do**:

  在 `settings.provider` 下添加：
  ```json
  "yunwuExtraPathHint": "For Yunwu API, enter only the domain (e.g., https://yunwu.ai). Do not include /v1 or /v1beta paths - the backend handles this automatically."
  ```

---

- [ ] 4. 添加 i18n — `desktop/src/i18n/locales/ja-JP.json`

  **What to do**:

  在 `settings.provider` 下添加：
  ```json
  "yunwuExtraPathHint": "Yunwu API の場合はドメインのみ入力してください（例: https://yunwu.ai）。/v1 や /v1beta は不要です。バックエンドが自動的に処理します。"
  ```

---

- [ ] 5. 添加 i18n — `desktop/src/i18n/locales/ko-KR.json`

  **What to do**:

  在 `settings.provider` 下添加：
  ```json
  "yunwuExtraPathHint": "Yunwu API의 경우 도메인만 입력하세요 (예: https://yunwu.ai). /v1 또는 /v1beta 경로는 필요하지 않습니다. 백엔드가 자동으로 처리합니다."
  ```

---

- [ ] 6. 验证 + commit + push + PR

  **What to do**:
  1. `cd desktop && npm run type-check` — exit 0
  2. `cd desktop && npm run lint` — 无新增 error
  3. `git checkout main && git pull && git checkout -b fix/vision-config-and-yunwu-url`
  4. `git add desktop/src/components/Settings/SettingsModal.tsx desktop/src/i18n/locales/*.json`
  5. `git commit -m "fix(settings): vision model inheritance + yunwu.ai URL validation"`
  6. `git push -u origin fix/vision-config-and-yunwu-url`
  7. `gh pr create --title "fix(settings): vision model inheritance + yunwu.ai URL validation"`

  **Acceptance Criteria**:
  - [ ] PR 创建成功
  - [ ] TypeScript 检查通过

---

## Success Criteria

- [ ] visionModel 在没有独立后端配置时能正确继承生图配置
- [ ] yunwu.ai URL 带有多余路径时显示警告
- [ ] 4 种语言的 i18n 都已添加
- [ ] TypeScript 检查通过
