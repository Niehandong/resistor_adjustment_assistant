import React from 'react';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';

interface PaginationProps {
  current: number;
  total: number;
  pageSize: number;
  onChange: (page: number) => void;
  showTotal?: boolean;
}

export const Pagination: React.FC<PaginationProps> = ({ 
  current, 
  total, 
  pageSize, 
  onChange, 
  showTotal = true 
}) => {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  
  if (total === 0) return null;

  const renderPageButtons = () => {
    const buttons = [];
    const maxVisible = 5;
    let start = Math.max(1, current - Math.floor(maxVisible / 2));
    let end = Math.min(totalPages, start + maxVisible - 1);

    if (end - start + 1 < maxVisible) {
      start = Math.max(1, end - maxVisible + 1);
    }

    for (let i = start; i <= end; i++) {
      buttons.push(
        <button
          key={i}
          onClick={() => onChange(i)}
          className={`w-8 h-8 md:w-9 md:h-9 text-xs md:text-sm font-bold rounded-xl transition-all ${
            current === i 
              ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-100 scale-105' 
              : 'bg-white text-slate-500 hover:bg-slate-50 border border-slate-100'
          }`}
        >
          {i}
        </button>
      );
    }
    return buttons;
  };

  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-4 py-4 w-full">
      {showTotal && (
        <div className="text-xs md:text-sm text-slate-400 font-medium">
          共 <span className="text-slate-900 font-bold">{total}</span> 条记录 
          <span className="mx-2 text-slate-200">|</span> 
          第 <span className="text-indigo-600 font-bold">{current}</span> / {totalPages} 页
        </div>
      )}
      
      <div className="flex items-center gap-1.5 md:gap-2">
        <button
          disabled={current === 1}
          onClick={() => onChange(1)}
          className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-xl disabled:opacity-20 disabled:hover:bg-transparent transition-all"
          title="首页"
        >
          <ChevronsLeft className="w-4 h-4 md:w-5 md:h-5" />
        </button>
        <button
          disabled={current === 1}
          onClick={() => onChange(current - 1)}
          className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-xl disabled:opacity-20 disabled:hover:bg-transparent transition-all"
          title="上一页"
        >
          <ChevronLeft className="w-4 h-4 md:w-5 md:h-5" />
        </button>

        <div className="flex items-center gap-1.5 mx-1">
          {renderPageButtons()}
        </div>

        <button
          disabled={current === totalPages}
          onClick={() => onChange(current + 1)}
          className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-xl disabled:opacity-20 disabled:hover:bg-transparent transition-all"
          title="下一页"
        >
          <ChevronRight className="w-4 h-4 md:w-5 md:h-5" />
        </button>
        <button
          disabled={current === totalPages}
          onClick={() => onChange(totalPages)}
          className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-xl disabled:opacity-20 disabled:hover:bg-transparent transition-all"
          title="末页"
        >
          <ChevronsRight className="w-4 h-4 md:w-5 md:h-5" />
        </button>
      </div>
    </div>
  );
};
