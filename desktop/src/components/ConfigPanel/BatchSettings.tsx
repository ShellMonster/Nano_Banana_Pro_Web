import { useMemo, useEffect } from 'react';
import { Info, Settings2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import {
  useConfigStore,
  getModelAspectRatios,
  isUsingNativeImageSize,
  isQualityControlSupported,
  OPENAI_IMAGE_SIZE_OPTIONS,
  OPENAI_IMAGE_QUALITY_OPTIONS
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
    imageNativeSize,
    setImageNativeSize,
    imageQuality,
    setImageQuality,
    aspectRatio,
    setAspectRatio,
    imageModel,
    imageProvider,
    refFiles
  } = useConfigStore(
    useShallow((s) => ({
      count: s.count,
      setCount: s.setCount,
      imageSize: s.imageSize,
      setImageSize: s.setImageSize,
      imageNativeSize: s.imageNativeSize,
      setImageNativeSize: s.setImageNativeSize,
      imageQuality: s.imageQuality,
      setImageQuality: s.setImageQuality,
      aspectRatio: s.aspectRatio,
      setAspectRatio: s.setAspectRatio,
      imageModel: s.imageModel,
      imageProvider: s.imageProvider,
      refFiles: s.refFiles
    }))
  );

  const supportedRatios = useMemo(() => getModelAspectRatios(imageModel), [imageModel]);
  const useNativeSize = isUsingNativeImageSize(imageProvider, imageModel);
  const useQuality = isQualityControlSupported(imageProvider);
  const showAutoReferenceHint = !useNativeSize && aspectRatio === 'auto' && refFiles.length > 0;

  useEffect(() => {
    if (useNativeSize) {
      return;
    }
    if (supportedRatios.length > 0 && !supportedRatios.includes(aspectRatio)) {
      const newRatio = supportedRatios[0];
      setAspectRatio(newRatio);
      toast.info(t('config.batch.ratioAutoAdjusted', { from: aspectRatio, to: newRatio }));
    }
  }, [useNativeSize, imageModel, aspectRatio, setAspectRatio, supportedRatios, t]);

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
                <label className="text-xs text-gray-500">{useNativeSize ? t('config.batch.nativeSize') : t('config.batch.resolution')}</label>
                {useNativeSize ? (
                  <Select value={imageNativeSize} onChange={(e) => setImageNativeSize(e.target.value)} className="h-9 text-sm">
                    {OPENAI_IMAGE_SIZE_OPTIONS.map((option) => (
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

        {useQuality ? (
          <div className="space-y-1">
            <label className="text-xs text-gray-500">{t('config.batch.quality')}</label>
            <Select value={imageQuality} onChange={(e) => setImageQuality(e.target.value)} className="h-9 text-sm">
              {OPENAI_IMAGE_QUALITY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </Select>
          </div>
        ) : null}

        {!useNativeSize ? (
          <div className="space-y-1">
              <div className="flex items-center gap-1.5">
                <label className="text-xs text-gray-500">{t('config.batch.aspectRatio')}</label>
                {showAutoReferenceHint ? (
                  <span
                    className="group relative inline-flex h-4 w-4 items-center justify-center text-gray-400 hover:text-gray-600 focus:outline-none"
                    tabIndex={0}
                    title={t('config.batch.autoRatioReferenceHint')}
                    aria-label={t('config.batch.autoRatioReferenceHint')}
                  >
                    <Info className="h-3.5 w-3.5" />
                    <span className="pointer-events-none absolute left-0 top-full z-20 mt-1 hidden w-56 rounded-md bg-gray-900 px-2 py-1.5 text-xs leading-4 text-white shadow-lg group-hover:block group-focus:block">
                      {t('config.batch.autoRatioReferenceHint')}
                    </span>
                  </span>
                ) : null}
              </div>
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
        ) : null}
    </div>
  );
}
