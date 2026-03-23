export const buildPromptNotificationSummary = (
  promptOptimized?: string,
  promptOriginal?: string,
  prompt?: string,
  maxLength = 48
) => {
  const source = [promptOptimized, promptOriginal, prompt].find((item) => typeof item === 'string' && item.trim());
  if (!source) return '';

  const normalized = source.replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
};
