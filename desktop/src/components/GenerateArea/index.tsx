import React, { useEffect, useState } from 'react';
import { AlertCircle, X, Sparkles, ImagePlus, Wand2, Loader2 } from 'lucide-react';
import { ProgressBar } from './ProgressBar';
import { ImageGrid } from './ImageGrid';
import { BatchActions } from './BatchActions';
import { ImagePreview } from './ImagePreview';
import { GeneratedImage } from '../../types';
import { useGenerateStore } from '../../store/generateStore';
import { useShallow } from 'zustand/react/shallow';

export default function GenerateArea() {
  const [previewImage, setPreviewImage] = useState<GeneratedImage | null>(null);
  const [isErrorExpanded, setIsErrorExpanded] = useState(false);
  const { error, dismissError, status, images, isSubmitting } = useGenerateStore(
    useShallow((s) => ({
      error: s.error,
      dismissError: s.dismissError,
      status: s.status,
      images: s.images,
      isSubmitting: s.isSubmitting
    }))
  );

  const handleCloseError = () => {
      dismissError();
  };

  useEffect(() => {
    setIsErrorExpanded(false);
  }, [error]);

  const isEmpty = images.length === 0 && status !== 'processing' && status !== 'failed' && !isSubmitting;

  const showErrorToggle = Boolean(error && (error.length > 160 || error.includes('\n')));

  return (
    <div className="flex flex-col h-full bg-white relative">
      {/* 错误提示栏 */}
      {error && status === 'failed' && (
        <div className="bg-red-50 border-b border-red-200 px-4 py-3 flex items-start gap-3 animate-in slide-in-from-top-2">
            <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
                <h3 className="text-sm font-medium text-red-800">生成任务失败</h3>
                <p
                  className={[
                    'text-sm text-red-700 mt-1 break-words',
                    isErrorExpanded ? 'max-h-24 overflow-auto pr-2 whitespace-pre-wrap' : 'line-clamp-2'
                  ].join(' ')}
                >
                  {error}
                </p>
                {showErrorToggle && (
                  <button
                    type="button"
                    onClick={() => setIsErrorExpanded((prev) => !prev)}
                    className="mt-1 text-xs font-medium text-red-600 hover:text-red-700"
                  >
                    {isErrorExpanded ? '收起详情' : '展开详情'}
                  </button>
                )}
            </div>
            <button
                onClick={handleCloseError}
                className="text-red-500 hover:text-red-700 p-1"
            >
                <X className="w-4 h-4" />
            </button>
        </div>
      )}

      <ProgressBar />

      {/* 欢迎引导卡片 - 空状态时显示 */}
      {isEmpty && (
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="text-center max-w-md">
            <div className="w-16 h-16 bg-gradient-to-tr from-blue-100 to-indigo-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Sparkles className="w-8 h-8 text-blue-600" />
            </div>
            <h2 className="text-xl font-bold text-slate-900 mb-2">开始创作你的图片</h2>
            <p className="text-sm text-slate-500 mb-6">
              在左侧配置面板输入提示词，或上传参考图片进行图生图
            </p>

            <div className="grid grid-cols-2 gap-3 text-left">
              <div className="bg-slate-50 rounded-xl p-4 border border-slate-100">
                <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center mb-2">
                  <Wand2 className="w-4 h-4 text-blue-600" />
                </div>
                <h3 className="text-sm font-medium text-slate-900 mb-1">文字生图</h3>
                <p className="text-xs text-slate-500">输入描述生成图片</p>
              </div>

              <div className="bg-slate-50 rounded-xl p-4 border border-slate-100">
                <div className="w-8 h-8 bg-indigo-100 rounded-lg flex items-center justify-center mb-2">
                  <ImagePlus className="w-4 h-4 text-indigo-600" />
                </div>
                <h3 className="text-sm font-medium text-slate-900 mb-1">图生图</h3>
                <p className="text-xs text-slate-500">上传参考图生成</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 提交中状态 */}
      {isSubmitting && images.length === 0 && (
        <div className="flex-1 flex flex-col items-center justify-center p-8 bg-blue-50/20">
          <div className="relative mb-6">
            <div className="absolute inset-0 bg-blue-500/10 rounded-full animate-ping" />
            <div className="w-20 h-20 bg-white rounded-full shadow-sm border border-blue-100 flex items-center justify-center relative z-10">
              <Loader2 className="w-10 h-10 text-blue-500 animate-spin" />
            </div>
          </div>
          <h2 className="text-xl font-bold text-slate-900 mb-2">正在启动生成任务</h2>
          <p className="text-sm text-slate-500">正在与 AI 模型建立连接，请稍候...</p>
        </div>
      )}

      {/* 图片网格 */}
      <div className={`flex-1 min-h-0 relative ${isEmpty ? 'hidden' : ''}`}>
        <ImageGrid onPreview={setPreviewImage} />
      </div>

      <BatchActions />

      <ImagePreview
        image={previewImage}
        images={images}
        onImageChange={setPreviewImage}
        onClose={() => setPreviewImage(null)}
      />
    </div>
  );
}
