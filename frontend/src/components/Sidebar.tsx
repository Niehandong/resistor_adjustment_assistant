import React, { useState, useEffect } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import Cookies from 'js-cookie';
import { authService } from '../services/request';
import { clearLocalUser } from '../services/authSession';
import { 
  Zap, 
  ChevronRight, 
  Bot,
  LogOut,
  User as UserIcon,
  Users,
  Key,
  Shield,
  BarChart2,
  MessageSquareText
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

// 定义导航项结构
export type NavItem = {
  name: string;
  id: string;
  icon: React.ElementType;
  path?: string;
  roles?: string[]; // 允许访问的角色
  children?: {
    name: string;
    id: string;
    icon: React.ElementType;
    path: string;
    roles?: string[];
  }[];
};

export const navigation: NavItem[] = [
  {
    name: '诊断助手',
    id: 'assistant',
    icon: Bot,
    path: '/assistant',
    roles: ['admin', 'user']
  },
  {
    name: '管理看板',
    id: 'admin-dashboard',
    icon: Shield,
    roles: ['admin'],
    children: [
      { name: '知识库管理', id: 'knowledge-base', icon: BarChart2, path: '/knowledge-base', roles: ['admin'] },
      { name: '会话记录', id: 'conversation-records', icon: MessageSquareText, path: '/conversation-records', roles: ['admin'] },
      { name: '用户管理', id: 'user-management', icon: Users, path: '/users', roles: ['admin'] },
    ]
  },
  {
    name: '个人中心',
    id: 'profile',
    icon: UserIcon,
    roles: ['admin', 'user'],
    children: [
      { name: '修改密码', id: 'change-password', icon: Key, path: '/change-password', roles: ['admin', 'user'] },
    ]
  },
];

export function Sidebar({ onNavClick }: { onNavClick?: () => void }) {
  const navigate = useNavigate();
  const [user, setUser] = useState<{name: string, email: string, role: string}>({ 
    name: '未知用户', 
    email: '', 
    role: 'user' 
  });
  
  // 记录展开的分组
  const [expandedGroups, setExpandedGroups] = useState<string[]>(['admin-dashboard', 'profile']);

  useEffect(() => {
    // 兼容两套系统的存储方式
    const userInfoStr = Cookies.get('raUserInfo') || localStorage.getItem('ra_user');
    if (userInfoStr) {
      try {
        const userData = JSON.parse(userInfoStr);
        setUser(userData);
      } catch (e) {
        console.error('Failed to parse user info', e);
      }
    }
  }, []);

  const toggleGroup = (groupId: string) => {
    setExpandedGroups(prev => 
      prev.includes(groupId) 
        ? prev.filter(id => id !== groupId) 
        : [...prev, groupId]
    );
  };

  const handleLogout = async () => {
    try {
      await authService.logout(); // 删除服务端会话
    } catch {
      // 会话已失效时同样视为退出成功
    }
    clearLocalUser();
    navigate('/login');
  };

  // 根据角色过滤导航项
  const filteredNavigation = navigation.filter(item => {
    if (item.roles && !item.roles.includes(user.role)) return false;
    return true;
  }).map(item => {
    if (item.children) {
      return {
        ...item,
        children: item.children.filter(child => !child.roles || child.roles.includes(user.role))
      };
    }
    return item;
  });

  return (
    <div className="w-64 bg-slate-900 text-slate-300 h-screen flex flex-col border-r border-slate-800 shadow-2xl">
      <div className="p-7 border-b border-slate-800 flex items-center gap-3 bg-slate-950/50 backdrop-blur-sm">
        <div className="bg-blue-600 p-2 rounded-xl shadow-lg shadow-blue-500/20">
          <Zap className="w-6 h-6 text-white" />
        </div>
        <h1 className="text-xl font-bold tracking-tight text-white">调阻机诊断助手</h1>
      </div>

      <nav className="flex-1 px-4 py-6 space-y-1 overflow-y-auto">
        {filteredNavigation.map((item) => {
          const isExpanded = expandedGroups.includes(item.id);
          const hasChildren = item.children && item.children.length > 0;

          return (
            <div key={item.id} className="space-y-1">
              {hasChildren ? (
                <>
                  <button
                    onClick={() => toggleGroup(item.id)}
                    className="w-full flex items-center justify-between px-4 py-2 rounded-lg transition-all text-slate-400 hover:text-white hover:bg-slate-800"
                  >
                    <div className="flex items-center gap-3">
                      <item.icon className="w-5 h-5" />
                      <span className="font-semibold text-sm">{item.name}</span>
                    </div>
                    <ChevronRight className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                  </button>
                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div 
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden pl-11 space-y-1"
                      >
                        {item.children?.map(child => (
                          <NavLink 
                            key={child.id}
                            to={child.path}
                            onClick={onNavClick}
                            className={({ isActive }) => 
                              `block w-full text-left py-2 text-sm transition-all ${isActive ? 'text-blue-400 font-medium' : 'text-slate-500 hover:text-slate-300'}`
                            }
                          >
                            {child.name}
                          </NavLink>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </>
              ) : (
                <NavLink 
                  to={item.path!}
                  onClick={onNavClick}
                  className={({ isActive }) => 
                    `w-full flex items-center gap-3 px-4 py-2 rounded-lg transition-all ${isActive ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-800'}`
                  }
                >
                  <item.icon className="w-5 h-5" />
                  <span className="font-semibold text-sm">{item.name}</span>
                </NavLink>
              )}
            </div>
          );
        })}
      </nav>
      
      <div className="p-4 border-t border-slate-800 bg-slate-950/40 backdrop-blur-md">
        <div className="flex items-center gap-3 px-3 py-3 mb-3 rounded-xl bg-slate-900/50 border border-slate-800/50">
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center text-sm font-bold text-white shrink-0 shadow-inner">
            {user.name.substring(0, 1).toUpperCase()}
          </div>
          <div className="flex-1 overflow-hidden">
            <p className="text-sm font-semibold text-white truncate">{user.name}</p>
            <p className="text-[10px] text-slate-500 truncate leading-tight mb-1">{user.email}</p>
            <span className="inline-flex px-2 py-0.5 text-[9px] font-bold bg-blue-500/10 text-blue-400 rounded-full border border-blue-500/20 uppercase tracking-wider">
              {user.role === 'admin' ? 'Administrator' : 'Standard User'}
            </span>
          </div>
        </div>
        <button 
          onClick={handleLogout}
          className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded-xl transition-all group"
        >
          <LogOut className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
          <span className="font-medium">退出系统</span>
        </button>
      </div>
    </div>
  );
}
