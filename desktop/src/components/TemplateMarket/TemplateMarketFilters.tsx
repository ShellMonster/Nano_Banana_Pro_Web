import { RefreshCw, Search, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Input } from '../common/Input';

export type TemplateFilterMeta = {
  channels: string[];
  materials: string[];
  industries: string[];
  ratios: string[];
};

export type ActiveTemplateFilter = {
  label: string;
  onClear: () => void;
};

type TemplateMarketFiltersProps = {
  search: string;
  onSearchChange: (value: string) => void;
  activeFilters: ActiveTemplateFilter[];
  onClearAllFilters: () => void;
  meta: TemplateFilterMeta;
  channel: string;
  material: string;
  industry: string;
  ratio: string;
  onChannelChange: (value: string) => void;
  onMaterialChange: (value: string) => void;
  onIndustryChange: (value: string) => void;
  onRatioChange: (value: string) => void;
  formatFilterLabel: (value: string) => string;
  isLoading: boolean;
  resultCount: number;
  onRefresh: () => void;
};

const ActiveFilterChip = ({
  label,
  onClear
}: ActiveTemplateFilter) => (
  <button
    type="button"
    onClick={onClear}
    className="inline-flex items-center gap-1.5 rounded-full bg-white/80 border border-white/60 px-3 py-1 text-xs text-slate-600 hover:bg-white"
  >
    <span>{label}</span>
    <X className="w-3 h-3" />
  </button>
);

const FilterChip = ({
  label,
  active,
  onClick
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) => (
  <button
    type="button"
    onClick={onClick}
    className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-all ${
      active
        ? 'bg-blue-600 text-white shadow-sm shadow-blue-200'
        : 'bg-white/70 text-slate-600 hover:bg-white'
    }`}
  >
    {label}
  </button>
);

export function TemplateMarketFilters({
  search,
  onSearchChange,
  activeFilters,
  onClearAllFilters,
  meta,
  channel,
  material,
  industry,
  ratio,
  onChannelChange,
  onMaterialChange,
  onIndustryChange,
  onRatioChange,
  formatFilterLabel,
  isLoading,
  resultCount,
  onRefresh
}: TemplateMarketFiltersProps) {
  const { t } = useTranslation();
  const hasActiveFilters = activeFilters.length > 0;

  return (
    <div className="pt-6 space-y-4 shrink-0">
      <div className="relative">
        <Search className="w-4 h-4 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2" />
        <Input
          value={search}
          onChange={(e) => {
            onSearchChange(e.target.value);
          }}
          placeholder={t('templateMarket.searchPlaceholder')}
          className="pl-10 bg-white/80"
        />
      </div>
      <div className="flex items-center gap-2 flex-wrap min-h-[34px] pb-1">
        <span className="text-xs text-slate-400">{t('templateMarket.activeFilters.title')}</span>
        {hasActiveFilters ? (
          <>
            {activeFilters.map((filter) => (
              <ActiveFilterChip key={filter.label} label={filter.label} onClear={filter.onClear} />
            ))}
            <button
              type="button"
              onClick={onClearAllFilters}
              className="text-xs text-blue-600 hover:underline"
            >
              {t('templateMarket.actions.clearFilters')}
            </button>
          </>
        ) : (
          <span className="text-xs text-slate-400">{t('templateMarket.activeFilters.empty')}</span>
        )}
      </div>

      <div className="space-y-4">
        <div>
          <p className="text-xs uppercase text-slate-400 tracking-widest mb-2">{t('templateMarket.filters.channel')}</p>
          <div className="flex flex-wrap gap-2">
            {meta.channels.map((item) => (
              <FilterChip
                key={item}
                label={formatFilterLabel(item)}
                active={channel === item}
                onClick={() => {
                  onChannelChange(item);
                }}
              />
            ))}
          </div>
        </div>
        <div>
          <p className="text-xs uppercase text-slate-400 tracking-widest mb-2">{t('templateMarket.filters.material')}</p>
          <div className="flex flex-wrap gap-2">
            {meta.materials.map((item) => (
              <FilterChip
                key={item}
                label={formatFilterLabel(item)}
                active={material === item}
                onClick={() => {
                  onMaterialChange(item);
                }}
              />
            ))}
          </div>
        </div>
        <div>
          <p className="text-xs uppercase text-slate-400 tracking-widest mb-2">{t('templateMarket.filters.industry')}</p>
          <div className="flex flex-wrap gap-2">
            {meta.industries.map((item) => (
              <FilterChip
                key={item}
                label={formatFilterLabel(item)}
                active={industry === item}
                onClick={() => {
                  onIndustryChange(item);
                }}
              />
            ))}
          </div>
        </div>
        <div>
          <p className="text-xs uppercase text-slate-400 tracking-widest mb-2">{t('templateMarket.filters.ratio')}</p>
          <div className="flex flex-wrap gap-2">
            {meta.ratios.map((item) => (
              <FilterChip
                key={item}
                label={formatFilterLabel(item)}
                active={ratio === item}
                onClick={() => {
                  onRatioChange(item);
                }}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-slate-500">
            {isLoading ? t('templateMarket.list.loading') : t('templateMarket.list.count', { count: resultCount })}
          </p>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={isLoading}
          className="w-8 h-8 rounded-full bg-white/70 border border-white/60 flex items-center justify-center text-slate-500 hover:text-blue-600 hover:bg-white disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
        </button>
      </div>
    </div>
  );
}
