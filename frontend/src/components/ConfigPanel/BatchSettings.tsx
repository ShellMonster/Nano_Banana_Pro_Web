import React from 'react';
import { Settings2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useConfigStore } from '../../store/configStore';
import { Select } from '../common/Select';
import { Input } from '../common/Input';

export function BatchSettings() {
  const { t } = useTranslation();
  const { count, setCount, imageSize, setImageSize, aspectRatio, setAspectRatio } = useConfigStore();

  return (
    <div className="space-y-3">
        <div className="flex items-center gap-2 text-gray-900 font-medium">
            <Settings2 className="w-4 h-4" />
            <span>{t('config.batch.title')}</span>
        </div>

        <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
                <label className="text-xs text-gray-500">{t('config.batch.count')}</label>
                <Input
                    type="number"
                    min={1}
                    max={10}
                    value={count}
                    onChange={(e) => {
                        const value = Number(e.target.value);
                        // 限制在 1-10 范围内
                        const clampedValue = Math.max(1, Math.min(10, value || 1));
                        setCount(clampedValue);
                    }}
                    className="h-9 text-sm"
                />
            </div>
            <div className="space-y-1">
                <label className="text-xs text-gray-500">{t('config.batch.resolution')}</label>
                <Select value={imageSize} onChange={(e) => setImageSize(e.target.value)} className="h-9 text-sm">
                    <option value="1K">{t('config.batch.resolution1k')}</option>
                    <option value="2K">{t('config.batch.resolution2k')}</option>
                    <option value="4K">{t('config.batch.resolution4k')}</option>
                </Select>
            </div>
        </div>

        <div className="space-y-1">
            <label className="text-xs text-gray-500">{t('config.batch.aspectRatio')}</label>
             <Select value={aspectRatio} onChange={(e) => setAspectRatio(e.target.value)} className="h-9 text-sm">
                <option value="1:1">{t('config.batch.ratio.1_1')}</option>
                <option value="2:3">{t('config.batch.ratio.2_3')}</option>
                <option value="3:2">{t('config.batch.ratio.3_2')}</option>
                <option value="3:4">{t('config.batch.ratio.3_4')}</option>
                <option value="4:3">{t('config.batch.ratio.4_3')}</option>
                <option value="4:5">{t('config.batch.ratio.4_5')}</option>
                <option value="5:4">{t('config.batch.ratio.5_4')}</option>
                <option value="9:16">{t('config.batch.ratio.9_16')}</option>
                <option value="16:9">{t('config.batch.ratio.16_9')}</option>
                <option value="21:9">{t('config.batch.ratio.21_9')}</option>
            </Select>
        </div>
    </div>
  );
}
