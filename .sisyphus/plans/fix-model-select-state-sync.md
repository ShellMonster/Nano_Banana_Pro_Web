# fix: model select state sync + cleanup empty migrations

## TL;DR

> 修复 PR #13 Code Review 指出的 4 个问题：
> 1. Select 下拉框状态与 imageModel/visionModel 不同步（Major）
> 2. reset() 默认值与初始化默认值不一致（Minor）
> 3. 空的 version migration 块（Minor）

**Deliverables**:
- desktop/src/components/Settings/SettingsModal.tsx — 加 useEffect 同步
- frontend/src/components/Settings/SettingsModal.tsx — 加 useEffect 同步
- desktop/src/store/configStore.ts — 删空 migration 块 + 修 reset 默认值
- frontend/src/store/configStore.ts — 删空 migration 块 + 修 reset 默认值

**Estimated Effort**: Quick
**Parallel Execution**: YES - 2 waves
**Critical Path**: Task 1 & 2 并行 → Task 3 & 4 并行 → Task 5 commit

---

## Context

### 问题来源
PR #13 Code Review（Gemini Code Assist + CodeAnt AI）指出的问题。

### 核心问题说明

**State Sync 问题（Major）**：
`imageModelSelect` / `visionModelSelect` 是本地 UI state，只在组件初始化时设置一次。
当 `imageModel` / `visionModel` 被外部更新（fetchConfigs 加载后端配置、切换 Provider 时），
本地 Select state 不会同步更新，导致下拉框显示旧值。

修复方案：加 useEffect 监听 imageModel/visionModel 变化：
```tsx
useEffect(() => {
  const isPreset = IMAGE_MODEL_OPTIONS.some(o => o.value === imageModel);
  setImageModelSelect(isPreset ? imageModel : CUSTOM_MODEL_VALUE);
}, [imageModel]);
```

**reset 默认值不一致（Minor）**：
- 初始化默认：`imageModel: 'gemini-3-flash-image-preview'`（已改）
- reset() 里：`imageModel: 'gemini-3-pro-image-preview'`（漏改了）
- migrate 里：`imageModel: state.imageModel ?? state.model ?? 'gemini-3-pro-image-preview'`（漏改了）

**空 migration 块（Minor）**：
```ts
if (version < 12) {
  // No changes needed, version bump only
}
// 整个 if 块可以删掉，注释也不需要
```

---

## Work Objectives

### Must Have
- `imageModelSelect` / `visionModelSelect` 随 imageModel/visionModel 变化自动同步
- reset() 中 imageModel 默认值改为 `gemini-3-flash-image-preview`
- 删除空的 migration if 块

### Must NOT Have
- 不改 chatModel 相关逻辑
- 不改 UI 样式
- 不修改已有 i18n

---

## Verification Strategy

- TypeScript 检查：`cd desktop && npm run type-check`
- TypeScript 检查：`cd frontend && npm run type-check`

---

## Execution Strategy

```
Wave 1 (并行):
├── Task 1: desktop/SettingsModal.tsx — 加 useEffect
└── Task 2: frontend/SettingsModal.tsx — 加 useEffect

Wave 2 (并行, Wave 1 后):
├── Task 3: desktop/configStore.ts — 删空块 + 修 reset
└── Task 4: frontend/configStore.ts — 删空块 + 修 reset

Wave 3 (串行):
└── Task 5: typecheck + commit + push
```

---

## TODOs

- [ ] 1. 修复 desktop/SettingsModal.tsx — 加 useEffect 同步 imageModelSelect + visionModelSelect

  **What to do**:
  在第 152 行（`visionModelSelect` useState 结束后）添加两个 useEffect：

  ```tsx
  // 同步 imageModelSelect：当 imageModel 被外部更新时保持下拉框一致
  useEffect(() => {
    const isPreset = IMAGE_MODEL_OPTIONS.some(o => o.value === imageModel);
    setImageModelSelect(isPreset ? imageModel : CUSTOM_MODEL_VALUE);
  }, [imageModel]);

  // 同步 visionModelSelect：当 visionModel 被外部更新时保持下拉框一致
  useEffect(() => {
    const isPreset = VISION_MODEL_OPTIONS.some(o => o.value === visionModel);
    setVisionModelSelect(isPreset ? visionModel : CUSTOM_MODEL_VALUE);
  }, [visionModel]);
  ```

  插入位置：`desktop/src/components/Settings/SettingsModal.tsx`
  - 在第 152 行 `});`（visionModelSelect useState 末尾）之后
  - 在第 153 行 `const repoUrl = ...` 之前

  **Must NOT do**:
  - 不改其他 state 或 handler
  - 不动 chatModel 相关代码

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1（与 Task 2 并行）
  - **Blocks**: Task 5
  - **Blocked By**: None

  **References**:
  - `desktop/src/components/Settings/SettingsModal.tsx:143-152` — imageModelSelect / visionModelSelect useState 位置
  - `desktop/src/store/configStore.ts:6-12` — IMAGE_MODEL_OPTIONS, VISION_MODEL_OPTIONS, CUSTOM_MODEL_VALUE 已导出

  **Acceptance Criteria**:
  - [ ] `npm run type-check` in desktop 通过（exit 0）
  - [ ] 文件中存在两个新 useEffect，依赖分别为 `[imageModel]` 和 `[visionModel]`

---

- [ ] 2. 修复 frontend/SettingsModal.tsx — 加 useEffect 同步 imageModelSelect

  **What to do**:
  在第 124 行（imageModelSelect useState 结束后）添加一个 useEffect：

  ```tsx
  // 同步 imageModelSelect：当 imageModel 被外部更新时保持下拉框一致
  useEffect(() => {
    const isPreset = IMAGE_MODEL_OPTIONS.some(o => o.value === imageModel);
    setImageModelSelect(isPreset ? imageModel : CUSTOM_MODEL_VALUE);
  }, [imageModel]);
  ```

  插入位置：`frontend/src/components/Settings/SettingsModal.tsx`
  - 在第 124 行 `});`（imageModelSelect useState 末尾）之后
  - 在第 125 行 `const imageBaseWarn = ...` 之前

  **Must NOT do**:
  - frontend 没有 visionModel，不要加 visionModelSelect 相关代码
  - 不改 chatModel 相关代码

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1（与 Task 1 并行）
  - **Blocks**: Task 5
  - **Blocked By**: None

  **References**:
  - `frontend/src/components/Settings/SettingsModal.tsx:118-124` — imageModelSelect useState 位置
  - `frontend/src/store/configStore.ts:6-11` — IMAGE_MODEL_OPTIONS, CUSTOM_MODEL_VALUE 已导出

  **Acceptance Criteria**:
  - [ ] `npm run type-check` in frontend 通过（exit 0）
  - [ ] 文件中存在一个新 useEffect，依赖为 `[imageModel]`

---

- [ ] 3. 修复 desktop/configStore.ts — 删空 migration 块 + 修 reset 默认值

  **What to do**:

  **改动 1：删除空的 version < 12 migration 块（第 280-283 行）**
  删除以下代码（包括注释）：
  ```ts
  // 版本 12: 仅版本号升级，无需数据迁移
  if (version < 12) {
    // No changes needed, version bump only
  }
  ```

  **改动 2：修 reset() 中 imageModel 默认值（第 167 行）**
  ```ts
  // 改前
  imageModel: 'gemini-3-pro-image-preview',
  // 改后
  imageModel: 'gemini-3-flash-image-preview',
  ```

  **改动 3：修 migrate 函数中 imageModel fallback（第 206 行）**
  ```ts
  // 改前
  imageModel: state.imageModel ?? state.model ?? 'gemini-3-pro-image-preview',
  // 改后
  imageModel: state.imageModel ?? state.model ?? 'gemini-3-flash-image-preview',
  ```

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2（与 Task 4 并行）
  - **Blocks**: Task 5
  - **Blocked By**: Task 1

  **References**:
  - `desktop/src/store/configStore.ts:165-170` — reset() 函数位置
  - `desktop/src/store/configStore.ts:203-210` — migrate 函数 imageModel 处
  - `desktop/src/store/configStore.ts:280-283` — 空 migration 块位置

  **Acceptance Criteria**:
  - [ ] `npm run type-check` in desktop 通过
  - [ ] 文件中不再含有 `if (version < 12)` 块
  - [ ] reset() 中 imageModel 值为 `gemini-3-flash-image-preview`
  - [ ] migrate 中 imageModel fallback 为 `gemini-3-flash-image-preview`

---

- [ ] 4. 修复 frontend/configStore.ts — 删空 migration 块 + 修 reset 默认值

  **What to do**:

  **改动 1：删除空的 version < 10 migration 块（第 214-218 行）**
  删除以下代码（包括注释）：
  ```ts
  // Version 10: only version bump for frontend
  // (frontend doesn't have vision model, so no vision-related changes)
  if (version < 10) {
    // No changes needed
  }
  ```

  **改动 2：修 reset() 中 imageModel 默认值（第 126 行）**
  ```ts
  // 改前
  imageModel: 'gemini-3-pro-image-preview',
  // 改后
  imageModel: 'gemini-3-flash-image-preview',
  ```

  **改动 3：修 migrate 函数中 imageModel fallback（第 159 行）**
  ```ts
  // 改前
  imageModel: state.imageModel ?? state.model ?? 'gemini-3-pro-image-preview',
  // 改后
  imageModel: state.imageModel ?? state.model ?? 'gemini-3-flash-image-preview',
  ```

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2（与 Task 3 并行）
  - **Blocks**: Task 5
  - **Blocked By**: Task 2

  **References**:
  - `frontend/src/store/configStore.ts:124-128` — reset() 函数位置
  - `frontend/src/store/configStore.ts:156-162` — migrate 函数 imageModel 处
  - `frontend/src/store/configStore.ts:214-218` — 空 migration 块位置

  **Acceptance Criteria**:
  - [ ] `npm run type-check` in frontend 通过
  - [ ] 文件中不再含有 `if (version < 10)` 空块
  - [ ] reset() 中 imageModel 值为 `gemini-3-flash-image-preview`
  - [ ] migrate 中 imageModel fallback 为 `gemini-3-flash-image-preview`

---

- [ ] 5. TypeScript 检查 + commit + push

  **What to do**:
  1. `cd desktop && npm run type-check` — 必须 exit 0
  2. `cd frontend && npm run type-check` — 必须 exit 0
  3. `git add desktop/src/components/Settings/SettingsModal.tsx frontend/src/components/Settings/SettingsModal.tsx desktop/src/store/configStore.ts frontend/src/store/configStore.ts`
  4. `git commit -m "fix(ui): sync model select state on external model changes\n\n- Add useEffect to sync imageModelSelect/visionModelSelect when imageModel/visionModel changes programmatically (e.g. fetchConfigs, provider switch)\n- Fix reset() default imageModel to match initial default (flash)\n- Remove empty version migration blocks for cleaner code"`
  5. `git push`

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Blocked By**: Tasks 1, 2, 3, 4

  **Acceptance Criteria**:
  - [ ] desktop type-check exit 0
  - [ ] frontend type-check exit 0
  - [ ] git push 成功，PR #13 自动触发重新 Code Review

---

## Success Criteria

- [ ] desktop type-check 通过
- [ ] frontend type-check 通过
- [ ] PR #13 push 后 Gemini Code Assist 重新 review，无 Major 问题
