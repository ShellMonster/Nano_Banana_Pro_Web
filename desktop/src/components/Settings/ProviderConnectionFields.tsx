import React from 'react';
import { Eye, EyeOff, Globe, Key } from 'lucide-react';
import { Input } from '../common/Input';

interface ProviderConnectionFieldsProps {
  baseUrl: string;
  onBaseUrlChange: (value: string) => void;
  baseUrlPlaceholder: string;
  apiKey: string;
  onApiKeyChange: (value: string) => void;
  apiKeyPlaceholder: string;
  showApiKey: boolean;
  onToggleApiKey: () => void;
  recommendedLabel: string;
  yunwuLabel: string;
  onOpenYunwu: () => void;
  warning?: React.ReactNode;
  baseUrlHint?: React.ReactNode;
  apiKeyHint?: React.ReactNode;
}

export function ProviderConnectionFields({
  baseUrl,
  onBaseUrlChange,
  baseUrlPlaceholder,
  apiKey,
  onApiKeyChange,
  apiKeyPlaceholder,
  showApiKey,
  onToggleApiKey,
  recommendedLabel,
  yunwuLabel,
  onOpenYunwu,
  warning,
  baseUrlHint,
  apiKeyHint
}: ProviderConnectionFieldsProps) {
  return (
    <>
      <div className="space-y-3">
        <div className="flex items-center justify-between px-1">
          <label className="text-[13px] font-bold text-slate-700 uppercase tracking-wide flex items-center gap-2">
            <Globe className="w-4 h-4 text-blue-600" />
            Base URL
          </label>
          <span className="text-xs text-slate-500">
            {recommendedLabel}
            <button
              type="button"
              onClick={onOpenYunwu}
              className="text-blue-600 hover:text-blue-700 underline underline-offset-2"
            >
              {yunwuLabel}
            </button>
          </span>
        </div>
        <Input
          type="text"
          value={baseUrl || ''}
          onChange={(e) => onBaseUrlChange(e.target.value)}
          placeholder={baseUrlPlaceholder}
          className="h-10 bg-slate-100 text-slate-900 font-medium rounded-2xl text-sm px-5 focus:bg-white border border-slate-200 transition-all shadow-none"
        />
        {warning}
        {baseUrlHint}
      </div>

      <div className="space-y-3">
        <label className="text-[13px] font-bold text-slate-700 uppercase tracking-wide flex items-center gap-2 px-1">
          <Key className="w-4 h-4 text-blue-600" />
          API Key
        </label>
        <div className="relative">
          <Input
            type={showApiKey ? 'text' : 'password'}
            value={apiKey || ''}
            onChange={(e) => onApiKeyChange(e.target.value)}
            placeholder={apiKeyPlaceholder}
            className="h-10 bg-slate-100 text-slate-900 font-medium rounded-2xl text-sm px-5 pr-14 focus:bg-white border border-slate-200 transition-all shadow-none"
          />
          <button
            type="button"
            onClick={onToggleApiKey}
            className="absolute right-3.5 top-1/2 -translate-y-1/2 p-2 text-slate-500 hover:text-blue-600 transition-colors bg-white/80 rounded-xl shadow-sm"
          >
            {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
        {apiKeyHint}
      </div>
    </>
  );
}
