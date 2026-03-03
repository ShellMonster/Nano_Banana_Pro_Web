package api

import (
	"log"
	"net/http"
	"strconv"
	"time"

	"image-gen-service/internal/model"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// 文件夹类型常量
const (
	FolderTypeManual = "manual" // 手动创建的文件夹
	FolderTypeMonth  = "month"  // 自动创建的月份文件夹
)

// CreateFolderRequest 创建文件夹请求
type CreateFolderRequest struct {
	Name string `json:"name" binding:"required"` // 文件夹名称
}

// CreateFolderHandler 创建手动文件夹
func CreateFolderHandler(c *gin.Context) {
	var req CreateFolderRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		log.Printf("[API] CreateFolder 参数绑定失败: %v\n", err)
		Error(c, http.StatusBadRequest, 400, "参数验证失败: "+err.Error())
		return
	}

	// 检查是否已存在同名文件夹
	var existingFolder model.Folder
	if err := model.DB.Where("name = ? AND type = ?", req.Name, FolderTypeManual).First(&existingFolder).Error; err == nil {
		log.Printf("[API] 创建文件夹失败：已存在同名文件夹 %s\n", req.Name)
		Error(c, http.StatusBadRequest, 400, "已存在同名文件夹")
		return
	}

	// 创建新文件夹
	folder := model.Folder{
		Name: req.Name,
		Type: FolderTypeManual, // 手动创建的文件夹
	}

	if err := model.DB.Create(&folder).Error; err != nil {
		log.Printf("[API] 创建文件夹失败: %v\n", err)
		Error(c, http.StatusInternalServerError, 500, "创建文件夹失败")
		return
	}

	log.Printf("[API] 创建文件夹成功: ID=%d, Name=%s\n", folder.ID, folder.Name)
	Success(c, folder)
}

// GetFoldersHandler 获取所有文件夹
func GetFoldersHandler(c *gin.Context) {
	var folders []model.Folder

	// 按创建时间降序排列
	if err := model.DB.Order("created_at DESC").Find(&folders).Error; err != nil {
		log.Printf("[API] 获取文件夹列表失败: %v\n", err)
		Error(c, http.StatusInternalServerError, 500, "获取文件夹列表失败")
		return
	}

	log.Printf("[API] 获取文件夹列表成功: 共 %d 个文件夹\n", len(folders))
	Success(c, folders)
}

// UpdateFolderRequest 更新文件夹请求
type UpdateFolderRequest struct {
	Name string `json:"name" binding:"required"` // 新的文件夹名称
}

// UpdateFolderHandler 更新文件夹名称
func UpdateFolderHandler(c *gin.Context) {
	folderID := c.Param("id")

	var req UpdateFolderRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		log.Printf("[API] UpdateFolder 参数绑定失败: %v\n", err)
		Error(c, http.StatusBadRequest, 400, "参数验证失败: "+err.Error())
		return
	}

	// 查找文件夹
	var folder model.Folder
	if err := model.DB.Where("id = ?", folderID).First(&folder).Error; err != nil {
		log.Printf("[API] 更新文件夹失败：文件夹不存在 ID=%s\n", folderID)
		Error(c, http.StatusNotFound, 404, "文件夹不存在")
		return
	}

	// 检查是否为月份文件夹（不允许修改）
	if folder.Type == FolderTypeMonth {
		log.Printf("[API] 更新文件夹失败：不允许修改月份文件夹 ID=%s\n", folderID)
		Error(c, http.StatusBadRequest, 400, "不允许修改月份文件夹")
		return
	}

	// 检查是否已存在同名文件夹（排除自己）
	var existingFolder model.Folder
	if err := model.DB.Where("name = ? AND type = ? AND id != ?", req.Name, FolderTypeManual, folderID).First(&existingFolder).Error; err == nil {
		log.Printf("[API] 更新文件夹失败：已存在同名文件夹 %s\n", req.Name)
		Error(c, http.StatusBadRequest, 400, "已存在同名文件夹")
		return
	}

	// 更新文件夹名称
	if err := model.DB.Model(&folder).Update("name", req.Name).Error; err != nil {
		log.Printf("[API] 更新文件夹失败: %v\n", err)
		Error(c, http.StatusInternalServerError, 500, "更新文件夹失败")
		return
	}
	folder.Name = req.Name // 更新内存中的名称，确保返回正确值

	log.Printf("[API] 更新文件夹成功: ID=%s, Name=%s\n", folderID, req.Name)
	Success(c, folder)
}

// DeleteFolderHandler 删除手动文件夹，图片移回月份文件夹
func DeleteFolderHandler(c *gin.Context) {
	folderID := c.Param("id")

	// 查找文件夹
	var folder model.Folder
	if err := model.DB.Where("id = ?", folderID).First(&folder).Error; err != nil {
		log.Printf("[API] 删除文件夹失败：文件夹不存在 ID=%s\n", folderID)
		Error(c, http.StatusNotFound, 404, "文件夹不存在")
		return
	}

	// 检查是否为月份文件夹（不允许删除）
	if folder.Type == FolderTypeMonth {
		log.Printf("[API] 删除文件夹失败：不允许删除月份文件夹 ID=%s\n", folderID)
		Error(c, http.StatusBadRequest, 400, "不允许删除月份文件夹")
		return
	}

	// 查找该文件夹中的所有图片
	var tasks []model.Task
	if err := model.DB.Where("folder_id = ?", folderID).Find(&tasks).Error; err != nil {
		log.Printf("[API] 删除文件夹失败：查询图片失败 %v\n", err)
		Error(c, http.StatusInternalServerError, 500, "查询图片失败")
		return
	}

	// 使用事务包装所有数据库操作
	err := model.DB.Transaction(func(tx *gorm.DB) error {
		// 按月份分组图片，用于批量更新
		monthGroups := make(map[string][]uint)
		for _, task := range tasks {
			monthKey := task.CreatedAt.Format("2006-01")
			monthGroups[monthKey] = append(monthGroups[monthKey], task.ID)
		}

		// 批量更新每个月份的图片
		for monthKey, taskIDs := range monthGroups {
			// 解析年月
			t, err := time.Parse("2006-01", monthKey)
			if err != nil {
				log.Printf("[API] 解析月份失败: %v\n", err)
				continue
			}

			// 获取或创建对应的月份文件夹（使用事务句柄 tx）
			monthFolder, err := getOrCreateMonthFolder(tx, t)
			if err != nil {
				log.Printf("[API] 获取或创建月份文件夹失败: %s, error: %v\n", monthKey, err)
				return err // 返回错误以回滚事务
			}

			// 批量更新该月份的所有图片的 folder_id
			newFolderID := strconv.FormatUint(uint64(monthFolder.ID), 10)
			if err := tx.Model(&model.Task{}).Where("id IN ?", taskIDs).Update("folder_id", newFolderID).Error; err != nil {
				log.Printf("[API] 批量更新图片失败: %v\n", err)
				return err
			}
		}

		// 删除文件夹
		if err := tx.Delete(&folder).Error; err != nil {
			log.Printf("[API] 删除文件夹失败: %v\n", err)
			return err
		}

		return nil
	})

	if err != nil {
		Error(c, http.StatusInternalServerError, 500, "删除文件夹失败")
		return
	}

	log.Printf("[API] 删除文件夹成功: ID=%s, Name=%s, 已移动 %d 张图片\n", folderID, folder.Name, len(tasks))
	Success(c, gin.H{
		"message":        "删除成功",
		"moved_images":   len(tasks),
		"deleted_folder": folder,
	})
}

// getOrCreateMonthFolder 获取或创建自动月份文件夹
// 使用 FirstOrCreate 确保并发安全，接受 db 参数以支持事务
func getOrCreateMonthFolder(db *gorm.DB, t time.Time) (*model.Folder, error) {
	year := t.Year()
	month := int(t.Month())
	folderName := t.Format("2006-01") // 格式: 2024-01

	// 使用 FirstOrCreate 原子性地获取或创建记录
	folder := model.Folder{
		Type:  FolderTypeMonth,
		Year:  year,
		Month: month,
	}

	// Attrs 设置创建时的默认值
	result := db.Where(&model.Folder{
		Type:  FolderTypeMonth,
		Year:  year,
		Month: month,
	}).Attrs(model.Folder{
		Name: folderName,
	}).FirstOrCreate(&folder)

	if result.Error != nil {
		log.Printf("[API] 获取或创建月份文件夹失败: %v\n", result.Error)
		return nil, result.Error
	}

	log.Printf("[API] 获取或创建月份文件夹成功: ID=%d, Name=%s\n", folder.ID, folder.Name)
	return &folder, nil
}

// GetOrCreateMonthFolderHandler 获取或创建自动月份文件夹 API 接口
func GetOrCreateMonthFolderHandler(c *gin.Context) {
	// 使用当前时间
	now := time.Now()
	folder, err := getOrCreateMonthFolder(model.DB, now)

	if err != nil {
		log.Printf("[API] 获取或创建月份文件夹失败: %v\n", err)
		Error(c, http.StatusInternalServerError, 500, "获取或创建月份文件夹失败")
		return
	}

	log.Printf("[API] 获取或创建月份文件夹成功: ID=%d, Name=%s\n", folder.ID, folder.Name)
	Success(c, folder)
}

// MoveImageRequest 移动图片请求
type MoveImageRequest struct {
	TaskID   string `json:"task_id" binding:"required"`   // 图片任务 ID
	FolderID string `json:"folder_id" binding:"required"` // 目标文件夹 ID
}

// MoveImageHandler 移动图片到指定文件夹
func MoveImageHandler(c *gin.Context) {
	var req MoveImageRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		log.Printf("[API] MoveImage 参数绑定失败: %v\n", err)
		Error(c, http.StatusBadRequest, 400, "参数验证失败: "+err.Error())
		return
	}

	// 查找图片任务
	var task model.Task
	if err := model.DB.Where("task_id = ?", req.TaskID).First(&task).Error; err != nil {
		log.Printf("[API] 移动图片失败：图片不存在 TaskID=%s\n", req.TaskID)
		Error(c, http.StatusNotFound, 404, "图片不存在")
		return
	}

	// 查找目标文件夹
	var folder model.Folder
	if err := model.DB.Where("id = ?", req.FolderID).First(&folder).Error; err != nil {
		log.Printf("[API] 移动图片失败：目标文件夹不存在 FolderID=%s\n", req.FolderID)
		Error(c, http.StatusNotFound, 404, "目标文件夹不存在")
		return
	}

	// 更新图片的 folder_id
	if err := model.DB.Model(&task).Update("folder_id", req.FolderID).Error; err != nil {
		log.Printf("[API] 移动图片失败: %v\n", err)
		Error(c, http.StatusInternalServerError, 500, "移动图片失败")
		return
	}
	task.FolderID = req.FolderID // 更新内存中的 FolderID，确保返回正确值

	log.Printf("[API] 移动图片成功: TaskID=%s, FolderID=%s\n", req.TaskID, req.FolderID)
	Success(c, gin.H{
		"message": "移动成功",
		"task":    task,
		"folder":  folder,
	})
}
