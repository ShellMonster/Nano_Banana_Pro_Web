import React from 'react';
import { Button } from '../common/Button';
import { useHistoryStore } from '../../store/historyStore';
import { Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export function LoadMore() {
  const { t } = useTranslation();
  const { loading, hasMore, loadMore } = useHistoryStore();

  if (!hasMore) {
      return (
          <div className="text-center py-4 text-xs text-gray-400">
              {t('history.loadMore.noMore')}
          </div>
      );
  }

  return (
    <div className="flex justify-center py-4">
      <Button 
        variant="ghost" 
        size="sm" 
        onClick={loadMore}
        disabled={loading}
        className="text-gray-500"
      >
        {loading ? (
            <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                {t('history.loadMore.loading')}
            </>
        ) : (
            t('history.loadMore.action')
        )}
      </Button>
    </div>
  );
}
