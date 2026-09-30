import React, { useState, useEffect, useRef } from 'react';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { userService, type User } from '../../services/request';
import { Search, Edit, Trash2, Plus, User as UserIcon, ShieldCheck } from 'lucide-react';
import { Pagination } from '../Common/Pagination';

export function UserRolesManagement() {
  const [users, setUsers] = useState<User[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  
  // 搜索和分页状态
  const [keyword, setKeyword] = useState('');
  const [page, setPage] = useState(1);
  const [size] = useState(10);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [formData, setFormData] = useState<User>({ name: '', email: '', gender: '', role: 'user', password: '' });

  const debouncedKeyword = useDebouncedValue(keyword);
  const requestSeq = useRef(0); // 只采用最后一次请求的结果，避免慢响应覆盖新结果

  // 当页码或关键词改变时重新获取数据
  useEffect(() => { 
    fetchUsers(); 
  }, [page, debouncedKeyword]);

  const fetchUsers = async () => {
    const seq = ++requestSeq.current;
    try {
      setLoading(true);
      const response = await userService.list({ keyword: debouncedKeyword, page, size });
      if (seq !== requestSeq.current) return;
      // 根据后端返回的数据结构调整
      const data = response as unknown as { items: User[], total: number };
      setUsers(data.items || []);
      setTotal(data.total || 0);
    } catch (error) { 
      console.error('Error:', error); 
    } finally { 
      if (seq === requestSeq.current) setLoading(false); 
    }
  };

  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    setKeyword(e.target.value);
    setPage(1); // 搜索时重置回第一页
  };

  const handleOpenModal = (user: User | null = null) => {
    if (user) {
      setCurrentUser(user);
      setFormData({ 
        name: user.name, 
        email: user.email, 
        gender: user.gender || '', 
        role: user.role,
        password: '' // 编辑时默认为空，不修改则不填
      });
    } else {
      setCurrentUser(null);
      setFormData({ name: '', email: '', gender: '', role: 'user', password: '' });
    }
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (currentUser?.id) {
        await userService.update(currentUser.id, formData);
      } else {
        await userService.create(formData);
      }
      setIsModalOpen(false);
      fetchUsers();
    } catch (error) { alert(`保存失败：${error instanceof Error ? error.message : '网络异常'}`); }
  };

  const handleDeleteConfirm = async () => {
    if (currentUser?.id) {
      try {
        await userService.delete(currentUser.id);
        setIsDeleteModalOpen(false);
        fetchUsers();
      } catch (error) {
        console.error('Error:', error);
        alert(`删除失败：${error instanceof Error ? error.message : '网络异常'}`);
      }
    }
  };


  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-xl md:text-2xl font-bold text-slate-900">用户与权限管理</h2>
          <p className="text-xs md:text-sm text-slate-500">管理系统所有用户及其访问权限（管理员或普通用户）。</p>
        </div>
        <button 
          onClick={() => handleOpenModal()} 
          className="w-full sm:w-auto bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg font-medium flex items-center justify-center gap-2 transition-colors text-sm"
        >
          <Plus className="w-4 h-4" /> 新增用户
        </button>
      </div>

      {/* 搜索栏 */}
      <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="relative flex-1 md:max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input 
              type="text"
              placeholder="搜索姓名或邮箱..."
              value={keyword}
              onChange={handleSearch}
              className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500/20 outline-none transition-all text-sm"
            />
          </div>
          <div className="text-xs md:text-sm text-slate-500">
            共找到 <span className="font-bold text-indigo-600">{total}</span> 条记录
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm min-w-[800px]">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-medium">
              <tr>
                <th className="px-8 py-4 w-24 text-center">编号</th>
                <th className="px-6 py-4">姓名 / 角色</th>
                <th className="px-6 py-4">性别</th>
                <th className="px-6 py-4">邮箱</th>
                <th className="px-6 py-4 text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && users.length === 0 ? (
                <tr><td colSpan={5} className="px-6 py-8 text-center text-slate-400">加载中...</td></tr>
              ) : users.length === 0 ? (
                <tr><td colSpan={5} className="px-6 py-8 text-center text-slate-400">暂无数据</td></tr>
              ) : (
                users.map((user, index) => (
                  <tr key={user.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-8 py-4 text-center font-mono text-slate-400">{(page - 1) * size + index + 1}</td>
                    <td className="px-6 py-4 font-semibold text-slate-900">
                      <div className="flex flex-col">
                        <div className="flex items-center gap-2">
                          <UserIcon className="w-4 h-4 text-slate-400" />
                          {user.name}
                        </div>
                        <div className="mt-1">
                          {user.role === 'admin' ? (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-100">
                              <ShieldCheck className="w-2.5 h-2.5" /> 管理员
                            </span>
                          ) : (
                            <span className="inline-flex px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-slate-50 text-slate-500 border border-slate-100">
                              普通用户
                            </span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      {user.gender === 'Male' || user.gender === 'Female' ? (
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${user.gender === 'Male' ? 'bg-blue-50 text-blue-700' : 'bg-pink-50 text-pink-700'}`}>
                          {user.gender === 'Male' ? '男' : '女'}
                        </span>
                      ) : (
                        <span className="px-2 py-1 rounded-full text-xs font-medium bg-slate-50 text-slate-400">未设置</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-slate-600">{user.email}</td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button onClick={() => handleOpenModal(user)} className="text-indigo-600 p-2 hover:bg-indigo-50 rounded-lg transition-colors"><Edit className="w-4 h-4"/></button>
                        <button onClick={() => { setCurrentUser(user); setIsDeleteModalOpen(true); }} className="text-red-600 p-2 hover:bg-red-50 rounded-lg transition-colors"><Trash2 className="w-4 h-4"/></button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* 分页控制 */}
        <div className="px-6 py-2 border-t border-slate-100 bg-slate-50/50">
          <Pagination 
            current={page} 
            total={total} 
            pageSize={size} 
            onChange={setPage} 
          />
        </div>
      </div>

      {/* 弹窗部分 */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <form onSubmit={handleSubmit} className="bg-white rounded-2xl p-6 max-w-md w-full space-y-4 shadow-2xl animate-in zoom-in-95 duration-200">
            <h3 className="text-xl font-bold text-slate-900">{currentUser ? '编辑用户' : '新增用户'}</h3>
            <div className="space-y-1">
              <label className="text-sm font-semibold text-slate-700">姓名</label>
              <input type="text" placeholder="姓名" required value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className="w-full border border-slate-200 p-2 rounded-lg outline-none focus:border-indigo-500 transition-all text-slate-900" />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-semibold text-slate-700">邮箱</label>
              <input type="email" placeholder="邮箱" required value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} className="w-full border border-slate-200 p-2 rounded-lg outline-none focus:border-indigo-500 transition-all text-slate-900" />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-semibold text-slate-700">密码</label>
              <input 
                type="password" 
                placeholder={currentUser ? "留空则不修改密码" : "留空则使用默认密码 111111"} 
                value={formData.password} 
                onChange={e => setFormData({...formData, password: e.target.value})} 
                className="w-full border border-slate-200 p-2 rounded-lg outline-none focus:border-indigo-500 transition-all text-slate-900" 
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-sm font-semibold text-slate-700">性别</label>
                <select value={formData.gender ?? ''} onChange={e => setFormData({...formData, gender: e.target.value})} className="w-full border border-slate-200 p-2 rounded-lg outline-none focus:border-indigo-500 transition-all text-slate-900">
                  <option value="">未设置</option>
                  <option value="Male">男</option>
                  <option value="Female">女</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-sm font-semibold text-slate-700">角色</label>
                <select value={formData.role} onChange={e => setFormData({...formData, role: e.target.value})} className="w-full border border-slate-200 p-2 rounded-lg outline-none focus:border-indigo-500 transition-all text-slate-900 font-bold">
                  <option value="user">普通用户</option>
                  <option value="admin">管理员</option>
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-3 pt-4">
              <button type="button" onClick={() => setIsModalOpen(false)} className="px-4 py-2 font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">取消</button>
              <button type="submit" className="bg-indigo-600 text-white px-6 py-2 rounded-lg font-medium shadow-lg shadow-indigo-900/20 transition-all">保存</button>
            </div>
          </form>
        </div>
      )}

      {isDeleteModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            <h3 className="text-lg font-bold text-red-600">确认删除?</h3>
            <p className="my-4 text-slate-600">确定要删除用户 <span className="font-bold text-slate-900">{currentUser?.name}</span> 吗？此操作不可撤销。</p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setIsDeleteModalOpen(false)} className="px-4 py-2 font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">取消</button>
              <button onClick={handleDeleteConfirm} className="bg-red-600 text-white px-6 py-2 rounded-lg font-medium shadow-lg shadow-red-900/20 transition-all">确认删除</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
