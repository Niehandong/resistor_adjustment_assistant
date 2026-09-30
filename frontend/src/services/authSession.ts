import Cookies from 'js-cookie';

// 本地只缓存用户信息用于界面展示（姓名、角色）；登录是否有效以后端 Redis 会话为准
export const USER_COOKIE = 'raUserInfo';
export const USER_STORAGE = 'ra_user';

export const saveLocalUser = (user: unknown) => {
  const data = JSON.stringify(user);
  Cookies.set(USER_COOKIE, data); // 会话级 Cookie，不设固定过期时间，由后端会话决定何时失效
  localStorage.setItem(USER_STORAGE, data);
};

export const clearLocalUser = () => {
  Cookies.remove(USER_COOKIE);
  localStorage.removeItem(USER_STORAGE);
};

// 会话失效：清除本地信息并回到登录页
export const handleSessionExpired = () => {
  clearLocalUser();
  if (window.location.pathname !== '/login') window.location.href = '/login';
};
