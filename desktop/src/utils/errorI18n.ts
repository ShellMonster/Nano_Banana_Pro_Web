import i18n from '../i18n';
import type { BackendTask, GeneratedImage, GenerationTask } from '../types';

type ErrorShape = Partial<
  Pick<
    BackendTask,
    'error_message' | 'error_raw_message' | 'error_code' | 'error_category' | 'error_request_id' | 'error_retryable' | 'error_detail'
  >
> &
  Partial<
    Pick<
      GeneratedImage,
      'errorMessage' | 'errorRawMessage' | 'errorCode' | 'errorCategory' | 'errorRequestId' | 'errorRetryable' | 'errorDetail'
    >
  > &
  Partial<Pick<GenerationTask, 'errorMessage' | 'errorRawMessage' | 'errorCode' | 'errorCategory' | 'errorRequestId' | 'errorRetryable' | 'errorDetail'>>;

function getValue(obj: ErrorShape, ...keys: string[]): string {
  for (const key of keys) {
    const value = (obj as Record<string, unknown>)[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return '';
}

function getBoolean(obj: ErrorShape, ...keys: string[]): boolean | undefined {
  for (const key of keys) {
    const value = (obj as Record<string, unknown>)[key];
    if (typeof value === 'boolean') return value;
  }
  return undefined;
}

export function sanitizeBackendErrorMessage(message?: string): string {
  if (!message) return '';
  const cleaned = message
    .split('\n')
    .filter((line) => !/^\s*at\s+.+/i.test(line))
    .join('\n')
    .trim();
  return cleaned.slice(0, 500);
}

function translateCode(code: string): string {
  if (!code) return '';
  const key = `errorMapping.codes.${code}`;
  const translated = i18n.t(key);
  return translated === key ? '' : translated;
}

function translateCategory(category: string): string {
  if (!category) return '';
  const key = `errorMapping.categories.${category}`;
  const translated = i18n.t(key);
  return translated === key ? category : translated;
}

function detailContainsRequestId(detail: string, requestId: string): boolean {
  if (!detail || !requestId) return false;
  return detail.includes(requestId);
}

export function localizeErrorSummary(input: ErrorShape): {
  errorMessage: string;
  errorRawMessage: string;
  errorCode: string;
  errorCategory: string;
  errorRequestId: string;
  errorRetryable?: boolean;
  errorDetail: string;
} {
  const errorCode = getValue(input, 'error_code', 'errorCode');
  const errorCategoryRaw = getValue(input, 'error_category', 'errorCategory');
  const errorRequestId = getValue(input, 'error_request_id', 'errorRequestId');
  const errorRawMessage = sanitizeBackendErrorMessage(getValue(input, 'error_raw_message', 'errorRawMessage'));
  const backendErrorMessage = sanitizeBackendErrorMessage(getValue(input, 'error_message', 'errorMessage'));
  const backendErrorDetail = sanitizeBackendErrorMessage(getValue(input, 'error_detail', 'errorDetail'));
  const errorRetryable = getBoolean(input, 'error_retryable', 'errorRetryable');

  const translatedMessage = translateCode(errorCode);
  const errorMessage = translatedMessage || backendErrorMessage;
  const errorCategory = translateCategory(errorCategoryRaw);

  let errorDetail = backendErrorDetail;
  if (errorRequestId && !detailContainsRequestId(backendErrorDetail, errorRequestId)) {
    const requestLine = i18n.t('errorMapping.requestIdLine', { requestId: errorRequestId });
    errorDetail = errorDetail ? `${errorDetail}\n${requestLine}` : requestLine;
  }

  return {
    errorMessage,
    errorRawMessage,
    errorCode,
    errorCategory,
    errorRequestId,
    errorRetryable,
    errorDetail,
  };
}
