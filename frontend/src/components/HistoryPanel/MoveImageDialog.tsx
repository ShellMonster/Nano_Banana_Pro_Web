import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import { Folder, getFolders, moveImageToFolder } from '../../services/folderApi';
import { toast } from '../../store/toastStore';
import { Folder as FolderIcon, FolderOpen, Image } from 'lucide-react';

interface MoveImageDialogProps {
  isOpen: boolean;
  onClose: () => void;
  taskId: string;
  onSuccess?: () => void;
}

export function MoveImageDialog({ 
  isOpen, 
  onClose, 
  taskId,
  onSuccess 
}: MoveImageDialogProps) {
  const { t } = useTranslation();
  
  const [folders, setFolders] = useState<Folder[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isMoving, setIsMoving] = useState(false);

  const loadFolders = useCallback(async () => {
    setIsLoading(true);
    try {
      const folderList = await getFolders();
      setFolders(folderList);
    } catch (error) {
      console.error('Failed to load folders:', error);
      toast.error(t('history.folder.loadFailed'));
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (isOpen) {
      void loadFolders();
      setSelectedFolderId(null);
    }
  }, [isOpen, loadFolders]);

  const handleSelectFolder = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    const folderId = event.currentTarget.dataset.folderId;
    if (folderId) {
      setSelectedFolderId(Number(folderId));
    }
  }, []);

  const handleMove = useCallback(async () => {
    if (selectedFolderId === null || !taskId) return;

    setIsMoving(true);
    try {
      await moveImageToFolder({ 
        task_id: taskId, 
        folder_id: String(selectedFolderId)
      });
      toast.success(t('history.folder.moveSuccess'));
      onSuccess?.();
      onClose();
    } catch (error) {
      console.error('Failed to move image:', error);
      toast.error(t('history.folder.moveFailed'));
    } finally {
      setIsMoving(false);
    }
  }, [selectedFolderId, taskId, onClose, onSuccess, t]);

  const canMove = selectedFolderId !== null && !isLoading && !isMoving && !!taskId;

  const getFolderIcon = useCallback((folder: Folder) => {
    const isSelected = selectedFolderId === folder.id;
    if (isSelected) {
      return <FolderOpen className="w-6 h-6 text-blue-600" />;
    }
    return <FolderIcon className="w-6 h-6 text-slate-400" />;
  }, [selectedFolderId]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('history.folder.moveImage')}
      density="compact"
      className="max-w-md"
    >
      <div className="space-y-5">
        <div className="flex items-center gap-4 p-4 bg-amber-50 rounded-2xl">
          <div className="w-12 h-12 bg-amber-100 rounded-xl flex items-center justify-center flex-shrink-0">
            <Image className="w-6 h-6 text-amber-600" />
          </div>
          <div className="flex-1">
            <p className="text-sm text-slate-600">
              {t('history.folder.selectFolder')}
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-bold text-slate-700">
            {t('history.folder.title')}
          </label>
          
          <div className="max-h-64 overflow-y-auto space-y-2 pr-1">
            {isLoading ? (
              <div className="flex items-center justify-center py-8 text-slate-400">
                <div className="w-5 h-5 border-2 border-slate-300 border-t-blue-500 rounded-full animate-spin mr-2" />
                <span className="text-sm">{t('common.loading')}</span>
              </div>
            ) : folders.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-slate-400">
                <FolderIcon className="w-12 h-12 mb-2 opacity-30" />
                <p className="text-sm">{t('history.folder.empty')}</p>
              </div>
            ) : (
              folders.map((folder) => {
                const isSelected = selectedFolderId === folder.id;
                return (
                  <button
                    key={folder.id}
                    data-folder-id={folder.id}
                    onClick={handleSelectFolder}
                    disabled={isMoving}
                    className={`
                      w-full flex items-center gap-3 p-3 rounded-xl text-left
                      transition-all duration-200
                      ${isSelected 
                        ? 'bg-blue-50 border-2 border-blue-500 shadow-sm' 
                        : 'bg-white border-2 border-transparent hover:bg-slate-50 hover:border-slate-200'
                      }
                      disabled:opacity-50 disabled:cursor-not-allowed
                    `}
                  >
                    <div className={`
                      w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0
                      ${isSelected ? 'bg-blue-100' : 'bg-slate-100'}
                    `}>
                      {getFolderIcon(folder)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`
                        font-medium truncate
                        ${isSelected ? 'text-blue-900' : 'text-slate-900'}
                      `}>
                        {folder.name}
                      </p>
                      <p className="text-xs text-slate-500">
                        {folder.type === 'month' 
                          ? t('history.folder.typeMonth') 
                          : t('history.folder.typeManual')
                        }
                      </p>
                    </div>
                    
                    {isSelected && (
                      <div className="w-5 h-5 bg-blue-500 rounded-full flex items-center justify-center flex-shrink-0">
                        <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                      </div>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 pt-2">
          <Button
            variant="secondary"
            onClick={onClose}
            disabled={isMoving}
          >
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            onClick={handleMove}
            disabled={!canMove}
          >
            {isMoving ? (
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

export default MoveImageDialog;
