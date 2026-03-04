import { useMemo, useEffect } from 'react';
import { Settings2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useConfigStore, getModelAspectRatios } from '../../store/configStore';
import { Select } from '../common/Select';
import { Input } from '../common/Input';
import { toast } from '../../store/toastStore';

export function BatchSettings() {
  const { t } = useTranslation();
  const { count, setCount, imageSize, setImageSize, aspectRatio, setAspectRatio, imageModel } = useConfigStore();

  const supportedRatios = useMemo(() => getModelAspectRatios(imageModel), [imageModel]);

  useEffect(() => {
    if (supportedRatios.length > 0 && !supportedRatios.includes(aspectRatio)) {
      const newRatio = supportedRatios[0];
      setAspectRatio(newRatio);
      toast.info(t('config.batch.ratioAutoAdjusted', { from: aspectRatio, to: newRatio }));
    }
  }, [imageModel, aspectRatio, setAspectRatio, supportedRatios, t]);

  return (
    <div className="space-y-3" data-onboarding="resolution-ratio">
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
                {supportedRatios.map((ratio) => {
                  const key = ratio.replace(':', '_');
                  const labelKey = `config.batch.ratio.${key}`;
                  const label = t(labelKey, { defaultValue: ratio });
                  return (
                    <option key={ratio} value={ratio}>
                      {label}
                    </option>
                  );
                })}
            </Select>
        </div>
    </div>
  );
}