import React from 'react';
import { useGenerateStore } from '../../store/generateStore';

export function ProgressBar() {
  const { status, totalCount, completedCount, connectionMode } = useGenerateStore();

  if (status !== 'processing') return null;

  const percentage = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  // 连接状态显示
  const getConnectionStatus = () => {
    switch (connectionMode) {
      case 'websocket':
        return (
          <span className="flex items-center gap-1.5 text-green-600">
            <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
            实时连接
          </span>
        );
      case 'polling':
        return (
          <span className="flex items-center gap-1.5 text-amber-600">
            <span className="w-2 h-2 bg-amber-500 rounded-full animate-pulse"></span>
            轮询模式
          </span>
        );
      default:
        // Bug #14修复：更清晰的描述
        return (
          <span className="flex items-center gap-1.5 text-slate-400">
            <span className="w-2 h-2 bg-slate-300 rounded-full"></span>
            初始化连接...
          </span>
        );
    }
  };

  return (
    <div className="bg-blue-50 border-b border-blue-100 px-6 py-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-blue-600">生成中...</span>
          {getConnectionStatus()}
        </div>
        <span className="text-xs text-blue-600 font-medium">{completedCount} / {totalCount}</span>
      </div>
      <div className="h-2 bg-blue-200 rounded-full overflow-hidden">
        <div
          className="h-full bg-blue-600 rounded-full transition-all duration-300 ease-out"
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}
