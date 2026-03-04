import { useEffect, useState, useCallback, useRef } from 'react';
import Joyride, { CallBackProps, STATUS, Step, ACTIONS, EVENTS } from 'react-joyride';
import { useTranslation } from 'react-i18next';
import { useConfigStore } from '../../store/configStore';
import { useGenerateStore } from '../../store/generateStore';
import { useHistoryStore } from '../../store/historyStore';
import appIcon from '../../assets/app-icon.png';

// 引导时使用的示例提示词
const DEMO_PROMPT_ZH = '一只可爱的橘猫坐在窗台上，阳光洒在它的毛发上，温暖而惬意，高清摄影风格';
const DEMO_PROMPT_EN = 'A cute orange cat sitting on a windowsill, sunlight streaming through its fur, warm and cozy atmosphere, high-quality photography style';

// 从 URL 创建 File 对象
async function createDemoRefFile(url: string): Promise<File | null> {
  try {
    const response = await fetch(url);
    const blob = await response.blob();
    return new File([blob], 'demo-image.png', { type: 'image/png' });
  } catch (error) {
    console.error('Failed to create demo ref file:', error);
    return null;
  }
}

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

type OnboardingStepKey =
  | 'welcome'
  | 'settingsEntry'
  | 'prompt'
  | 'optimizeNormal'
  | 'optimizeJson'
  | 'resolution'
  | 'refUpload'
  | 'refExtract'
  | 'templateMarket'
  | 'generate'
  | 'historyTab'
  | 'historyViewToggle'
  | 'historyAlbumCards'
  | 'historyCreateFolder'
  | 'historyCreateFolderDialog'
  | 'historyOpenFolderImages'
  | 'historyMoveToFolder'
  | 'historyDragToRef';

interface StepRetryState {
  historyOpenFolderImages: number;
  historyMoveToFolder: number;
  historyCreateFolderDialog: number;
}

const STEP_KEYS: OnboardingStepKey[] = [
  'welcome',
  'settingsEntry',
  'prompt',
  'optimizeNormal',
  'optimizeJson',
  'resolution',
  'refUpload',
  'refExtract',
  'templateMarket',
  'generate',
  'historyTab',
  'historyViewToggle',
  'historyAlbumCards',
  'historyCreateFolder',
  'historyCreateFolderDialog',
  'historyOpenFolderImages',
  'historyMoveToFolder',
  'historyDragToRef',
];

export function OnboardingTour({ onReady }: OnboardingTourProps) {
  const { t, i18n } = useTranslation();
  const { showOnboarding, setShowOnboarding, prompt, setPrompt, refFiles, setRefFiles, clearRefFiles } = useConfigStore();
  const setTab = useGenerateStore((s) => s.setTab);
  const setHistoryViewMode = useHistoryStore((s) => s.setViewMode);
  const [run, setRun] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);

  // 记录引导前的状态，用于恢复
  const prevStateRef = useRef<{
    prompt: string;
    hadRefFiles: boolean;
  } | null>(null);

  // 加载示例参考图的状态
  const demoFileLoadedRef = useRef(false);
  const stepRetryRef = useRef<StepRetryState>({
    historyOpenFolderImages: 0,
    historyMoveToFolder: 0,
    historyCreateFolderDialog: 0,
  });
  const stepActionTimerRef = useRef<number | null>(null);
  const retryStepTimerRef = useRef<number | null>(null);
  const runRef = useRef(run);
  const stepIndexRef = useRef(stepIndex);

  // 定义引导步骤 - 拆分为更细的步骤
  const steps: Step[] = [
    {
      target: 'body',
      data: { key: 'welcome' satisfies OnboardingStepKey },
      placement: 'center',
      title: t('onboarding.welcome.title'),
      content: t('onboarding.welcome.content'),
      disableBeacon: true,
    },
    {
      target: '[data-onboarding="settings-button"]',
      data: { key: 'settingsEntry' satisfies OnboardingStepKey },
      placement: 'left',
      title: t('onboarding.settings.title'),
      content: t('onboarding.settings.content'),
      spotlightPadding: 4,
    },
    {
      target: '[data-onboarding="prompt-input"]',
      data: { key: 'prompt' satisfies OnboardingStepKey },
      placement: 'right',
      title: t('onboarding.prompt.title'),
      content: t('onboarding.prompt.content'),
      spotlightPadding: 4,
    },
    {
      target: '[data-onboarding="optimize-normal"]',
      data: { key: 'optimizeNormal' satisfies OnboardingStepKey },
      placement: 'right',
      title: t('onboarding.optimizeNormal.title'),
      content: t('onboarding.optimizeNormal.content'),
      spotlightPadding: 4,
    },
    {
      target: '[data-onboarding="optimize-json"]',
      data: { key: 'optimizeJson' satisfies OnboardingStepKey },
      placement: 'right',
      title: t('onboarding.optimizeJson.title'),
      content: t('onboarding.optimizeJson.content'),
      spotlightPadding: 4,
    },
    {
      target: '[data-onboarding="resolution-ratio"]',
      data: { key: 'resolution' satisfies OnboardingStepKey },
      placement: 'right',
      title: t('onboarding.resolution.title'),
      content: t('onboarding.resolution.content'),
      spotlightPadding: 4,
    },
    {
      target: '[data-onboarding="ref-image-area"]',
      data: { key: 'refUpload' satisfies OnboardingStepKey },
      placement: 'right',
      title: t('onboarding.refImageUpload.title'),
      content: t('onboarding.refImageUpload.content'),
      spotlightPadding: 4,
    },
    {
      target: '[data-onboarding="ref-image-extract"]',
      data: { key: 'refExtract' satisfies OnboardingStepKey },
      placement: 'right',
      title: t('onboarding.refImageExtract.title'),
      content: t('onboarding.refImageExtract.content'),
      spotlightPadding: 4,
    },
    {
      target: '[data-onboarding="template-market"]',
      data: { key: 'templateMarket' satisfies OnboardingStepKey },
      placement: 'bottom',
      title: t('onboarding.templateMarket.title'),
      content: t('onboarding.templateMarket.content'),
      spotlightPadding: 4,
    },
    {
      target: '[data-onboarding="generate-button"]',
      data: { key: 'generate' satisfies OnboardingStepKey },
      placement: 'left',
      title: t('onboarding.generate.title'),
      content: t('onboarding.generate.content'),
      spotlightPadding: 4,
    },
    {
      target: '[data-onboarding="tab-history"]',
      data: { key: 'historyTab' satisfies OnboardingStepKey },
      placement: 'left',
      title: t('onboarding.historyTab.title'),
      content: t('onboarding.historyTab.content'),
      spotlightPadding: 4,
    },
    {
      target: '[data-onboarding="history-view-toggle"]',
      data: { key: 'historyViewToggle' satisfies OnboardingStepKey },
      placement: 'bottom',
      title: t('onboarding.historyViewToggle.title'),
      content: t('onboarding.historyViewToggle.content'),
      spotlightPadding: 4,
    },
    {
      target: '[data-onboarding="album-folder-card"]',
      data: { key: 'historyAlbumCards' satisfies OnboardingStepKey },
      placement: 'right',
      title: t('onboarding.historyAlbumCards.title'),
      content: t('onboarding.historyAlbumCards.content'),
      spotlightPadding: 4,
    },
    {
      target: '[data-onboarding="create-folder-button"]',
      data: { key: 'historyCreateFolder' satisfies OnboardingStepKey },
      placement: 'bottom',
      title: t('onboarding.historyCreateFolder.title'),
      content: t('onboarding.historyCreateFolder.content'),
      spotlightPadding: 4,
    },
    {
      target: '[data-onboarding="create-folder-dialog"], [data-onboarding="create-folder-button"]',
      data: { key: 'historyCreateFolderDialog' satisfies OnboardingStepKey },
      placement: 'top',
      title: t('onboarding.historyCreateFolderDialog.title'),
      content: t('onboarding.historyCreateFolderDialog.content'),
      spotlightPadding: 4,
    },
    {
      target: '[data-onboarding="album-folder-detail"], [data-onboarding="album-folder-card"], [data-onboarding="history-panel"]',
      data: { key: 'historyOpenFolderImages' satisfies OnboardingStepKey },
      placement: 'bottom',
      title: t('onboarding.historyOpenFolderImages.title'),
      content: t('onboarding.historyOpenFolderImages.content'),
      spotlightPadding: 4,
    },
    {
      target: '[data-onboarding="history-image-card"], [data-onboarding="album-folder-detail"], [data-onboarding="history-panel"]',
      data: { key: 'historyMoveToFolder' satisfies OnboardingStepKey },
      placement: 'right',
      title: t('onboarding.historyMoveToFolder.title'),
      content: t('onboarding.historyMoveToFolder.content'),
      spotlightPadding: 4,
    },
    {
      target: '[data-onboarding="ref-image-area"]',
      data: { key: 'historyDragToRef' satisfies OnboardingStepKey },
      placement: 'right',
      title: t('onboarding.historyDragToRef.title'),
      content: t('onboarding.historyDragToRef.content'),
      spotlightPadding: 4,
    },
  ];

  const getStepKey = useCallback(
    (index: number): OnboardingStepKey | undefined => {
      if (!Number.isInteger(index) || index < 0 || index >= STEP_KEYS.length) {
        return undefined;
      }
      return STEP_KEYS[index];
    },
    []
  );

  const isSettingsModalOpen = useCallback(() => {
    return Boolean(document.querySelector('[data-onboarding="settings-modal"]'));
  }, []);

  const ensureAlbumFolderOpened = useCallback(() => {
    if (isSettingsModalOpen()) return;
    const closeDialogButton = document.querySelector<HTMLElement>('[data-onboarding="create-folder-dialog-cancel"]');
    if (closeDialogButton) {
      closeDialogButton.click();
    }
    const hasFolderDetail = document.querySelector('[data-onboarding="album-folder-detail"]');
    if (hasFolderDetail) return;
    const firstFolderCard = document.querySelector<HTMLElement>('[data-onboarding="album-folder-card"]');
    firstFolderCard?.click();
  }, [isSettingsModalOpen]);

  const closeCreateFolderDialogIfOpen = useCallback(() => {
    const closeDialogButton = document.querySelector<HTMLElement>('[data-onboarding="create-folder-dialog-cancel"]');
    closeDialogButton?.click();
  }, []);

  const getRetryAction = useCallback(
    (key: OnboardingStepKey): (() => void) | undefined => {
      switch (key) {
        case 'historyOpenFolderImages':
        case 'historyMoveToFolder':
          return ensureAlbumFolderOpened;
        default:
          return undefined;
      }
    },
    [ensureAlbumFolderOpened]
  );

  const getRetryCount = useCallback((key: OnboardingStepKey): number => {
    switch (key) {
      case 'historyOpenFolderImages':
        return stepRetryRef.current.historyOpenFolderImages;
      case 'historyMoveToFolder':
        return stepRetryRef.current.historyMoveToFolder;
      case 'historyCreateFolderDialog':
        return stepRetryRef.current.historyCreateFolderDialog;
      default:
        return 0;
    }
  }, []);

  const setRetryCount = useCallback((key: OnboardingStepKey, value: number) => {
    switch (key) {
      case 'historyOpenFolderImages':
        stepRetryRef.current.historyOpenFolderImages = value;
        return;
      case 'historyMoveToFolder':
        stepRetryRef.current.historyMoveToFolder = value;
        return;
      case 'historyCreateFolderDialog':
        stepRetryRef.current.historyCreateFolderDialog = value;
        return;
      default:
        return;
    }
  }, []);

  const clearStepTimers = useCallback(() => {
    if (stepActionTimerRef.current !== null) {
      window.clearTimeout(stepActionTimerRef.current);
      stepActionTimerRef.current = null;
    }
    if (retryStepTimerRef.current !== null) {
      window.clearTimeout(retryStepTimerRef.current);
      retryStepTimerRef.current = null;
    }
  }, []);

  const scheduleStepAction = useCallback(
    (expectedKey: OnboardingStepKey, action: () => void) => {
      if (stepActionTimerRef.current !== null) {
        window.clearTimeout(stepActionTimerRef.current);
      }
      stepActionTimerRef.current = window.setTimeout(() => {
        stepActionTimerRef.current = null;
        if (!runRef.current) return;
        if (getStepKey(stepIndexRef.current) !== expectedKey) return;
        action();
      }, 80);
    },
    [getStepKey]
  );

  useEffect(() => {
    runRef.current = run;
  }, [run]);

  useEffect(() => {
    stepIndexRef.current = stepIndex;
  }, [stepIndex]);

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

      // 如果没有参考图，加载示例参考图（app icon）用于展示逆向提示词功能
      if (refFiles.length === 0 && !demoFileLoadedRef.current) {
        demoFileLoadedRef.current = true;
        createDemoRefFile(appIcon).then((file) => {
          if (file) {
            setRefFiles([file]);
          }
        });
      }

      // 添加引导模式的 body class，用于强制显示 hover 元素
      document.body.classList.add('onboarding-active');
      setTab('generate');
      stepRetryRef.current.historyOpenFolderImages = 0;
      stepRetryRef.current.historyMoveToFolder = 0;
      stepRetryRef.current.historyCreateFolderDialog = 0;
      clearStepTimers();

      // 延迟启动，等待 DOM 完全加载
      const timer = setTimeout(() => {
        setRun(true);
        setStepIndex(0);
      }, 500);
      return () => {
        clearTimeout(timer);
        document.body.classList.remove('onboarding-active');
      };
    } else {
      setRun(false);
      document.body.classList.remove('onboarding-active');
      clearStepTimers();
    }
  }, [clearStepTimers, showOnboarding, i18n.language, prompt, refFiles.length, setPrompt, setRefFiles, setTab]);

  // 根据步骤自动切换上下文，确保目标元素可见
  useEffect(() => {
    if (!run) return;
    const key = getStepKey(stepIndex);
    if (!key) return;
    switch (key) {
      case 'historyTab':
        setTab('history');
        setHistoryViewMode('timeline');
        break;
      case 'historyViewToggle':
      case 'historyAlbumCards':
      case 'historyCreateFolder':
        setTab('history');
        setHistoryViewMode('album');
        break;
      case 'historyCreateFolderDialog':
        setTab('history');
        setHistoryViewMode('album');
        break;
      case 'historyOpenFolderImages':
      case 'historyMoveToFolder':
        setTab('history');
        setHistoryViewMode('album');
        scheduleStepAction(key, ensureAlbumFolderOpened);
        break;
      case 'historyDragToRef':
        setTab('generate');
        break;
      default:
        break;
    }
  }, [ensureAlbumFolderOpened, getStepKey, run, scheduleStepAction, setHistoryViewMode, setTab, stepIndex]);

  useEffect(() => {
    return () => {
      clearStepTimers();
    };
  }, [clearStepTimers]);

  useEffect(() => {
    if (!run) return;
    if (!isSettingsModalOpen()) return;
    closeCreateFolderDialogIfOpen();
  }, [closeCreateFolderDialogIfOpen, isSettingsModalOpen, run, stepIndex]);

  // 清理引导时的示例数据
  const cleanupDemoData = useCallback(() => {
    closeCreateFolderDialogIfOpen();
    if (prevStateRef.current) {
      // 如果之前没有提示词，清除我们添加的示例
      if (!prevStateRef.current.prompt.trim()) {
        setPrompt('');
      }
      // 如果之前没有参考图，清除我们添加的示例参考图
      if (!prevStateRef.current.hadRefFiles) {
        clearRefFiles();
      }
      demoFileLoadedRef.current = false;
      prevStateRef.current = null;
    }
  }, [closeCreateFolderDialogIfOpen, setPrompt, clearRefFiles]);

  // 处理引导回调
  const handleJoyrideCallback = useCallback(
    (data: CallBackProps) => {
      const { status, action, index, type } = data;

      // 引导完成或跳过
      if (status === STATUS.FINISHED || status === STATUS.SKIPPED) {
        clearStepTimers();
        setRun(false);
        setShowOnboarding(false);
        // 清理示例数据
        cleanupDemoData();
        return;
      }

      // 处理 target 不存在：对关键步骤做有限次重试（切 tab / 开弹窗 / 进文件夹）
      if (type === EVENTS.TARGET_NOT_FOUND) {
        const key = getStepKey(index);
        const retryAction = key ? getRetryAction(key) : undefined;
        if (key && retryAction) {
          const maxRetry = 2;
          const attempt = getRetryCount(key) + 1;
          setRetryCount(key, attempt);
          if (attempt <= maxRetry) {
            retryAction();
            if (retryStepTimerRef.current !== null) {
              window.clearTimeout(retryStepTimerRef.current);
            }
            retryStepTimerRef.current = window.setTimeout(() => {
              retryStepTimerRef.current = null;
              if (!runRef.current) return;
              if (stepIndexRef.current !== index) return;
              setStepIndex(index);
            }, 220);
            return;
          }
        }
      }

      // 处理下一步/上一步
      if (type === EVENTS.STEP_AFTER || type === EVENTS.TARGET_NOT_FOUND) {
        const key = getStepKey(index);
        if (key) {
          setRetryCount(key, 0);
        }
        const nextStepIndex = index + (action === ACTIONS.PREV ? -1 : 1);
        setStepIndex(nextStepIndex);
      }
    },
    [clearStepTimers, setShowOnboarding, cleanupDemoData, getRetryAction, getRetryCount, setRetryCount, getStepKey]
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
      disableOverlayClose
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
