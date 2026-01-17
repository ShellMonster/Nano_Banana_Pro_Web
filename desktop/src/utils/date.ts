import i18n from '../i18n';

export function formatDateTime(dateStr?: string | number | null): string {
  if (!dateStr) return i18n.t('common.unknownTime');
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return i18n.t('common.invalidDate');
    return date.toLocaleString(i18n.language || 'zh-CN', {
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  } catch (e) {
    return i18n.t('common.parseFailed');
  }
}
