import React, { useState, useRef, useEffect } from 'react';
import { CheckSquare, Square, Download, Trash2, Loader2 } from 'lucide-react';
import { useGenerateStore } from '../../store/generateStore';
import { Button } from '../common/Button';
import { exportImages } from '../../services/historyApi';
import { toast } from '../../store/toastStore';
import { useTranslation } from 'react-i18next';

export function BatchActions() {
  const { t } = useTranslation();
  const { images, selectedIds, selectAll, clearSelection, clearImages } = useGenerateStore();
  const [isExporting, setIsExporting] = useState(false);
  const objectUrlRef = useRef<string | null>(null);  // 记录 ObjectURL

  // 清空列表的确认状态
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const clearConfirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 组件卸载时清理 ObjectURL 和定时器
  useEffect(() => {
    return () => {
      if (objectUrlRef.current) {
        window.URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
      if (clearConfirmTimerRef.current) {
        clearTimeout(clearConfirmTimerRef.current);
      }
    };
  }, []);

  if (images.length === 0) return null;

  const allSelected = images.length > 0 && selectedIds.size === images.length;
  const hasSelection = selectedIds.size > 0;

  // 处理清空列表
  const handleClearImages = () => {
    if (showClearConfirm) {
      // 确认清空
      clearImages();
      toast.success(t('generate.batch.clearSuccess'));
      setShowClearConfirm(false);
    } else {
      // 显示确认状态
      setShowClearConfirm(true);
      if (clearConfirmTimerRef.current) {
        clearTimeout(clearConfirmTimerRef.current);
      }
      clearConfirmTimerRef.current = setTimeout(() => setShowClearConfirm(false), 3000);
    }
  };

  const handleExport = async () => {
      if (selectedIds.size === 0) return;
      setIsExporting(true);
      try {
          const { blob, partial } = await exportImages(Array.from(selectedIds));

          // 检查响应类型
          if (blob.type === 'application/json' || blob.type === 'text/plain') {
              // 后端返回了错误 JSON/文本 而不是文件
              // 使用 Promise 包装 FileReader 避免 return 导致 finally 不执行
              const errorText = await new Promise<string>((resolve, reject) => {
                  const reader = new FileReader();
                  reader.onload = () => resolve(reader.result as string);
                  reader.onerror = () => reject(new Error(t('generate.batch.readError')));
                  reader.readAsText(blob);
              });

              try {
                  const errorRes = JSON.parse(errorText);
                  toast.error(errorRes.message || t('generate.batch.exportFailed'));
              } catch (parseError) {
                  // 不是 JSON，显示文本内容
                  toast.error(errorText || t('generate.batch.exportFailedServer'));
              }
              return;
          }

          // 清理之前的 ObjectURL
          if (objectUrlRef.current) {
              window.URL.revokeObjectURL(objectUrlRef.current);
          }

          const url = window.URL.createObjectURL(blob);
          objectUrlRef.current = url;  // 保存 URL 引用

          const a = document.createElement('a');
          a.href = url;
          a.download = `images-${Date.now()}.zip`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);

          // 添加成功提示
          if (partial) {
              toast.info(t('generate.batch.exportPartial'));
          } else {
              toast.success(t('generate.batch.exported', { count: selectedIds.size }));
          }
      } catch (error) {
          console.error('Export failed:', error);

          // 更详细的错误处理
          let errorMessage = t('generate.batch.exportFailedRetry');
          if (error instanceof Error) {
              if (error.message.includes('Network Error')) {
                  errorMessage = t('generate.batch.networkError');
              } else if (error.message.includes('timeout')) {
                  errorMessage = t('generate.batch.timeout');
              } else if (error.message.includes('404')) {
                  errorMessage = t('generate.batch.serviceUnavailable');
              } else if (error.message.includes('500')) {
                  errorMessage = t('generate.batch.serverError');
              } else {
                  errorMessage = error.message || errorMessage;
              }
          }
          toast.error(errorMessage);
      } finally {
          setIsExporting(false);
      }
  };

  return (
    <div className="bg-white border-t border-gray-200 p-4 flex items-center justify-between">
      <div className="flex items-center gap-2">
        <Button 
            variant="ghost" 
            size="sm" 
            onClick={allSelected ? clearSelection : selectAll}
            className="text-gray-600"
        >
          {allSelected ? <CheckSquare className="w-4 h-4 mr-2" /> : <Square className="w-4 h-4 mr-2" />}
          {allSelected ? t('generate.batch.clearSelection') : t('generate.batch.selectAll')}
        </Button>
        <span className="text-sm text-gray-500 ml-2">
            {t('generate.batch.selectedCount', { count: selectedIds.size })}
        </span>
      </div>

      <div className="flex items-center gap-2">
        <Button 
            variant="secondary" 
            size="sm" 
            onClick={handleExport}
            disabled={!hasSelection || isExporting}
            className="text-blue-600 border-blue-200 hover:bg-blue-50"
        >
          {isExporting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
          {isExporting ? t('generate.batch.exporting') : t('generate.batch.exportSelected')}
        </Button>
        <Button
            variant="ghost"
            size="sm"
            onClick={handleClearImages}
            className={showClearConfirm
                ? 'bg-red-600 text-white hover:bg-red-700'
                : 'text-red-600 hover:bg-red-50 hover:text-red-700'
            }
        >
          <Trash2 className="w-4 h-4 mr-2" />
          {showClearConfirm ? t('generate.batch.clearConfirm') : t('generate.batch.clearList')}
        </Button>
      </div>
    </div>
  );
}
