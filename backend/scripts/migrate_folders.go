package main

import (
	"fmt"
	"log"
	"strconv"
	"time"

	"image-gen-service/internal/model"
)

func main() {
	fmt.Println("========================================")
	fmt.Println("历史数据迁移工具")
	fmt.Println("将未分类的图片自动归类到月份文件夹")
	fmt.Println("========================================\n")

	// 初始化数据库
	model.InitDB("database.db")

	log.Println("开始迁移历史数据到月份文件夹...")

	// 查询所有 folder_id 为空的任务
	var tasks []model.Task
	if err := model.DB.Where("folder_id = ? OR folder_id IS NULL", "").Find(&tasks).Error; err != nil {
		log.Fatalf("查询任务失败: %v", err)
	}

	if len(tasks) == 0 {
		log.Println("✓ 没有需要迁移的任务，所有图片已归类")
		return
	}

	log.Printf("找到 %d 个需要迁移的任务\n", len(tasks))

	// 按月份分组
	monthGroups := make(map[string][]model.Task)
	for _, task := range tasks {
		monthKey := task.CreatedAt.Format("2006-01")
		monthGroups[monthKey] = append(monthGroups[monthKey], task)
	}

	// 处理每个月份
	totalUpdated := 0
	totalFolders := 0

	for monthKey, monthTasks := range monthGroups {
		log.Printf("\n处理月份 %s: %d 个任务", monthKey, len(monthTasks))

		// 解析年月
		t, err := time.Parse("2006-01", monthKey)
		if err != nil {
			log.Printf("  ✗ 解析月份失败 %s: %v", monthKey, err)
			continue
		}

		// 获取或创建月份文件夹
		folder := model.Folder{
			Type:  "month",
			Year:  t.Year(),
			Month: int(t.Month()),
		}

		result := model.DB.Where(&folder).Attrs(model.Folder{
			Name: monthKey,
		}).FirstOrCreate(&folder)

		if result.Error != nil {
			log.Printf("  ✗ 创建文件夹 %s 失败: %v", monthKey, result.Error)
			continue
		}

		if result.RowsAffected > 0 {
			log.Printf("  ✓ 创建新文件夹: %s (ID: %d)", monthKey, folder.ID)
			totalFolders++
		} else {
			log.Printf("  ✓ 使用已有文件夹: %s (ID: %d)", monthKey, folder.ID)
		}

		folderID := strconv.FormatUint(uint64(folder.ID), 10)

		// 批量更新该月份的所有任务
		var taskIDs []uint
		for _, task := range monthTasks {
			taskIDs = append(taskIDs, task.ID)
		}

		if err := model.DB.Model(&model.Task{}).Where("id IN ?", taskIDs).Update("folder_id", folderID).Error; err != nil {
			log.Printf("  ✗ 更新任务失败: %v", err)
			continue
		}

		log.Printf("  ✓ 已更新 %d 个任务", len(monthTasks))
		totalUpdated += len(monthTasks)
	}

	fmt.Println("\n========================================")
	fmt.Printf("迁移完成!\n")
	fmt.Printf("- 新建文件夹: %d 个\n", totalFolders)
	fmt.Printf("- 更新任务: %d 个\n", totalUpdated)
	fmt.Printf("- 涉及月份: %d 个\n", len(monthGroups))
	fmt.Println("========================================")
}
