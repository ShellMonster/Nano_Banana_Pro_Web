import React from 'react';
import { PromptInput } from './PromptInput';
import { BatchSettings } from './BatchSettings';
import { ReferenceImageUpload } from './ReferenceImageUpload';
import { Button } from '../common/Button';
import { Wand2, Settings, Sparkles } from 'lucide-react';
import { useConfigStore } from '../../store/configStore';
import { useGenerate } from '../../hooks/useGenerate';
import { useTranslation } from 'react-i18next';

export default function ConfigPanel() {
  const { t } = useTranslation();
  const apiKey = useConfigStore(s => s.imageApiKey);
  const prompt = useConfigStore(s => s.prompt);
  const hasRefImages = useConfigStore(s => s.refFiles.length > 0);
  const { generate } = useGenerate();

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* 第一块：提示词区域 - 占据剩余空间 */}
      <div className="flex-1 min-h-0 px-4 pt-4 pb-3 border-b border-slate-100">
        <PromptInput />
      </div>

      {/* 中间：参考图区域 - 紧贴上方 */}
      <div className="px-4 py-3 border-b border-slate-100 flex-shrink-0">
        <ReferenceImageUpload />
      </div>

      {/* 底部：配置区域 - 固定在底部 */}
      <div className="flex-shrink-0 px-4 py-3">
        <BatchSettings />

        <div className="mt-4">
          {!apiKey && (
            <div className="mb-3 text-xs text-amber-600 bg-amber-50 p-3 rounded-2xl border border-amber-200 flex items-center gap-2">
              <Settings className="w-3 h-3" />
              {t('config.apiKeyHint')}
            </div>
          )}
          <Button
            className="w-full h-14 text-lg bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 shadow-xl shadow-blue-200/50 border-none transition-all duration-300"
            onClick={generate}
            disabled={!apiKey || (!prompt && !hasRefImages)}
          >
            {hasRefImages ? <Sparkles className="w-5 h-5 mr-3" /> : <Wand2 className="w-5 h-5 mr-3" />}
            <span>{hasRefImages ? t('generate.startImg2Img') : t('generate.start')}</span>
          </Button>
        </div>
      </div>
    </div>
  );
}
