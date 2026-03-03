import React from 'react';
import { useTranslation } from 'react-i18next';
import { Folder as FolderIcon } from 'lucide-react';
import { Folder } from '../../services/folderApi';

interface FolderCardProps {
  folder: Folder;
  imageCount: number;
  coverImage?: string;
  onClick: () => void;
}

/**
 * FolderCard 组件 - 文件夹卡片
 * 
 * 展示文件夹封面、名称、图片数量。
 * 样式参考 ImageCard.tsx，使用类似的视觉风格。
 */
export const FolderCard = React.memo(function FolderCard({ 
  folder, 
  imageCount, 
  coverImage, 
  onClick 
}: FolderCardProps) {
  const { t } = useTranslation();

  return (
    <div 
      className="group cursor-pointer rounded-xl overflow-hidden bg-white border border-gray-100 shadow-sm hover:shadow-md transition-all h-full flex flex-col"
      onClick={onClick}
    >
      {/* 封面图区域 - 正方形裁剪 */}
      <div className="relative w-full aspect-square bg-gray-100 overflow-hidden">
        {coverImage ? (
          <img 
            src={coverImage} 
            alt={folder.name}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            loading="lazy"
            decoding="async"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-400 bg-gradient-to-br from-gray-50 to-gray-100">
            <FolderIcon className="w-16 h-16" />
          </div>
        )}
        {/* 悬停遮罩 */}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors pointer-events-none" />
        
        {/* 图片数量徽章 */}
        <div className="absolute bottom-2 right-2 bg-black/60 backdrop-blur-sm text-white text-xs px-2 py-1 rounded-full font-medium">
          {imageCount} {t('history.folder.imageCount')}
        </div>
      </div>
      
      {/* 文件夹信息 */}
      <div className="p-3 flex flex-col gap-1.5 flex-shrink-0">
        <h3 className="font-medium text-gray-900 truncate" title={folder.name}>
          {folder.name}
        </h3>
        <p className="text-xs text-gray-500">
          {folder.type === 'month' 
            ? t('history.folder.typeMonth') 
            : t('history.folder.typeManual')
          }
        </p>
      </div>
    </div>
  );
});

export default FolderCard;
