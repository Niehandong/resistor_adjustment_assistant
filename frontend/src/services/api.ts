import axios from 'axios';
import { handleSessionExpired } from './authSession';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL,
  timeout: 10000,
});

if (!import.meta.env.VITE_API_URL) {
  console.error('Environment variable VITE_API_URL is NOT defined!');
}

// 响应拦截器
api.interceptors.response.use(
  (response) => {
    const res = response.data;
    // 如果 code 是 200，说明接口返回正常，直接返回 data 数据
    if (res.code === 200) {
      return res.data;
    }
    // 会话过期或未登录（登录接口本身的 401 是账号密码错误，不跳转）
    if (res.code === 401 && !response.config.url?.endsWith('/login')) {
      handleSessionExpired();
    }
    // 否则报错，并抛出错误信息
    const errorMsg = res.msg || '请求失败';
    console.error('API Business Error:', errorMsg);
    return Promise.reject(new Error(errorMsg));
  },
  (error) => {
    console.error('API HTTP Error:', error.response?.data || error.message);
    return Promise.reject(error);
  }
);

export default api;
