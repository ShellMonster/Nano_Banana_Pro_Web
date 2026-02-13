import { useEffect, useState, useCallback, useRef } from 'react';
import Joyride, { CallBackProps, STATUS, Step, ACTIONS, EVENTS } from 'react-joyride';
import { useTranslation } from 'react-i18next';
import { useConfigStore } from '../../store/configStore';

// 引导时使用的示例提示词
const DEMO_PROMPT_ZH = '一只可爱的橘猫坐在窗台上，阳光洒在它的毛发上，温暖而惬意，高清摄影风格';
const DEMO_PROMPT_EN = 'A cute orange cat sitting on a windowsill, sunlight streaming through its fur, warm and cozy atmosphere, high-quality photography style';

// 引导步骤的 CSS 样式
const joyrideStyles = {
  options: {
    primaryColor: '#3b82f6',
    backgroundColor: '#ffffff',
    textColor: '#1e293b',
    arrowColor: '#ffffff',
    overlayColor: 'rgba(0, 0, 0, 0.5)',
    spotlightShadow: '0 0 15px rgba(0, 0, 0, 0.5)',
    zIndex: 10000,
  },
  tooltip: {
    borderRadius: '12px',
    padding: '20px',
  },
  tooltipContainer: {
    textAlign: 'left' as const,
  },
  tooltipTitle: {
    fontSize: '16px',
    fontWeight: 600,
    marginBottom: '8px',
    color: '#1e293b',
  },
  tooltipContent: {
    fontSize: '14px',
    lineHeight: 1.6,
    color: '#475569',
    padding: '0',
  },
  tooltipFooter: {
    marginTop: '16px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  buttonNext: {
    backgroundColor: '#3b82f6',
    color: '#ffffff',
    borderRadius: '8px',
    padding: '8px 16px',
    fontSize: '14px',
    fontWeight: 500,
  },
  buttonBack: {
    color: '#64748b',
    marginRight: '8px',
  },
  buttonSkip: {
    color: '#94a3b8',
  },
  buttonClose: {
    display: 'none',
  },
};

interface OnboardingTourProps {
  onReady?: () => void;
}

export function OnboardingTour({ onReady }: OnboardingTourProps) {
  const { t, i18n } = useTranslation();
  const { showOnboarding, setShowOnboarding, prompt, setPrompt, refFiles, setRefFiles } = useConfigStore();
  const [run, setRun] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);

  // 记录引导前的状态，用于恢复
  const prevStateRef = useRef<{
    prompt: string;
    hadRefFiles: boolean;
  } | null>(null);

  // 定义引导步骤 - 拆分为更细的步骤
  const steps: Step[] = [
    {
      target: 'body',
      placement: 'center',
      title: t('onboarding.welcome.title'),
      content: t('onboarding.welcome.content'),
      disableBeacon: true,
    },
    {
      target: '[data-onboarding="settings-button"]',
      placement: 'left',
      title: t('onboarding.settings.title'),
      content: t('onboarding.settings.content'),
      spotlightPadding: 4,
    },
    {
      target: '[data-onboarding="prompt-input"]',
      placement: 'right',
      title: t('onboarding.prompt.title'),
      content: t('onboarding.prompt.content'),
      spotlightPadding: 4,
    },
    {
      target: '[data-onboarding="optimize-normal"]',
      placement: 'right',
      title: t('onboarding.optimizeNormal.title'),
      content: t('onboarding.optimizeNormal.content'),
      spotlightPadding: 4,
    },
    {
      target: '[data-onboarding="optimize-json"]',
      placement: 'right',
      title: t('onboarding.optimizeJson.title'),
      content: t('onboarding.optimizeJson.content'),
      spotlightPadding: 4,
    },
    {
      target: '[data-onboarding="resolution-ratio"]',
      placement: 'right',
      title: t('onboarding.resolution.title'),
      content: t('onboarding.resolution.content'),
      spotlightPadding: 4,
    },
    {
      target: '[data-onboarding="ref-image-area"]',
      placement: 'right',
      title: t('onboarding.refImageUpload.title'),
      content: t('onboarding.refImageUpload.content'),
      spotlightPadding: 4,
    },
    {
      target: '[data-onboarding="ref-image-area"]',
      placement: 'right',
      title: t('onboarding.refImageExtract.title'),
      content: t('onboarding.refImageExtract.content'),
      spotlightPadding: 4,
    },
    {
      target: '[data-onboarding="template-market"]',
      placement: 'bottom',
      title: t('onboarding.templateMarket.title'),
      content: t('onboarding.templateMarket.content'),
      spotlightPadding: 4,
    },
    {
      target: '[data-onboarding="generate-button"]',
      placement: 'left',
      title: t('onboarding.generate.title'),
      content: t('onboarding.generate.content'),
      spotlightPadding: 4,
    },
  ];

  // 当 showOnboarding 变化时，启动或停止引导
  useEffect(() => {
    if (showOnboarding) {
      // 保存引导前的状态
      prevStateRef.current = {
        prompt: prompt,
        hadRefFiles: refFiles.length > 0,
      };

      // 如果提示词为空，填充示例提示词
      if (!prompt.trim()) {
        const demoPrompt = i18n.language.startsWith('zh') ? DEMO_PROMPT_ZH : DEMO_PROMPT_EN;
        setPrompt(demoPrompt);
      }

      // 延迟启动，等待 DOM 完全加载
      const timer = setTimeout(() => {
        setRun(true);
        setStepIndex(0);
      }, 500);
      return () => clearTimeout(timer);
    } else {
      setRun(false);
    }
  }, [showOnboarding]);

  // 清理引导时的示例数据
  const cleanupDemoData = useCallback(() => {
    if (prevStateRef.current) {
      // 如果之前没有提示词，清除我们添加的示例
      if (!prevStateRef.current.prompt.trim()) {
        setPrompt('');
      }
      // 参考图保持原样（我们无法轻易创建示例图片）
      prevStateRef.current = null;
    }
  }, [setPrompt]);

  // 处理引导回调
  const handleJoyrideCallback = useCallback(
    (data: CallBackProps) => {
      const { status, action, index, type } = data;

      // 引导完成或跳过
      if (status === STATUS.FINISHED || status === STATUS.SKIPPED) {
        setRun(false);
        setShowOnboarding(false);
        // 清理示例数据
        cleanupDemoData();
        return;
      }

      // 处理下一步/上一步
      if (type === EVENTS.STEP_AFTER || type === EVENTS.TARGET_NOT_FOUND) {
        const nextStepIndex = index + (action === ACTIONS.PREV ? -1 : 1);
        setStepIndex(nextStepIndex);
      }
    },
    [setShowOnboarding, cleanupDemoData]
  );

  // 通知父组件引导已准备好
  useEffect(() => {
    onReady?.();
  }, [onReady]);

  // 如果不需要显示引导，不渲染组件
  if (!run) {
    return null;
  }

  // 自定义进度显示文本
  const totalSteps = steps.length;
  const progressText = t('onboarding.progress', { current: stepIndex + 1, total: totalSteps });

  return (
    <Joyride
      run={run}
      stepIndex={stepIndex}
      steps={steps}
      callback={handleJoyrideCallback}
      continuous
      showSkipButton
      showProgress
      disableScrolling={false}
      disableScrollParentFix={false}
      locale={{
        next: t('onboarding.buttons.next'),
        back: t('onboarding.buttons.back'),
        skip: t('onboarding.buttons.skip'),
        last: t('onboarding.buttons.finish'),
      }}
      tooltipComponent={(props) => {
        // 自定义 Tooltip 组件，添加进度显示
        const { step, backProps, primaryProps, skipProps, tooltipProps, isLastStep, index } = props as any;
        return (
          <div
            {...tooltipProps}
            style={{
              backgroundColor: '#ffffff',
              borderRadius: '12px',
              padding: '20px',
              maxWidth: '320px',
              boxShadow: '0 4px 20px rgba(0, 0, 0, 0.15)',
            }}
          >
            {/* 进度指示 */}
            <div style={{
              fontSize: '12px',
              color: '#94a3b8',
              marginBottom: '8px',
              fontWeight: 500,
            }}>
              {progressText}
            </div>

            {/* 标题 */}
            {step.title && (
              <div style={{
                fontSize: '16px',
                fontWeight: 600,
                marginBottom: '8px',
                color: '#1e293b',
              }}>
                {step.title}
              </div>
            )}

            {/* 内容 */}
            <div style={{
              fontSize: '14px',
              lineHeight: 1.6,
              color: '#475569',
            }}>
              {step.content}
            </div>

            {/* 底部按钮 */}
            <div style={{
              marginTop: '16px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}>
              <button
                {...skipProps}
                style={{
                  color: '#94a3b8',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '14px',
                }}
              >
                {t('onboarding.buttons.skip')}
              </button>
              <div style={{ display: 'flex', gap: '8px' }}>
                {index > 0 && (
                  <button
                    {...backProps}
                    style={{
                      color: '#64748b',
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      fontSize: '14px',
                    }}
                  >
                    {t('onboarding.buttons.back')}
                  </button>
                )}
                <button
                  {...primaryProps}
                  style={{
                    backgroundColor: '#3b82f6',
                    color: '#ffffff',
                    borderRadius: '8px',
                    padding: '8px 16px',
                    fontSize: '14px',
                    fontWeight: 500,
                    border: 'none',
                    cursor: 'pointer',
                  }}
                >
                  {isLastStep ? t('onboarding.buttons.finish') : t('onboarding.buttons.next')}
                </button>
              </div>
            </div>
          </div>
        );
      }}
      styles={joyrideStyles}
      floaterProps={{
        disableAnimation: false,
      }}
    />
  );
}

export default OnboardingTour;
