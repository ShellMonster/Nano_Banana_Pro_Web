# Feat: 模型选择改为下拉 + 自定义输入

## TL;DR

> **Quick Summary**: 将设置页的生图模型和识图模型字段从纯文本输入框改为「预设下拉 + 自定义输入」模式，降低用户输入错误的概率，同时将新用户的生图模型默认值更新为更快更便宜的 `gemini-3-flash-image-preview`。会话模型保持现有输入框不变。
>
> **Deliverables**:
> - `desktop/src/store/configStore.ts`：version 升至 12，新用户默认生图模型改为 flash
> - `desktop/src/components/Settings/SettingsModal.tsx`：生图/识图 model 字段改为 Select+自定义 Input
> - `frontend/src/store/configStore.ts`：同步 desktop 的改动（仅生图部分，无识图 tab）
> - `frontend/src/components/Settings/SettingsModal.tsx`：生图 model 字段改为 Select+自定义 Input
> - 8 个 i18n 文件（desktop×4 + frontend×4）：新增 `settings.model.custom` key
> - PR：`feature/model-select-dropdown` → `main`
>
> **Estimated Effort**: Medium
> **Parallel Execution**: YES — 3 waves
> **Critical Path**: i18n → SettingsModal → PR

---

## Context

### Original Request
用户希望将设置页的模型选择从纯文本输入框改为下拉选项，降低输入错误风险：
- 识图模型：预设 `gemini-3-flash-preview`，支持自定义
- 生图模型：预设 `gemini-3-flash-image-preview`（新用户默认）和 `gemini-3-pro-image-preview`，支持自定义
- 会话模型：保持现有输入框，不改
- 走 PR 流程

### 关键决策（已与用户确认）
- **两套代码库都改**：desktop（Tauri 桌面版）和 frontend（Web 版）
- **旧用户迁移策略**：旧用户（已有 localStorage 配置）不动，只有全新用户才默认 flash

### Metis 审查关键发现
- frontend 的 configStore 是 version=9（比 desktop 低），且无识图 tab
- Select 组件已存在（`common/Select.tsx`），直接复用
- 需处理"当前值不在预设列表时 → 自动选中自定义选项"的初始化逻辑
- 旧用户迁移：version 升级时 imageModel 保持原值（旧用户值不动）

---

## Work Objectives

### Core Objective
在不破坏旧用户配置的前提下，把生图/识图的模型选择从自由输入改为「预设下拉 + 自定义输入」。

### Concrete Deliverables
- `desktop/src/store/configStore.ts`：version=12，新用户默认 `gemini-3-flash-image-preview`
- `desktop/src/components/Settings/SettingsModal.tsx`：生图/识图 model 字段改为下拉
- `frontend/src/store/configStore.ts`：version 升级，新用户默认 `gemini-3-flash-image-preview`
- `frontend/src/components/Settings/SettingsModal.tsx`：生图 model 字段改为下拉
- 8 个 i18n locale JSON 文件：新增 `settings.model.custom` 翻译 key

### Definition of Done
- [ ] 新用户打开设置，生图模型下拉默认选中「Flash」
- [ ] 旧用户升级后，已保存的模型值原样保留（不被改动）
- [ ] 当前存储值不在预设列表时，自动选中「自定义」并回填值到 Input
- [ ] 四种语言切换，下拉的「自定义」选项均显示正确文案
- [ ] 会话模型字段未被改动（仍是 Input）
- [ ] `npm run build` 无类型错误

### Must Have
- Select 下拉预设选项（生图：flash + pro；识图：flash-preview）
- 选「自定义」时显示文本 Input，可自由输入任意 model ID
- 自定义值与 Store 实时同步（与其他字段行为一致）
- 自定义值为空时保存校验提示
- 四语言 i18n 完整

### Must NOT Have (Guardrails)
- **不改会话模型（chatModel）的 UI**：保持现有 Input 输入框
- **不改 Base URL / API Key / Timeout 字段**：只改 model 字段
- **不新建 Select 组件**：复用已有的 `common/Select.tsx`
- **不修改已有 i18n key 的翻译文案**：只追加 `custom` key
- **不修改 reset() 函数的默认值**（除非明确要求）
- **不改后端任何文件**
- **不在 migrate 里修改旧用户的 imageModel 值**

---

## Verification Strategy

> **ZERO HUMAN INTERVENTION** — ALL verification is agent-executed.

### Test Decision
- **Infrastructure exists**: NO（无单元测试框架）
- **Automated tests**: None
- **Agent-Executed QA**: Bash + 静态分析验证

### QA Policy
- 静态验证：`npm run build`（TypeScript 类型检查）
- 逻辑验证：通过 grep/读取文件确认关键代码路径
- i18n 完整性：验证 8 个 locale 文件均含 `settings.model.custom`

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (同步执行，互不依赖):
├── Task 1: desktop/configStore.ts — version=12 + 新用户默认值
├── Task 2: frontend/configStore.ts — version 升级 + 新用户默认值
└── Task 3: 8个 i18n 文件 — 新增 custom key

Wave 2 (依赖 Wave 1 完成):
├── Task 4: desktop/SettingsModal.tsx — 生图/识图 model 字段改为下拉
└── Task 5: frontend/SettingsModal.tsx — 生图 model 字段改为下拉

Wave 3 (依赖 Wave 2 完成):
└── Task 6: 创建 feature 分支、commit、push、创建 PR

Critical Path: Task 3 → Task 4 → Task 6
Parallel Speedup: ~50% faster than sequential
```

### Agent Dispatch Summary
- **Wave 1**: 3 tasks → `quick` × 3（并行）
- **Wave 2**: 2 tasks → `visual-engineering` × 2（并行，依赖 Wave 1）
- **Wave 3**: 1 task → `quick` + `git-master`（顺序，依赖 Wave 2）

---

## TODOs

---

- [ ] 1. `desktop/src/store/configStore.ts` — version=12 + 新用户默认生图模型为 flash

  **What to do**:
  - 将 `version: 11` 改为 `version: 12`
  - 将初始 state 中 `imageModel: 'gemini-3-pro-image-preview'` 改为 `imageModel: 'gemini-3-flash-image-preview'`
  - 在 `migrate` 函数末尾新增 `if (version < 12)` 块：**保持 imageModel 原值不变**（旧用户不动，所以这个 block 实际上是 no-op，但要写上以确保 version 正确升级）
  - 新增两个常量（在文件顶部 import 之后）：
    ```typescript
    export const IMAGE_MODEL_OPTIONS = [
      { value: 'gemini-3-flash-image-preview', label: 'Flash (gemini-3-flash-image-preview)' },
      { value: 'gemini-3-pro-image-preview', label: 'Pro (gemini-3-pro-image-preview)' },
    ] as const;

    export const VISION_MODEL_OPTIONS = [
      { value: 'gemini-3-flash-preview', label: 'Flash (gemini-3-flash-preview)' },
    ] as const;

    export const CUSTOM_MODEL_VALUE = '__custom__';
    ```

  **Must NOT do**:
  - 不在 migrate v<12 里修改任何旧用户的 imageModel 值
  - 不改 visionModel / chatModel 的默认值
  - 不改 reset() 函数

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES（Wave 1 与 Task 2、3 同时执行）
  - **Blocks**: Task 4（需要常量）
  - **Blocked By**: None

  **References**:
  - `desktop/src/store/configStore.ts`：完整文件，约 250 行

  **Acceptance Criteria**:
  - [ ] `version: 12` 出现在文件中
  - [ ] `imageModel: 'gemini-3-flash-image-preview'` 是初始 state 默认值
  - [ ] `IMAGE_MODEL_OPTIONS`、`VISION_MODEL_OPTIONS`、`CUSTOM_MODEL_VALUE` 三个常量已导出
  - [ ] `if (version < 12)` migrate 块存在

  **QA Scenarios**:
  ```
  Scenario: 常量已导出（静态验证）
    Tool: Bash
    Steps:
      1. grep -n "IMAGE_MODEL_OPTIONS\|VISION_MODEL_OPTIONS\|CUSTOM_MODEL_VALUE" desktop/src/store/configStore.ts
    Expected Result: 三行均命中，且包含 export 关键字
    Evidence: terminal output

  Scenario: 默认值已改为 flash（静态验证）
    Tool: Bash
    Steps:
      1. grep -n "gemini-3-flash-image-preview" desktop/src/store/configStore.ts
    Expected Result: 至少 2 行命中（初始 state 的 imageModel + options 常量）
    Evidence: terminal output
  ```

  **Commit**: YES（与 Task 2、3 合并为一个 commit）
  - Message: `feat(config): add model preset constants, set flash as default for new users`
  - Files: `desktop/src/store/configStore.ts`

---

- [ ] 2. `frontend/src/store/configStore.ts` — version 升级 + 新用户默认生图模型为 flash

  **What to do**:
  - 先读取文件，确认当前 version 号（预计是 9）
  - 将 version 升一（例如从 9 → 10）
  - 将初始 state 中 imageModel 默认值改为 `'gemini-3-flash-image-preview'`
  - 新增相同的三个常量（`IMAGE_MODEL_OPTIONS`、`VISION_MODEL_OPTIONS`、`CUSTOM_MODEL_VALUE`），与 desktop 保持一致
  - 新增对应版本的 migrate 块（no-op，仅保持 version 升级）
  - **注意**：frontend 无 visionModel，不加 `VISION_MODEL_OPTIONS` 也可，但为了 import 统一建议加上

  **Must NOT do**:
  - 不在 migrate 里修改旧用户的 imageModel
  - 不给 frontend 加 visionModel 字段（frontend 无识图 tab）

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES（与 Task 1、3 同时执行）
  - **Blocks**: Task 5
  - **Blocked By**: None

  **References**:
  - `frontend/src/store/configStore.ts`：读取后确认当前结构

  **Acceptance Criteria**:
  - [ ] version 已升级（比原来大 1）
  - [ ] `imageModel` 初始 state 默认值是 `gemini-3-flash-image-preview`
  - [ ] `IMAGE_MODEL_OPTIONS`、`CUSTOM_MODEL_VALUE` 已导出

  **QA Scenarios**:
  ```
  Scenario: 常量已导出（静态验证）
    Tool: Bash
    Steps:
      1. grep -n "IMAGE_MODEL_OPTIONS\|CUSTOM_MODEL_VALUE" frontend/src/store/configStore.ts
    Expected Result: 命中且包含 export 关键字
    Evidence: terminal output
  ```

  **Commit**: YES（与 Task 1、3 合并）
  - Files: `frontend/src/store/configStore.ts`

---

- [ ] 3. 8个 i18n 文件 — 新增 `settings.model.custom` key

  **What to do**:
  在以下 8 个文件的 `settings.model` 对象里追加 `"custom"` key：
  - `desktop/src/i18n/locales/zh-CN.json` → `"custom": "自定义"`
  - `desktop/src/i18n/locales/en-US.json` → `"custom": "Custom"`
  - `desktop/src/i18n/locales/ja-JP.json` → `"custom": "カスタム"`
  - `desktop/src/i18n/locales/ko-KR.json` → `"custom": "사용자 정의"`
  - `frontend/src/i18n/locales/zh-CN.json` → `"custom": "自定义"`
  - `frontend/src/i18n/locales/en-US.json` → `"custom": "Custom"`
  - `frontend/src/i18n/locales/ja-JP.json` → `"custom": "カスタム"`
  - `frontend/src/i18n/locales/ko-KR.json` → `"custom": "사용자 정의"`

  当前 `settings.model` 结构示例（zh-CN.json）：
  ```json
  "model": {
    "default": "默认模型",
    "chat": "对话模型",
    "vision": "识图模型"
  }
  ```
  追加后：
  ```json
  "model": {
    "default": "默认模型",
    "chat": "对话模型",
    "vision": "识图模型",
    "custom": "自定义"
  }
  ```

  **注意**：frontend 的 zh-CN.json 可能没有 `vision` key，请先读取确认结构，再追加。

  **Must NOT do**:
  - 不修改已有 key 的翻译文案
  - 不改 JSON 文件其他结构

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES（与 Task 1、2 同时执行）
  - **Blocks**: Task 4、5
  - **Blocked By**: None

  **Acceptance Criteria**:
  - [ ] 8 个文件均存在 `"custom"` key

  **QA Scenarios**:
  ```
  Scenario: 所有 i18n 文件均含 custom key（静态验证）
    Tool: Bash
    Steps:
      1. grep -r '"custom"' desktop/src/i18n/locales/ frontend/src/i18n/locales/
    Expected Result: 8 行命中（每个文件各 1 行）
    Evidence: terminal output
  ```

  **Commit**: YES（与 Task 1、2 合并）
  - Files: 8 个 locale JSON 文件

---

- [ ] 4. `desktop/src/components/Settings/SettingsModal.tsx` — 生图/识图 model 字段改为下拉 + 自定义 Input

  **What to do**:

  **前置 import**：在文件顶部已有的 import 中新增：
  ```typescript
  import { IMAGE_MODEL_OPTIONS, VISION_MODEL_OPTIONS, CUSTOM_MODEL_VALUE } from '../../store/configStore';
  ```

  **新增本地 state**（在其他 `useState` 附近）：
  ```typescript
  // 生图模型 Select 的选中值（预设 ID 或 '__custom__'）
  const [imageModelSelect, setImageModelSelect] = useState<string>(() => {
    const isPreset = IMAGE_MODEL_OPTIONS.some(o => o.value === imageModel);
    return isPreset ? imageModel : CUSTOM_MODEL_VALUE;
  });
  // 识图模型 Select 的选中值
  const [visionModelSelect, setVisionModelSelect] = useState<string>(() => {
    const isPreset = VISION_MODEL_OPTIONS.some(o => o.value === visionModel);
    return isPreset ? visionModel : CUSTOM_MODEL_VALUE;
  });
  ```

  **处理 imageModel Select 变化**：
  ```typescript
  const handleImageModelSelectChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    setImageModelSelect(val);
    if (val !== CUSTOM_MODEL_VALUE) {
      setImageModel(val); // 预设值直接写入 Store
    }
    // 自定义时，等用户在 Input 里输入再写入 Store
  };
  ```

  **同理 handleVisionModelSelectChange**（结构相同）。

  **替换「生图 tab → Model Name」字段**（当前约第 869-880 行，找到 `{t('settings.model.default')}` 那个 div）：

  将原来的 `<Input type="text" value={imageModel} ... />` 替换为：
  ```tsx
  {/* Model Select */}
  <Select
    value={imageModelSelect}
    onChange={handleImageModelSelectChange}
    className="h-10 bg-slate-100 text-slate-900 font-bold rounded-2xl text-sm px-5 focus:bg-white border border-slate-200 transition-all shadow-none"
  >
    {IMAGE_MODEL_OPTIONS.map(opt => (
      <option key={opt.value} value={opt.value}>{opt.label}</option>
    ))}
    <option value={CUSTOM_MODEL_VALUE}>{t('settings.model.custom')}</option>
  </Select>
  {imageModelSelect === CUSTOM_MODEL_VALUE && (
    <Input
      type="text"
      value={imageModel}
      onChange={(e) => setImageModel(e.target.value)}
      placeholder="输入自定义模型 ID"
      className="h-10 bg-slate-100 text-slate-900 font-medium rounded-2xl text-sm px-5 focus:bg-white border border-slate-200 transition-all shadow-none mt-2"
    />
  )}
  ```

  **替换「识图 tab → Model」字段**（当前约第 983-995 行，找到 `{t('settings.model.vision')}` 那个 div）：
  结构与生图相同，使用 `VISION_MODEL_OPTIONS`、`visionModelSelect`、`handleVisionModelSelectChange`，Input 绑定 `visionModel`。

  **确保会话模型字段完全不被改动**：chat tab 的 model Input（约第 1101-1108 行）保持原样。

  **Must NOT do**:
  - 不改会话 tab 的任何代码
  - 不改 Provider Select、Base URL、API Key、Timeout 字段
  - 不新建 Select 组件，使用现有的 `common/Select`

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
  - **Skills**: [`frontend-ui-ux`]

  **Parallelization**:
  - **Can Run In Parallel**: YES（与 Task 5 同时执行，Wave 2）
  - **Blocks**: Task 6（PR）
  - **Blocked By**: Task 1（常量）、Task 3（i18n key）

  **References**:
  - `desktop/src/components/Settings/SettingsModal.tsx`：1268 行，重点看第 869-995 行（生图/识图 model 字段）
  - `desktop/src/store/configStore.ts`：`IMAGE_MODEL_OPTIONS`、`VISION_MODEL_OPTIONS`、`CUSTOM_MODEL_VALUE`
  - `desktop/src/components/common/Select.tsx`：现有 Select 组件，确认 props 结构
  - `desktop/src/i18n/locales/zh-CN.json`：`settings.model.custom`

  **Acceptance Criteria**:
  - [ ] 生图 tab 的 model 字段是 Select + 条件 Input，不是纯 Input
  - [ ] 识图 tab 的 model 字段是 Select + 条件 Input，不是纯 Input
  - [ ] 会话 tab 的 model 字段仍是纯 Input
  - [ ] `npm run build`（或 `npx tsc --noEmit`）无类型错误

  **QA Scenarios**:
  ```
  Scenario: 生图 Select 渲染（静态验证）
    Tool: Bash
    Steps:
      1. grep -n "IMAGE_MODEL_OPTIONS\|imageModelSelect" desktop/src/components/Settings/SettingsModal.tsx
    Expected Result: 多行命中，包含 Select 和条件 Input 的渲染逻辑
    Evidence: grep output

  Scenario: 会话模型未被改动（静态验证）
    Tool: Bash
    Steps:
      1. grep -n "chatModel" desktop/src/components/Settings/SettingsModal.tsx
      2. 检查 chatModel 相关行仍是 <Input> 而非 <Select>
    Expected Result: chatModel 仍绑定在 <Input> 上
    Evidence: grep output

  Scenario: TypeScript 编译通过
    Tool: Bash
    Steps:
      1. cd desktop && npx tsc --noEmit
    Expected Result: 无报错输出（exit code 0）
    Evidence: terminal output
  ```

  **Commit**: 不单独 commit（与所有 Wave 2 改动一起提交）
  - 最终 commit message: `feat(ui): model selector dropdown with custom input option`

---

- [ ] 5. `frontend/src/components/Settings/SettingsModal.tsx` — 生图 model 字段改为下拉 + 自定义 Input

  **What to do**:

  先 Read 文件，找到生图 model 字段（搜索 `imageModel` 相关的 `<Input>` 或 `settings.model.default`）。

  改法与 Task 4 完全相同，但只改生图 model（frontend 无识图 tab），使用同样的：
  - `IMAGE_MODEL_OPTIONS`、`CUSTOM_MODEL_VALUE`（从 `../../store/configStore` import）
  - `imageModelSelect` local state
  - `handleImageModelSelectChange` handler
  - Select + 条件 Input 渲染结构

  **Must NOT do**:
  - 不改会话模型（frontend 的 chat model 字段保持 Input）
  - 不给 frontend 加识图 tab 或识图 model 字段

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
  - **Skills**: [`frontend-ui-ux`]

  **Parallelization**:
  - **Can Run In Parallel**: YES（与 Task 4 同时执行）
  - **Blocks**: Task 6
  - **Blocked By**: Task 2、Task 3

  **References**:
  - `frontend/src/components/Settings/SettingsModal.tsx`：找生图 model Input 字段
  - `frontend/src/store/configStore.ts`：`IMAGE_MODEL_OPTIONS`、`CUSTOM_MODEL_VALUE`

  **Acceptance Criteria**:
  - [ ] 生图 model 字段是 Select + 条件 Input
  - [ ] `cd frontend && npx tsc --noEmit` 无类型错误

  **QA Scenarios**:
  ```
  Scenario: TypeScript 编译通过（frontend）
    Tool: Bash
    Steps:
      1. cd frontend && npx tsc --noEmit
    Expected Result: 无报错（exit code 0）
    Evidence: terminal output
  ```

  **Commit**: 与所有改动一起提交
  - Files: `frontend/src/components/Settings/SettingsModal.tsx`

---

- [ ] 6. 创建 feature 分支、commit 所有改动、push、创建 PR

  **What to do**:

  ```bash
  # 1. 从 main 切出新分支
  git checkout main && git pull origin main
  git checkout -b feature/model-select-dropdown

  # 2. 暂存并提交 Wave 1 改动（configStore + i18n）
  git add desktop/src/store/configStore.ts \
          frontend/src/store/configStore.ts \
          desktop/src/i18n/locales/*.json \
          frontend/src/i18n/locales/*.json
  git commit -m "feat(config): add model preset constants, set flash as default for new users"

  # 3. 暂存并提交 Wave 2 改动（SettingsModal）
  git add desktop/src/components/Settings/SettingsModal.tsx \
          frontend/src/components/Settings/SettingsModal.tsx
  git commit -m "feat(ui): model selector dropdown with custom input option"

  # 4. push
  git push origin feature/model-select-dropdown

  # 5. 创建 PR
  gh pr create \
    --title "feat: model selector dropdown with preset options and custom input" \
    --body "$(cat <<'EOF'
  ## 变更类型
  - [x] 新功能 (feat)

  ## 功能描述
  将设置页的生图模型和识图模型从纯文本输入框改为「预设下拉 + 自定义输入」模式。

  ### 生图模型
  - 预设选项：`gemini-3-flash-image-preview`（新用户默认）、`gemini-3-pro-image-preview`
  - 支持「自定义」选项，选中后显示文本输入框

  ### 识图模型（仅 desktop）
  - 预设选项：`gemini-3-flash-preview`
  - 支持「自定义」选项

  ### 会话模型
  - 保持现有输入框，不改

  ## 迁移逻辑
  - **新用户**：生图模型默认为 `gemini-3-flash-image-preview`（更快更便宜）
  - **旧用户**：已保存的模型值原样保留，不被强制更改
  - configStore version: desktop 11→12，frontend 对应版本各升 1

  ## 改动范围
  - `desktop/src/store/configStore.ts`
  - `desktop/src/components/Settings/SettingsModal.tsx`
  - `frontend/src/store/configStore.ts`
  - `frontend/src/components/Settings/SettingsModal.tsx`
  - 8 个 i18n locale 文件（desktop×4 + frontend×4）

  ## 测试情况
  - [x] `desktop: npx tsc --noEmit` 无类型错误
  - [x] `frontend: npx tsc --noEmit` 无类型错误
  - [x] 新用户默认值验证
  - [x] 旧用户值不变验证（静态分析确认 migrate 不改旧值）
  EOF
  )"
  ```

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: [`git-master`]

  **Parallelization**:
  - **Can Run In Parallel**: NO（顺序，依赖所有前置任务）
  - **Blocked By**: Task 4、5

  **Acceptance Criteria**:
  - [ ] `gh pr view` 确认 PR 已创建，state=OPEN
  - [ ] PR 包含两个 commit

  **QA Scenarios**:
  ```
  Scenario: PR 创建成功
    Tool: Bash
    Steps:
      1. gh pr list --head feature/model-select-dropdown
    Expected Result: 列表中有一条 PR，state=OPEN
    Evidence: terminal output
  ```

  **Commit**: YES（本 task 负责执行 commit + push + PR 创建）

---

## Final Verification Wave

- [ ] F1. **代码完整性检查** — `quick`
  读取 `desktop/src/components/Settings/SettingsModal.tsx` 和 `frontend/src/components/Settings/SettingsModal.tsx`，确认：
  1. 生图 model 字段使用 `<Select>` + 条件 `<Input>`，不是纯 Input
  2. 识图 model 字段（desktop only）使用 `<Select>` + 条件 `<Input>`
  3. 会话 model 字段仍是纯 `<Input>`
  4. 8 个 i18n 文件均有 `settings.model.custom`
  Output: `Image Model [SELECT] | Vision Model [SELECT] | Chat Model [INPUT] | i18n [8/8] | VERDICT: APPROVE/REJECT`

- [ ] F2. **TypeScript 编译验证** — `quick`
  ```bash
  cd /Users/daozhang/Trae_AI/文生图前后端/desktop && npx tsc --noEmit
  cd /Users/daozhang/Trae_AI/文生图前后端/frontend && npx tsc --noEmit
  ```
  Output: `Desktop TS [PASS/FAIL] | Frontend TS [PASS/FAIL] | VERDICT`

---

## Commit Strategy
- **Commit 1** (Wave 1 完成后): `feat(config): add model preset constants, set flash as default for new users`
  - Files: `desktop/src/store/configStore.ts`, `frontend/src/store/configStore.ts`, 8×i18n JSON
- **Commit 2** (Wave 2 完成后): `feat(ui): model selector dropdown with custom input option`
  - Files: `desktop/src/components/Settings/SettingsModal.tsx`, `frontend/src/components/Settings/SettingsModal.tsx`

---

## Success Criteria

### Verification Commands
```bash
# 静态验证：常量已导出
grep -n "IMAGE_MODEL_OPTIONS\|CUSTOM_MODEL_VALUE" desktop/src/store/configStore.ts

# 静态验证：i18n 完整
grep -r '"custom"' desktop/src/i18n/locales/ frontend/src/i18n/locales/

# TypeScript 检查
cd desktop && npx tsc --noEmit && echo "Desktop OK"
cd ../frontend && npx tsc --noEmit && echo "Frontend OK"

# PR 状态
gh pr list --head feature/model-select-dropdown
```

### Final Checklist
- [ ] 新用户默认生图模型是 `gemini-3-flash-image-preview`
- [ ] 旧用户 migrate 不改 imageModel
- [ ] 生图/识图 model 字段是 Select + 自定义 Input
- [ ] 会话 model 字段保持 Input 不变
- [ ] 8 个 i18n 文件均有 `custom` 翻译
- [ ] desktop TypeScript 无错误
- [ ] frontend TypeScript 无错误
- [ ] PR 已创建，代码可 Review
