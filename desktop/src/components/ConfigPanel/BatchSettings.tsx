import { useMemo, useEffect } from 'react';
import { Settings2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  useConfigStore,
  getModelAspectRatios,
  usesNativeImageSize,
  DALLE3_SIZE_OPTIONS,
  DALLE3_QUALITY_OPTIONS,
  DALLE3_STYLE_OPTIONS
} from '../../store/configStore';
import { Select } from '../common/Select';
import { Input } from '../common/Input';
import { toast } from '../../store/toastStore';

export function BatchSettings() {
  const { t } = useTranslation();
  const {
    count,
    setCount,
    imageSize,
    setImageSize,
    aspectRatio,
    setAspectRatio,
    imageModel,
    imageNativeSize,
    setImageNativeSize,
    imageQuality,
    setImageQuality,
    imageStyle,
    setImageStyle
  } = useConfigStore();

  const supportedRatios = useMemo(() => getModelAspectRatios(imageModel), [imageModel]);
  const useDalle3Controls = usesNativeImageSize(imageModel);

  useEffect(() => {
    if (useDalle3Controls) {
      return;
    }
    if (supportedRatios.length > 0 && !supportedRatios.includes(aspectRatio)) {
      const newRatio = supportedRatios[0];
      setAspectRatio(newRatio);
      toast.info(t('config.batch.ratioAutoAdjusted', { from: aspectRatio, to: newRatio }));
    }
  }, [useDalle3Controls, imageModel, aspectRatio, setAspectRatio, supportedRatios, t]);

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
                <label className="text-xs text-gray-500">
                  {useDalle3Controls ? t('config.batch.nativeSize') : t('config.batch.resolution')}
                </label>
                {useDalle3Controls ? (
                  <Select value={imageNativeSize} onChange={(e) => setImageNativeSize(e.target.value)} className="h-9 text-sm">
                    {DALLE3_SIZE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </Select>
                ) : (
                  <Select value={imageSize} onChange={(e) => setImageSize(e.target.value)} className="h-9 text-sm">
                      <option value="1K">{t('config.batch.resolution1k')}</option>
                      <option value="2K">{t('config.batch.resolution2k')}</option>
                      <option value="4K">{t('config.batch.resolution4k')}</option>
                  </Select>
                )}
            </div>
        </div>

        {useDalle3Controls ? (
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-gray-500">{t('config.batch.quality')}</label>
              <Select value={imageQuality} onChange={(e) => setImageQuality(e.target.value)} className="h-9 text-sm">
                {DALLE3_QUALITY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-gray-500">{t('config.batch.style')}</label>
              <Select value={imageStyle} onChange={(e) => setImageStyle(e.target.value)} className="h-9 text-sm">
                {DALLE3_STYLE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </Select>
            </div>
          </div>
        ) : (
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
        )}
    </div>
  );
}
