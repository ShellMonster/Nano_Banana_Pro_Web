import React from 'react';
import { HistoryItem as HistoryItemType } from '../../types';
import { Trash2 } from 'lucide-react';
import { getImageUrl } from '../../services/api';

interface HistoryItemProps {
  item: HistoryItemType;
  onDelete: (id: string) => void;
}

export function HistoryItem({ item, onDelete }: HistoryItemProps) {
  // 获取第一张图片用于展示
  const firstImage = item.images && item.images.length > 0 ? item.images[0] : null;
  const imageUrl = firstImage ? getImageUrl(firstImage.id) : '';

  return (
    <div className="group flex gap-4 p-4 bg-white rounded-lg border border-gray-100 hover:border-gray-200 hover:shadow-sm transition-all">
      <div className="w-24 h-24 flex-shrink-0 bg-gray-100 rounded-md overflow-hidden relative">
        {imageUrl ? (
            <img 
                src={imageUrl} 
                alt={item.prompt} 
                className="w-full h-full object-cover"
                loading="lazy"
                decoding="async"
            />
        ) : (
            <div className="w-full h-full flex items-center justify-center text-xs text-gray-400 bg-gray-50">
                无图片
            </div>
        )}
        <div className="absolute bottom-0 right-0 bg-black/50 text-white text-[10px] px-1.5 py-0.5 rounded-tl-md">
            {item.completedCount}/{item.totalCount}
        </div>
      </div>
      <div className="flex-1 min-w-0 flex flex-col justify-between py-1">
        <div>
            <p className="text-sm text-gray-900 font-medium line-clamp-2 mb-1">{item.prompt}</p>
            <div className="flex items-center gap-3 text-xs text-gray-500">
                <span>{item.model}</span>
                <span>•</span>
                <span>{new Date(item.createdAt).toLocaleString()}</span>
            </div>
        </div>
        
        <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity justify-end">
             <button 
                onClick={() => onDelete(item.id)}
                className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors"
                title="删除任务"
            >
                <Trash2 className="w-4 h-4" />
             </button>
        </div>
      </div>
    </div>
  );
}
