import React from 'react';
import { Clock, Folder } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * ViewToggle 组件 - 历史记录视图切换器
 * 
 * 用于在时间线视图和相册视图之间切换显示方式。
 * 这是一个受控组件，状态由 historyStore 统一管理。
 * 
 * 设计特点：
 * - 采用胶囊式切换按钮设计，符合 shadcn/ui 风格
 * - 激活状态使用白色背景和阴影，未激活状态使用透明背景
 * - 支持 hover 状态反馈
 * - 使用图标增强视觉识别
 */

// 工具函数：合并 tailwind 类名
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// 视图模式类型定义
type ViewMode = 'timeline' | 'album';

// ViewToggle 组件属性接口
interface ViewToggleProps {
  /** 当前选中的视图模式 */
  viewMode: ViewMode;
  /** 切换视图模式的回调函数 */
  onChange: (mode: ViewMode) => void;
}

/**
 * ViewToggle 切换按钮组件
 * 
 * @param viewMode - 当前激活的视图模式
 * @param onChange - 视图切换回调
 * 
 * 使用示例：
 * ```tsx
 * <ViewToggle 
 *   viewMode={viewMode} 
 *   onChange={setViewMode} 
 * />
 * ```
 */
export function ViewToggle({ viewMode, onChange }: ViewToggleProps) {
  const { t } = useTranslation();

  return (
    // 外层容器：使用 slate-100 背景，圆角胶囊式设计
    <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg">
      {/* 时间线视图按钮 */}
      <button
        onClick={() => onChange('timeline')}
        className={cn(
          // 基础样式：弹性布局，固定内边距，圆角，过渡动画
          "flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-all",
          // 激活状态：白色背景、深色文字、轻微阴影
          viewMode === 'timeline'
            ? "bg-white text-slate-900 shadow-sm"
            // 未激活状态：灰色文字、hover 变深
            : "text-slate-600 hover:text-slate-900"
        )}
        aria-pressed={viewMode === 'timeline'}
        aria-label={t('history.viewMode.timeline')}
      >
        {/* 时钟图标：表示按时间排序 */}
        <Clock className="w-4 h-4" />
        {/* 时间线文本标签 */}
        <span>{t('history.viewMode.timeline')}</span>
      </button>

      {/* 相册视图按钮 */}
      <button
        onClick={() => onChange('album')}
        className={cn(
          // 基础样式：与时间线按钮保持一致
          "flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-all",
          // 激活状态样式
          viewMode === 'album'
            ? "bg-white text-slate-900 shadow-sm"
            // 未激活状态样式
            : "text-slate-600 hover:text-slate-900"
        )}
        aria-pressed={viewMode === 'album'}
        aria-label={t('history.viewMode.album')}
      >
        {/* 文件夹图标：表示按文件夹/相册组织 */}
        <Folder className="w-4 h-4" />
        {/* 相册文本标签 */}
        <span>{t('history.viewMode.album')}</span>
      </button>
    </div>
  );
}

// 默认导出
export default ViewToggle;
