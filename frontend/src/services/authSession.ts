import Cookies from 'js-cookie';

// 本地只缓存用户信息用于界面展示（姓名、角色）；登录是否有效以后端 Redis 会话为准
export const USER_COOKIE = 'raUserInfo';
export const USER_STORAGE = 'ra_user';

export const saveLocalUser = (user: unknown) => {
  const data = JSON.stringify(user);
  Cookies.set(USER_COOKIE, data); // 会话级 Cookie，不设固定过期时间，由后端会话决定何时失效
  localStorage.setItem(USER_STORAGE, data);
};

// 诊断助手「当前会话」按账号分别记录，避免同一浏览器切换账号后沿用他人的会话
const SESSION_ID_KEY = 'diagnosis_assistant_session_id';
const LEGACY_SESSION_ID_KEY = SESSION_ID_KEY; // 旧版本不区分账号的键

export const getStoredSessionId = (userId: number) => localStorage.getItem(`${SESSION_ID_KEY}:${userId}`);

export const storeSessionId = (userId: number, sessionId: string) => {
  localStorage.setItem(`${SESSION_ID_KEY}:${userId}`, sessionId);
};

export const clearLocalUser = () => {
  Cookies.remove(USER_COOKIE);
  localStorage.removeItem(USER_STORAGE);
  localStorage.removeItem(LEGACY_SESSION_ID_KEY);
};

// 会话失效：清除本地信息并回到登录页
export const handleSessionExpired = () => {
  clearLocalUser();
  if (window.location.pathname !== '/login') window.location.href = '/login';
};
