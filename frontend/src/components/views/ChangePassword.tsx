import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Cookies from 'js-cookie';
import { Lock, ShieldCheck, AlertCircle, CheckCircle2, Eye, EyeOff, User } from 'lucide-react';
import { authService } from '../../services/request';
import { clearLocalUser } from '../../services/authSession';

export function ChangePassword() {
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  // 控制密码可见性的状态
  const [showOld, setShowOld] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  // 获取当前登录用户信息
  const userInfoStr = Cookies.get('raUserInfo');
  const userInfo = userInfoStr ? JSON.parse(userInfoStr) : null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!userInfo?.email) {
      setError('用户信息已失效，请重新登录');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('两次输入的新密码不一致');
      return;
    }

    if (newPassword.length < 6) {
      setError('新密码长度不能少于 6 位');
      return;
    }

    setLoading(true);
    try {
      await authService.changePassword({
        old_password: oldPassword,
        new_password: newPassword
      });

      // 响应拦截器已经处理了 code === 200，并返回了 res.data (此处为 null)
      // 如果没有抛出错误，说明修改成功
      // 后端已退出该账号的全部登录（含当前设备），清除本地信息后跳转登录页
      setSuccess('密码修改成功！请使用新密码重新登录，2 秒后跳转到登录页面...');
      setOldPassword('');
      setNewPassword('');
      setConfirmPassword('');
      clearLocalUser();

      // 延时 2 秒后跳转，让用户看清成功提示
      setTimeout(() => navigate('/login', { replace: true }), 2000);
      
    } catch (err: any) {
      // 这里的 err 是拦截器中 Promise.reject 抛出的 Error 对象
      setError(err.message || '网络请求错误，请重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="bg-white rounded-[2rem] shadow-xl shadow-slate-200/60 border border-slate-100 overflow-hidden">
        {/* 用户信息头部卡片 */}
        <div className="bg-gradient-to-r from-indigo-600 to-violet-600 p-8 sm:p-10 text-white relative">
          <div className="relative z-10 flex items-center gap-6">
            <div className="w-20 h-20 bg-white/20 backdrop-blur-md rounded-3xl flex items-center justify-center border border-white/30 shadow-inner">
              <User className="w-10 h-10 text-white" />
            </div>
            <div>
              <h2 className="text-2xl font-black tracking-tight">{userInfo?.name || '用户'}</h2>
              <p className="text-indigo-100 font-medium mt-1">{userInfo?.email || ''}</p>
            </div>
          </div>
          {/* 装饰元素 */}
          <div className="absolute top-0 right-0 -translate-y-1/2 translate-x-1/4 w-64 h-64 bg-white/10 rounded-full blur-3xl"></div>
          <div className="absolute bottom-0 left-0 translate-y-1/2 -translate-x-1/4 w-48 h-48 bg-indigo-400/20 rounded-full blur-2xl"></div>
        </div>

        <div className="p-8 sm:p-10">
          <div className="mb-8 flex items-center justify-between">
            <h3 className="text-xl font-bold text-slate-800">修改登录密码</h3>
            <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">Change Password</span>
          </div>

          {error && (
            <div className="mb-8 bg-red-50 text-red-600 p-4 rounded-2xl flex items-center gap-3 border border-red-100 animate-in zoom-in-95 duration-200">
              <AlertCircle className="w-5 h-5 shrink-0" />
              <span className="font-bold text-sm">{error}</span>
            </div>
          )}

          {success && (
            <div className="mb-8 bg-emerald-50 text-emerald-600 p-4 rounded-2xl flex items-center gap-3 border border-emerald-100 animate-in zoom-in-95 duration-200">
              <CheckCircle2 className="w-5 h-5 shrink-0" />
              <span className="font-bold text-sm">{success}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            {/* 旧密码 */}
            <div className="space-y-1.5">
              <label className="text-sm font-bold text-slate-700 ml-1">当前旧密码</label>
              <div className="relative group">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 group-focus-within:text-indigo-500 transition-colors" />
                <input 
                  type={showOld ? "text" : "password"} 
                  required
                  value={oldPassword}
                  onChange={e => setOldPassword(e.target.value)}
                  className="w-full pl-12 pr-12 py-3.5 bg-slate-50 border border-slate-200 rounded-2xl outline-none focus:bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 transition-all font-medium"
                  placeholder="请输入当前使用的密码"
                />
                <button 
                  type="button"
                  onClick={() => setShowOld(!showOld)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-indigo-600 transition-colors p-1"
                >
                  {showOld ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
            </div>

            {/* 设置新密码 */}
            <div className="space-y-1.5">
              <label className="text-sm font-bold text-slate-700 ml-1">设置新密码</label>
              <div className="relative group">
                <ShieldCheck className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 group-focus-within:text-indigo-500 transition-colors" />
                <input 
                  type={showNew ? "text" : "password"} 
                  required
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  className="w-full pl-12 pr-12 py-3.5 bg-slate-50 border border-slate-200 rounded-2xl outline-none focus:bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 transition-all font-medium"
                  placeholder="新密码长度不少于 6 位"
                />
                <button 
                  type="button"
                  onClick={() => setShowNew(!showNew)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-indigo-600 transition-colors p-1"
                >
                  {showNew ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
            </div>

            {/* 确认新密码 */}
            <div className="space-y-1.5">
              <label className="text-sm font-bold text-slate-700 ml-1">确认新密码</label>
              <div className="relative group">
                <ShieldCheck className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 group-focus-within:text-indigo-500 transition-colors" />
                <input 
                  type={showConfirm ? "text" : "password"} 
                  required
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  className="w-full pl-12 pr-12 py-3.5 bg-slate-50 border border-slate-200 rounded-2xl outline-none focus:bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 transition-all font-medium"
                  placeholder="请再次输入新密码以确认"
                />
                <button 
                  type="button"
                  onClick={() => setShowConfirm(!showConfirm)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-indigo-600 transition-colors p-1"
                >
                  {showConfirm ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
            </div>

            <div className="pt-6">
              <button 
                type="submit"
                disabled={loading}
                className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white font-black py-4 rounded-2xl shadow-lg shadow-indigo-900/20 active:scale-[0.98] transition-all flex justify-center items-center gap-2"
              >
                {loading ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                    正在提交修改...
                  </>
                ) : '确认修改登录密码'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
