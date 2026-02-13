import { useEffect, useState, useCallback } from 'react';
import Joyride, { CallBackProps, STATUS, Step, ACTIONS, EVENTS } from 'react-joyride';
import { useTranslation } from 'react-i18next';
import { useConfigStore } from '../../store/configStore';

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
  const { showOnboarding, setShowOnboarding } = useConfigStore();
  const [run, setRun] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);

  // 定义引导步骤
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
      target: '[data-onboarding="optimize-buttons"]',
      placement: 'right',
      title: t('onboarding.optimize.title'),
      content: t('onboarding.optimize.content'),
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
      title: t('onboarding.refImage.title'),
      content: t('onboarding.refImage.content'),
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

  // 处理引导回调
  const handleJoyrideCallback = useCallback(
    (data: CallBackProps) => {
      const { status, action, index, type } = data;

      // 引导完成或跳过
      if (status === STATUS.FINISHED || status === STATUS.SKIPPED) {
        setRun(false);
        setShowOnboarding(false);
        return;
      }

      // 处理下一步/上一步
      if (type === EVENTS.STEP_AFTER || type === EVENTS.TARGET_NOT_FOUND) {
        const nextStepIndex = index + (action === ACTIONS.PREV ? -1 : 1);
        setStepIndex(nextStepIndex);
      }
    },
    [setShowOnboarding]
  );

  // 通知父组件引导已准备好
  useEffect(() => {
    onReady?.();
  }, [onReady]);

  // 如果不需要显示引导，不渲染组件
  if (!run) {
    return null;
  }

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
      styles={joyrideStyles}
      floaterProps={{
        disableAnimation: false,
      }}
    />
  );
}

export default OnboardingTour;
