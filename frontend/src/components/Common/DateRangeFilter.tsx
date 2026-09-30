import { useEffect, useRef, useState } from 'react';
import dayjs, { type Dayjs } from 'dayjs';
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';

interface DateRangeFilterProps {
  start: string; // YYYY-MM-DD，空字符串表示不限
  end: string;
  onChange: (start: string, end: string) => void;
}

const FMT = 'YYYY-MM-DD';
const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];

type Preset = 'all' | 'today' | '7d' | '30d' | 'custom';

// 快捷区间：结束日均为今天
const PRESET_DAYS: Record<'today' | '7d' | '30d', number> = { today: 0, '7d': 6, '30d': 29 };

const detectPreset = (start: string, end: string): Preset => {
  if (!start && !end) return 'all';
  const today = dayjs().format(FMT);
  if (end === today) {
    for (const key of ['today', '7d', '30d'] as const) {
      if (start === dayjs().subtract(PRESET_DAYS[key], 'day').format(FMT)) return key;
    }
  }
  return 'custom';
};

// 自定义区间的按钮文案：同一年省略年份
const rangeLabel = (start: string, end: string) => {
  const s = dayjs(start);
  const e = dayjs(end || start);
  const sameYear = s.year() === e.year() && s.year() === dayjs().year();
  const f = (d: Dayjs) => (sameYear ? d.format('M月D日') : d.format('YYYY年M月D日'));
  return s.isSame(e, 'day') ? f(s) : `${f(s)} – ${f(e)}`;
};

// 某月的日历格：周一开头，前面补空位
const monthCells = (month: Dayjs): (Dayjs | null)[] => {
  const first = month.startOf('month');
  const lead = (first.day() + 6) % 7;
  const cells: (Dayjs | null)[] = Array.from({ length: lead }, () => null);
  for (let i = 0; i < month.daysInMonth(); i++) cells.push(first.add(i, 'day'));
  return cells;
};

export function DateRangeFilter({ start, end, onChange }: DateRangeFilterProps) {
  const preset = detectPreset(start, end);
  const [open, setOpen] = useState(false);
  const [viewMonth, setViewMonth] = useState(() => dayjs(start || undefined).startOf('month'));
  const [draftStart, setDraftStart] = useState<Dayjs | null>(null);
  const [draftEnd, setDraftEnd] = useState<Dayjs | null>(null);
  const [hovered, setHovered] = useState<Dayjs | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const today = dayjs().startOf('day');

  // 点击外部或按 Esc 关闭日历
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const applyPreset = (key: Exclude<Preset, 'custom'>) => {
    setOpen(false);
    if (key === 'all') return onChange('', '');
    onChange(dayjs().subtract(PRESET_DAYS[key], 'day').format(FMT), dayjs().format(FMT));
  };

  const openCustom = () => {
    if (open) return setOpen(false);
    // 以当前生效的区间作为草稿
    setDraftStart(start ? dayjs(start) : null);
    setDraftEnd(end ? dayjs(end) : null);
    setViewMonth(dayjs(start || undefined).startOf('month'));
    setOpen(true);
  };

  const pickDay = (d: Dayjs) => {
    if (!draftStart || draftEnd) {
      setDraftStart(d);
      setDraftEnd(null);
    } else if (d.isBefore(draftStart, 'day')) {
      setDraftStart(d);
    } else {
      setDraftEnd(d);
    }
  };

  const confirm = () => {
    if (!draftStart) return;
    onChange(draftStart.format(FMT), (draftEnd || draftStart).format(FMT));
    setOpen(false);
  };

  // 区间预览：已选开始、未选结束时，随鼠标悬停延伸
  const rangeEnd = draftEnd || (draftStart && hovered && !hovered.isBefore(draftStart, 'day') ? hovered : null);
  const inRange = (d: Dayjs) => !!draftStart && !!rangeEnd && d.isAfter(draftStart, 'day') && d.isBefore(rangeEnd, 'day');
  const isEndpoint = (d: Dayjs) => (!!draftStart && d.isSame(draftStart, 'day')) || (!!rangeEnd && d.isSame(rangeEnd, 'day'));

  // active：已生效的筛选（白底高亮）；pending：日历展开中但尚未应用（仅文字着色）
  const segment = (active: boolean, pending = false) =>
    `px-3 py-1.5 text-sm rounded-md transition-colors whitespace-nowrap focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
      active ? 'bg-white text-indigo-700 font-semibold shadow-sm'
        : pending ? 'text-indigo-700 font-semibold'
        : 'text-slate-500 hover:text-slate-800'
    }`;

  const canGoNext = viewMonth.isBefore(today.startOf('month'));

  return (
    <div ref={rootRef} className="relative">
      <div role="group" aria-label="提问时间" className="inline-flex flex-wrap items-center gap-0.5 p-1 rounded-lg bg-slate-100 max-w-full">
        {([['all', '全部时间'], ['today', '今天'], ['7d', '近 7 天'], ['30d', '近 30 天']] as const).map(([key, label]) => (
          <button key={key} type="button" aria-pressed={preset === key} onClick={() => applyPreset(key)} className={segment(preset === key)}>
            {label}
          </button>
        ))}
        <button
          type="button"
          aria-pressed={preset === 'custom'}
          aria-expanded={open}
          aria-haspopup="dialog"
          onClick={openCustom}
          className={`${segment(preset === 'custom', open)} inline-flex items-center gap-1.5`}
        >
          <CalendarDays className="w-4 h-4" />
          {preset === 'custom' ? rangeLabel(start, end) : '自定义'}
          <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {open && (
        <div role="dialog" aria-label="选择日期范围" className="absolute left-0 top-full mt-2 z-20 w-72 p-4 bg-white rounded-xl border border-slate-200 shadow-xl">
          <div className="flex items-center justify-between mb-3">
            <button type="button" aria-label="上个月" onClick={() => setViewMonth(viewMonth.subtract(1, 'month'))} className="p-1.5 rounded-md text-slate-500 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-sm font-semibold text-slate-800">{viewMonth.format('YYYY年M月')}</span>
            <button type="button" aria-label="下个月" disabled={!canGoNext} onClick={() => setViewMonth(viewMonth.add(1, 'month'))} className="p-1.5 rounded-md text-slate-500 hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-7 text-center text-xs text-slate-400 mb-1">
            {WEEKDAYS.map(w => <div key={w} className="py-1">{w}</div>)}
          </div>
          <div className="grid grid-cols-7 gap-y-1" onMouseLeave={() => setHovered(null)}>
            {monthCells(viewMonth).map((d, i) => {
              if (!d) return <div key={`blank-${i}`} />;
              const future = d.isAfter(today, 'day');
              const endpoint = isEndpoint(d);
              const between = inRange(d);
              const isToday = d.isSame(today, 'day');
              return (
                <button
                  key={d.format(FMT)}
                  type="button"
                  disabled={future}
                  aria-label={d.format('YYYY年M月D日')}
                  aria-pressed={endpoint}
                  onClick={() => pickDay(d)}
                  onMouseEnter={() => setHovered(d)}
                  className={`relative h-8 text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:z-10 ${
                    endpoint ? 'bg-indigo-600 text-white font-semibold rounded-md'
                      : between ? 'bg-indigo-50 text-indigo-700'
                      : future ? 'text-slate-300 cursor-not-allowed'
                      : 'text-slate-700 hover:bg-slate-100 rounded-md'
                  }`}
                >
                  {d.date()}
                  {isToday && !endpoint && <span className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-indigo-500" />}
                </button>
              );
            })}
          </div>

          <div className="mt-4 pt-3 border-t border-slate-100">
            <p className="text-xs text-slate-500 mb-3 min-h-4">
              {draftStart
                ? draftEnd ? rangeLabel(draftStart.format(FMT), draftEnd.format(FMT)) : `${rangeLabel(draftStart.format(FMT), '')} 起，再选一个结束日期`
                : '选择开始日期'}
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => { setDraftStart(null); setDraftEnd(null); }} className="px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-100 rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">
                清除
              </button>
              <button type="button" disabled={!draftStart} onClick={confirm} className="px-4 py-1.5 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-md disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1">
                应用
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
