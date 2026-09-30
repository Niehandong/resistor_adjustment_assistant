import React, { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import Cookies from 'js-cookie';
import { authService } from './services/request';
import { USER_COOKIE, clearLocalUser, saveLocalUser } from './services/authSession';
import { Layout } from './components/Layout';
import LoginPage from './pages/Login';
import AssistantPage from './pages/Assistant';
import { KnowledgeBase } from './components/views/KnowledgeBase';
import { UserRolesManagement } from './components/views/UserRolesManagement';
import { ChangePassword } from './components/views/ChangePassword';
import { ConversationRecords } from './components/views/ConversationRecords';

// 认证守卫：本地有用户信息才进入；进入后向后端确认会话，并同步最新的姓名/角色
const AuthGuard = ({ children }: { children: React.ReactNode }) => {
  const location = useLocation(); // 通过 useLocation 强制每次路由变动时重新渲染组件
  const [, setSynced] = useState(0);
  const userInfoStr = Cookies.get(USER_COOKIE);

  useEffect(() => {
    if (!Cookies.get(USER_COOKIE)) return;
    // 会话失效时 api 拦截器会清除本地信息并跳转登录页
    authService.me()
      .then(res => { if (res?.user) { saveLocalUser(res.user); setSynced(v => v + 1); } })
      .catch(() => {});
  }, []);

  if (!userInfoStr) {
    clearLocalUser();
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  return <>{children}</>;
};

// 角色守卫
const RoleGuard = ({ children, role }: { children: React.ReactNode, role: string }) => {
  useLocation(); // 同样在角色守卫中监听
  const userInfoStr = Cookies.get(USER_COOKIE);
  if (userInfoStr) {
    try {
      const user = JSON.parse(userInfoStr);
      if (user.role === role) {
        return <>{children}</>;
      }
    } catch (e) {}
  }
  return <Navigate to="/assistant" replace />;
};

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        
        <Route 
          path="/" 
          element={
            <AuthGuard>
              <Layout />
            </AuthGuard>
          }
        >
          <Route index element={<Navigate to="/assistant" replace />} />
          
          {/* 用户和管理员通用页面 */}
          <Route path="assistant" element={<AssistantPage />} />
          <Route path="change-password" element={<ChangePassword />} />

          {/* 仅管理员页面 */}
          <Route 
            path="knowledge-base" 
            element={
              <RoleGuard role="admin">
                <KnowledgeBase />
              </RoleGuard>
            } 
          />
          <Route 
            path="conversation-records" 
            element={
              <RoleGuard role="admin">
                <ConversationRecords />
              </RoleGuard>
            } 
          />
          <Route 
            path="users" 
            element={
              <RoleGuard role="admin">
                <UserRolesManagement />
              </RoleGuard>
            } 
          />
          
          <Route path="*" element={<Navigate to="/assistant" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
