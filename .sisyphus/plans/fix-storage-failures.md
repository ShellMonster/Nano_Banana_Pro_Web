# 修复图片生成成功但存储/落库失败导致任务失败

## TL;DR

> **Quick Summary**: 修复4个"图片API调用成功但任务最终失败"的Bug：DB更新结果被丢弃、格式识别失败无兜底、choices路径下载失败静默忽略、base64解码失败静默忽略。
>
> **Deliverables**:
> - `backend/internal/worker/pool.go` — DB更新加错误检查
> - `backend/internal/storage/storage.go` — 格式识别失败兜底PNG（LocalStorage + OSSStorage两处）
> - `backend/internal/provider/openai.go` — choices路径下载失败打日志、base64解码失败打日志
>
> **Estimated Effort**: Quick
> **Parallel Execution**: NO — 顺序执行，每个独立commit便于回滚
> **Critical Path**: Task A → Task B → Task C → Task D → Task F

---

## Work Objectives

### Core Objective
修复4个导致"API已扣费但任务状态异常/失败"的Bug，不引入新依赖，不改数据库schema。

### Must NOT Have (Guardrails)
- 不得修改 Task struct / model 文件 / 数据库 migration
- 不得引入新的第三方依赖包
- 不得修改四个目标文件之外的任何文件
- 不得在修复过程中顺手重构无关逻辑

---

## TODOs

- [ ] A. 修复 pool.go：DB更新结果被丢弃

  **问题**: `model.DB.Model(...).Updates(...)` 返回值完全被忽略，DB写入失败时任务状态永远停在 processing。

  **改动位置**: `backend/internal/worker/pool.go`
  - 第207行：成功路径的 `Updates(updates)` — 检查 `.Error`，失败打日志（不能调failTask，图片已存磁盘）
  - 第216行：`failTask` 里的 `Updates(...)` — 检查 `.Error`，失败打日志

  **改动前（第207行）**:
  ```go
  model.DB.Model(task.TaskModel).Updates(updates)
  log.Printf("任务 %s 处理完成", task.TaskModel.TaskID)
  ```

  **改动后（第207行）**:
  ```go
  if dbResult := model.DB.Model(task.TaskModel).Updates(updates); dbResult.Error != nil {
      log.Printf("任务 %s 数据库更新失败（图片文件已保存至磁盘）: %v", task.TaskModel.TaskID, dbResult.Error)
  } else {
      log.Printf("任务 %s 处理完成", task.TaskModel.TaskID)
  }
  ```

  **改动前（failTask 第216行）**:
  ```go
  model.DB.Model(taskModel).Updates(map[string]interface{}{
      "status":        "failed",
      "error_message": err.Error(),
  })
  ```

  **改动后（failTask）**:
  ```go
  if dbResult := model.DB.Model(taskModel).Updates(map[string]interface{}{
      "status":        "failed",
      "error_message": err.Error(),
  }); dbResult.Error != nil {
      log.Printf("任务 %s 写入失败状态到数据库时出错: %v", taskModel.TaskID, dbResult.Error)
  }
  ```

  **Must NOT do**:
  - 成功路径DB失败时不得调 failTask（图片文件已在磁盘，再改状态会造成数据不一致）
  - 不得修改 Updates 的字段内容

  **References**:
  - `backend/internal/worker/pool.go:207` — 成功更新位置
  - `backend/internal/worker/pool.go:214-220` — failTask 函数

  **QA Scenarios**:
  ```
  Scenario: 编译通过
    Tool: Bash
    Steps: cd backend && go build ./...
    Expected Result: exit code 0
    Evidence: .sisyphus/evidence/task-a-build.txt

  Scenario: DB检查代码存在
    Tool: Bash
    Steps: grep -n "数据库更新失败" backend/internal/worker/pool.go
    Expected Result: 至少1行匹配
    Evidence: .sisyphus/evidence/task-a-grep.txt
  ```

  **Commit**: YES
  - Message: `fix(worker): check DB update errors instead of silently discarding them`
  - Files: `backend/internal/worker/pool.go`
  - Pre-commit: `cd backend && go build ./...`

---

- [ ] B. 修复 storage.go：格式识别失败直接报错，改为兜底PNG

  **问题**: `detectImageFormat` 遇到 AVIF 等未知格式返回 `ErrUnknownFormat`，当前逻辑直接 `return error` → `failTask`。图片数据完整，只是格式不认识，任务不应失败。

  **改动位置**: `backend/internal/storage/storage.go`
  - **LocalStorage.SaveWithThumbnail** 第139-145行
  - **OSSStorage.SaveWithThumbnail** 第237-242行

  **改动前（两处相同）**:
  ```go
  format, err := detectImageFormat(data)
  if err != nil {
      return "", "", "", "", 0, 0, fmt.Errorf("检测图片格式失败: %w", err)
  }
  ext := formatToExt(format)
  log.Printf("[Storage] 检测到图片格式: %s, 后缀: %s", format, ext)
  ```

  **改动后（两处相同）**:
  ```go
  format, err := detectImageFormat(data)
  if err != nil {
      // 格式无法识别，兜底按 PNG 保存，原始字节内容不损失
      log.Printf("[Storage] 警告: 图片格式识别失败(%v)，兜底保存为 PNG", err)
      format = "png"
  }
  ext := formatToExt(format)
  log.Printf("[Storage] 检测到图片格式: %s, 后缀: %s", format, ext)
  ```

  注意：OSSStorage 的那处没有最后那行 `log.Printf`，保持和原来一致即可，只加前面的兜底逻辑。

  **Must NOT do**:
  - 不得修改 `detectImageFormat` 函数本身
  - 不得修改 `formatToExt` 函数
  - 不得改动兜底逻辑之外的其他存储流程

  **References**:
  - `backend/internal/storage/storage.go:139-145` — LocalStorage 格式检测位置
  - `backend/internal/storage/storage.go:237-242` — OSSStorage 格式检测位置

  **QA Scenarios**:
  ```
  Scenario: 编译通过
    Tool: Bash
    Steps: cd backend && go build ./...
    Expected Result: exit code 0
    Evidence: .sisyphus/evidence/task-b-build.txt

  Scenario: 兜底逻辑代码存在（两处）
    Tool: Bash
    Steps: grep -n "兜底保存为 PNG" backend/internal/storage/storage.go
    Expected Result: 至少2行匹配（LocalStorage和OSSStorage各一处）
    Evidence: .sisyphus/evidence/task-b-grep.txt
  ```

  **Commit**: YES
  - Message: `fix(storage): fallback to PNG when image format detection fails instead of erroring`
  - Files: `backend/internal/storage/storage.go`
  - Pre-commit: `cd backend && go build ./...`

---

- [ ] C. 修复 openai.go：choices路径下载图片失败静默忽略

  **问题**: `extractImagesFromContent` 里 image_url 类型图片调用 `decodeImageURL` 失败，`if err == nil` 静默跳过，无任何日志，最终 images 为空报"未在响应中找到图片数据"，看不出真实原因。

  **改动位置**: `backend/internal/provider/openai.go`
  - **第265-268行**（`[]interface{}` case 里的循环内）
  - **第277-280行**（`map[string]interface{}` case 里，不在循环内）

  **改动前（第265-268行）**:
  ```go
  imgBytes, err := p.decodeImageURL(ctx, url)
  if err == nil {
      images = append(images, imgBytes)
  }
  ```

  **改动后（第265-268行）**:
  ```go
  imgBytes, err := p.decodeImageURL(ctx, url)
  if err != nil {
      log.Printf("[OpenAI] choices路径下载图片失败，跳过此图: url=%s, err=%v", url, err)
      continue
  }
  images = append(images, imgBytes)
  ```

  **改动前（第277-280行，map case，不在for循环里）**:
  ```go
  imgBytes, err := p.decodeImageURL(ctx, url)
  if err == nil {
      images = append(images, imgBytes)
  }
  ```

  **改动后（第277-280行）**:
  ```go
  imgBytes, err := p.decodeImageURL(ctx, url)
  if err != nil {
      log.Printf("[OpenAI] choices路径下载图片失败: url=%s, err=%v", url, err)
  } else {
      images = append(images, imgBytes)
  }
  ```
  注意：此处不在 for 循环内，不能用 `continue`，改为 if/else 结构。

  **Must NOT do**:
  - 不得修改 `decodeImageURL` 函数本身
  - 不得修改 `extractImagesFromContent` 的函数签名
  - 不得修改两处改动之外的其他逻辑

  **References**:
  - `backend/internal/provider/openai.go:262-271` — []interface{} case 里的 image_url 处理
  - `backend/internal/provider/openai.go:274-283` — map case 里的 image_url 处理

  **QA Scenarios**:
  ```
  Scenario: 编译通过
    Tool: Bash
    Steps: cd backend && go build ./...
    Expected Result: exit code 0
    Evidence: .sisyphus/evidence/task-c-build.txt

  Scenario: 日志代码存在
    Tool: Bash
    Steps: grep -n "choices路径下载图片失败" backend/internal/provider/openai.go
    Expected Result: 至少2行匹配（两处case各一条）
    Evidence: .sisyphus/evidence/task-c-grep.txt
  ```

  **Commit**: YES
  - Message: `fix(openai): log image download failures in choices path instead of silently skipping`
  - Files: `backend/internal/provider/openai.go`
  - Pre-commit: `cd backend && go build ./...`

---

- [ ] D. 修复 openai.go：base64解码失败静默忽略

  **问题**: `extractImagesFromData` 里 base64 解码失败，`if err == nil` 静默跳过，无日志，images 为空后报"未生成任何图片"，跟真实原因完全对不上。

  **改动位置**: `backend/internal/provider/openai.go` 第225-229行

  **改动前**:
  ```go
  imgBytes, err := base64.StdEncoding.DecodeString(b64)
  if err == nil {
      images = append(images, imgBytes)
  }
  continue
  ```

  **改动后**:
  ```go
  imgBytes, err := base64.StdEncoding.DecodeString(b64)
  if err != nil {
      log.Printf("[OpenAI] base64解码失败，跳过此图: err=%v", err)
      continue
  }
  images = append(images, imgBytes)
  continue
  ```

  **Must NOT do**:
  - 不得修改 `extractImagesFromData` 的函数签名
  - 不得改动 b64_json 分支之外的其他逻辑

  **References**:
  - `backend/internal/provider/openai.go:224-229` — b64_json 处理分支

  **QA Scenarios**:
  ```
  Scenario: 编译通过
    Tool: Bash
    Steps: cd backend && go build ./...
    Expected Result: exit code 0
    Evidence: .sisyphus/evidence/task-d-build.txt

  Scenario: 日志代码存在
    Tool: Bash
    Steps: grep -n "base64解码失败" backend/internal/provider/openai.go
    Expected Result: 至少1行匹配
    Evidence: .sisyphus/evidence/task-d-grep.txt
  ```

  **Commit**: YES
  - Message: `fix(openai): log base64 decode failures instead of silently skipping`
  - Files: `backend/internal/provider/openai.go`
  - Pre-commit: `cd backend && go build ./...`

---

- [ ] F. 整体编译 + 修复验证

  ```bash
  cd backend && go build ./...
  # Expected: 无错误

  grep -n "数据库更新失败" backend/internal/worker/pool.go
  # Expected: >=1行

  grep -n "兜底保存为 PNG" backend/internal/storage/storage.go
  # Expected: 2行（LocalStorage + OSSStorage）

  grep -n "choices路径下载图片失败" backend/internal/provider/openai.go
  # Expected: >=2行

  grep -n "base64解码失败" backend/internal/provider/openai.go
  # Expected: >=1行
  ```

  **Commit**: NO（各Task已独立commit）

---

## Success Criteria

- [ ] 整体编译通过
- [ ] pool.go DB更新有错误检查
- [ ] storage.go 格式识别失败兜底PNG（两处）
- [ ] openai.go choices路径下载失败有日志（两处）
- [ ] openai.go base64解码失败有日志
