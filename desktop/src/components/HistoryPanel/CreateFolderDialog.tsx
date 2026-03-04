import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import { Folder, getFolders, createFolder } from '../../services/folderApi';
import { toast } from '../../store/toastStore';
import { Folder as FolderIcon } from 'lucide-react';

interface CreateFolderDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (folder: Folder) => void;
}

/**
 * CreateFolderDialog 组件 - 创建文件夹弹窗
 * 
 * 功能：
 * - 输入文件夹名称
 * - 检查名称是否已存在（从后端获取现有文件夹列表进行对比）
 * - 创建按钮（禁用状态处理）
 * - 取消按钮
 */
export function CreateFolderDialog({ 
  isOpen, 
  onClose, 
  onSuccess 
}: CreateFolderDialogProps) {
  const { t } = useTranslation();
  
  // 文件夹名称输入状态
  const [folderName, setFolderName] = useState('');
  // 现有文件夹列表（用于检查名称是否重复）
  const [existingFolders, setExistingFolders] = useState<Folder[]>([]);
  // 加载状态
  const [isLoading, setIsLoading] = useState(false);
  // 创建中状态
  const [isCreating, setIsCreating] = useState(false);

  // 加载现有文件夹列表
  const loadExistingFolders = useCallback(async () => {
    setIsLoading(true);
    try {
      const folders = await getFolders();
      setExistingFolders(folders);
    } catch (error) {
      console.error('Failed to load folders:', error);
      toast.error(t('history.folder.loadFailed'));
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  // 弹窗打开时获取现有文件夹列表
  useEffect(() => {
    if (isOpen) {
      loadExistingFolders();
      // 重置输入
      setFolderName('');
    }
  }, [isOpen, loadExistingFolders]);

  // 检查文件夹名称是否已存在
  const isNameExists = useCallback((name: string): boolean => {
    if (!name.trim()) return false;
    return existingFolders.some(
      folder => folder.name.toLowerCase() === name.trim().toLowerCase()
    );
  }, [existingFolders]);

  // 验证输入
  const validationError = React.useMemo(() => {
    const trimmedName = folderName.trim();
    if (!trimmedName) {
      return t('history.folder.nameRequired');
    }
    if (isNameExists(folderName)) {
      return t('history.folder.nameExists');
    }
    return null;
  }, [folderName, isNameExists, t]);

  // 是否可以创建
  const canCreate = !validationError && !isLoading && !isCreating;

  // 处理创建文件夹
  const handleCreate = useCallback(async () => {
    if (!canCreate) return;

    setIsCreating(true);
    try {
      const newFolder = await createFolder({ name: folderName.trim() });
      toast.success(t('history.folder.createSuccess'));
      onSuccess?.(newFolder);
      onClose();
    } catch (error) {
      console.error('Failed to create folder:', error);
      toast.error(t('history.folder.createFailed'));
    } finally {
      setIsCreating(false);
    }
  }, [canCreate, folderName, onClose, onSuccess, t]);

  // 处理输入变化
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setFolderName(e.target.value);
  }, []);

  // 处理键盘事件（回车创建）
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && canCreate) {
      handleCreate();
    }
  }, [canCreate, handleCreate]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('history.folder.create')}
      density="compact"
      className="max-w-md"
    >
      <div className="space-y-6">
        {/* 图标和说明 */}
        <div className="flex items-center gap-4 p-4 bg-blue-50 rounded-2xl">
          <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center flex-shrink-0">
            <FolderIcon className="w-6 h-6 text-blue-600" />
          </div>
          <div className="flex-1">
            <p className="text-sm text-slate-600">
              {t('history.folder.createPlaceholder')}
            </p>
          </div>
        </div>

        {/* 输入框 */}
        <div className="space-y-2">
          <label className="text-sm font-bold text-slate-700">
            {t('history.folder.title')}
          </label>
          <input
            data-onboarding="create-folder-dialog"
            type="text"
            value={folderName}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder={t('history.folder.createPlaceholder')}
            disabled={isCreating}
            className={`
              w-full px-4 py-3 rounded-xl border-2 text-sm font-medium
              transition-all duration-200 outline-none
              ${validationError && folderName.trim()
                ? 'border-red-300 focus:border-red-500 bg-red-50/50'
                : 'border-slate-200 focus:border-blue-500 hover:border-slate-300'
              }
              disabled:bg-slate-100 disabled:cursor-not-allowed
            `}
            autoFocus
          />
          {/* 错误提示 */}
          {validationError && folderName.trim() && (
            <p className="text-xs font-medium text-red-500">
              {validationError}
            </p>
          )}
        </div>

        {/* 按钮组 */}
        <div className="flex items-center justify-end gap-3 pt-2">
          <Button
            data-onboarding="create-folder-dialog-cancel"
            variant="secondary"
            onClick={onClose}
            disabled={isCreating}
          >
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            onClick={handleCreate}
            disabled={!canCreate}
          >
            {isCreating ? (
              <>
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2" />
                {t('common.loading')}
              </>
            ) : (
              t('common.confirm')
            )}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
