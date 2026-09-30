import { useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Menu, Zap } from 'lucide-react';

export const Layout = () => {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const location = useLocation();
  const isAssistantPage = location.pathname.includes('/assistant');

  return (
    // 使用 h-screen overflow-hidden 锁定视口，禁止全局滚动
    <div className="flex h-screen w-screen bg-slate-50 overflow-hidden">
      {/* 侧边栏 */}
      <aside className={`
        fixed inset-y-0 left-0 z-50 w-64 transform transition-transform duration-300 ease-in-out md:translate-x-0
        ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}
        md:relative md:translate-x-0
      `}>
        <Sidebar onNavClick={() => setIsMobileMenuOpen(false)} />
      </aside>

      {/* 遮罩层 */}
      {isMobileMenuOpen && (
        <div className="fixed inset-0 bg-slate-900/60 z-40 md:hidden backdrop-blur-sm" onClick={() => setIsMobileMenuOpen(false)} />
      )}

      {/* 内容主体 */}
      <main className="flex-1 flex flex-col min-w-0 h-full relative">
        {/* 移动端 Header */}
        <header className="md:hidden bg-slate-900 border-b border-slate-800 px-4 py-3 flex items-center justify-between shrink-0 z-30 shadow-lg">
          <div className="flex items-center gap-3">
            <div className="bg-blue-600 p-1.5 rounded-lg"><Zap className="w-5 h-5 text-white" /></div>
            <span className="font-bold text-white tracking-tight">调阻机诊断助手</span>
          </div>
          <button onClick={() => setIsMobileMenuOpen(true)} className="p-2 text-slate-400"><Menu className="w-6 h-6" /></button>
        </header>

        {/* 内容区域：关键在于 flex-1 + min-h-0 + overflow-hidden/auto */}
        <div className={`flex-1 min-h-0 w-full ${isAssistantPage ? '' : 'p-4 md:p-8 lg:p-10 overflow-y-auto'}`}>
          <div className={`${isAssistantPage ? 'h-full w-full' : 'max-w-7xl mx-auto'}`}>
            <Outlet />
          </div>
        </div>
      </main>
    </div>
  );
};
