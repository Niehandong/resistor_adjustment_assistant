import React, { useState, useEffect } from 'react';
import { 
  FileText, 
  Upload, 
  Trash2, 
  Eye, 
  CheckCircle, 
  Clock, 
  AlertCircle,
  Plus,
  X,
  Edit2,
  Save,
  ArrowRight,
  Database,
  Settings,
  RefreshCw,
  Info,
  Calendar,
  Activity,
  ChevronLeft,
  Search,
  Maximize2,
  AlertTriangle,
  User
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import api from '../../services/api';
import { Pagination } from '../Common/Pagination';
import Cookies from 'js-cookie';

interface KnowledgeFile {
  id: number;
  filename: string;
  status: 'uploaded' | 'embedding' | 'embedded' | 'error';
  is_active: boolean;
  separator?: string;
  char_count: number;
  segment_count: number;
  uploader_id?: number;
  uploader_name?: string;
  created_at: string;
  updated_at: string;
}

interface KnowledgeChunk {
  id: number;
  file_id: number;
  content: string;
  char_count: number;
  embedding_time: number;
  creator_id?: number;
  creator_name?: string;
  updater_id?: number;
  updater_name?: string;
  created_at: string;
  updated_at: string;
}

interface ConfirmState {
  show: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  type: 'danger' | 'warning';
}

export function KnowledgeBase() {
  const [files, setFiles] = useState<KnowledgeFile[]>([]);
  const [totalFiles, setTotalFiles] = useState(0);
  const [filePage, setFileFilesPage] = useState(1);
  const [fileKeyword, setFileKeyword] = useState('');
  const [loading, setLoading] = useState(false);
  const [activeStep, setActiveStep] = useState<'list' | 'upload' | 'preview' | 'chunks'>('list');
  
  // Upload & Preview State
  const [selectedFile, setSelectedFile] = useState<{id: number, filename: string} | null>(null);
  const [separator, setSeparator] = useState('##');
  const [previewChunks, setPreviewChunks] = useState<string[]>([]);
  const [expandedPreviewIndices, setExpandedPreviewIndices] = useState<number[]>([]);
  const [previewPage, setPreviewPage] = useState(1);
  const previewSize = 10;
  const [isEmbedding] = useState(false);

  // Chunks View State
  const [viewingFile, setViewingFile] = useState<KnowledgeFile | null>(null);
  const [chunks, setChunks] = useState<KnowledgeChunk[]>([]);
  const [chunkPage, setChunkPage] = useState(1);
  const chunkSize = 10;
  const [selectedChunk, setSelectedChunk] = useState<KnowledgeChunk | null>(null);
  const [editContent, setEditContent] = useState('');
  const [isUpdating, setIsUpdating] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [currentUser, setCurrentUser] = useState<{id: number, name: string} | null>(null);

  // Status Modal State
  const [statusModal, setStatusModal] = useState<{ 
    isOpen: boolean; 
    type: 'success' | 'error' | 'info'; 
    title: string; 
    message: string; 
  }>({ isOpen: false, type: 'success', title: '', message: '' });

  const showStatus = (type: 'success' | 'error' | 'info', title: string, message: string) => {
    setStatusModal({ isOpen: true, type, title, message });
  };

  // Confirmation Modal State
  const [confirm, setConfirm] = useState<ConfirmState>({
    show: false,
    title: '',
    message: '',
    onConfirm: () => {},
    type: 'danger'
  });

  useEffect(() => {
    const userStr = Cookies.get('raUserInfo');
    if (userStr) {
      setCurrentUser(JSON.parse(userStr));
    }
  }, []);

  useEffect(() => {
    if (activeStep === 'list') {
      fetchFiles();
    }
  }, [filePage, activeStep]);

  const fetchFiles = async () => {
    setLoading(true);
    try {
      const res = await api.get('/knowledge/files', { 
        params: { page: filePage, size: 10, keyword: fileKeyword } 
      });
      const data = res as any;
      setFiles(data.items || []);
      setTotalFiles(data.total || 0);
    } catch (error) {
      console.error('Failed to fetch files', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = () => {
    setFileFilesPage(1);
    fetchFiles();
  };

  const uploadFile = async (file: File) => {
    const formData = new FormData();
    formData.append('file', file); // 上传人由后端根据登录会话确定

    setLoading(true);
    try {
      const res = await api.post('/knowledge/upload', formData);
      const data = res as any;
      setSelectedFile({ id: data.id, filename: data.filename });
      setPreviewChunks([]);
      setPreviewPage(1);
      setActiveStep('preview');
    } catch (error) {
      console.error('Upload failed', error);
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) uploadFile(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      const ext = file.name.split('.').pop()?.toLowerCase();
      if (['docx', 'txt', 'md'].includes(ext || '')) {
        uploadFile(file);
      } else {
        alert('仅支持 .docx, .txt, .md 格式的文件');
      }
    }
  };

  const handlePreview = async (fileId: number, sep: string) => {
    setLoading(true);
    try {
      const res = await api.post('/knowledge/preview', { file_id: fileId, separator: sep });
      setPreviewChunks((res as any).chunks);
      setPreviewPage(1);
      setExpandedPreviewIndices([]);
    } catch (error) {
      console.error('Preview failed', error);
    } finally {
      setLoading(false);
    }
  };

  const handleEmbed = async () => {
    if (!selectedFile) return;
    
    try {
      // 立即显示“任务已启动”提示，告知用户可以离开页面
      showStatus('success', '同步任务已启动', `系统已开始对文档《${selectedFile.filename}》进行向量化处理。该过程在后台异步执行，您可以继续进行其他操作，稍后在列表中查看状态。`);
      
      // 执行异步请求
      api.post('/knowledge/embed', { 
        file_id: selectedFile.id, 
        separator,
        chunks: previewChunks
      }).catch(e => {
        console.error('Background embedding error:', e);
      });

      // 立即切换回列表页
      setActiveStep('list');
      setFileFilesPage(1);
      setTimeout(() => fetchFiles(), 500); // 稍后刷新一下列表看到“同步中”状态

    } catch (error) {
      console.error('Submit embedding failed', error);
      showStatus('error', '启动失败', '无法连接到服务器，请检查网络后再试。');
    }
  };

  const fetchChunks = async (file: KnowledgeFile) => {
    setViewingFile(file);
    setLoading(true);
    try {
      const res = await api.get(`/knowledge/chunks/${file.id}`);
      const data = res as unknown as KnowledgeChunk[];
      setChunks(data);
      setSelectedChunk(null);
      setChunkPage(1);
      setActiveStep('chunks');
    } catch (error) {
      console.error('Failed to fetch chunks', error);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateChunk = async () => {
    if (!selectedChunk) return;
    setIsUpdating(true);
    try {
      await api.put(`/knowledge/chunks/${selectedChunk.id}`, { 
        content: editContent
      });
      const updatedChunks = chunks.map(c => c.id === selectedChunk.id ? { 
        ...c, 
        content: editContent, 
        updated_at: new Date().toISOString(),
        updater_name: currentUser?.name || '我'
      } : c);
      setChunks(updatedChunks);
      setSelectedChunk(null);
    } catch (error) {
      console.error('Update failed', error);
    } finally {
      setIsUpdating(false);
    }
  };

  const handleDeleteChunk = (chunkId: number) => {
    setConfirm({
      show: true,
      title: '删除知识分段',
      message: '确定要彻底删除这个知识分段吗？此操作将同步移除向量库数据。',
      type: 'danger',
      onConfirm: async () => {
        try {
          await api.delete(`/knowledge/chunks/${chunkId}`);
          const newChunks = chunks.filter(c => c.id !== chunkId);
          setChunks(newChunks);
          setSelectedChunk(null);
          setConfirm(prev => ({ ...prev, show: false }));
        } catch (error) {
          console.error('Delete failed', error);
        }
      }
    });
  };

  const handleDeleteFile = (fileId: number) => {
    setConfirm({
      show: true,
      title: '删除文档库',
      message: '确定要彻底删除该文档及其全部关联知识点吗？此操作不可逆且将清空所有相关向量数据。',
      type: 'danger',
      onConfirm: async () => {
        try {
          await api.delete(`/knowledge/files/${fileId}`);
          fetchFiles();
          setConfirm(prev => ({ ...prev, show: false }));
        } catch (error) {
          console.error('Delete failed', error);
        }
      }
    });
  };

  const handleToggleFileActive = async (fileId: number) => {
    try {
      const res = await api.put(`/knowledge/files/${fileId}/toggle`);
      const data = res as any;
      setFiles(files.map(f => f.id === fileId ? { ...f, is_active: data.is_active } : f));
    } catch (error) {
      console.error('Toggle failed', error);
    }
  };

  const handleConfigureFile = (file: KnowledgeFile) => {
    setSelectedFile({ id: file.id, filename: file.filename });
    setSeparator(file.separator || '##');
    setPreviewChunks([]);
    setPreviewPage(1);
    setActiveStep('preview');
  };

  const formatDate = (dateStr: string) => {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const h = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');
    const s = String(date.getSeconds()).padStart(2, '0');
    return `${y}-${m}-${d} ${h}:${min}:${s}`;
  };

  const getPagedData = (data: any[], current: number, size: number) => {
    const start = (current - 1) * size;
    return data.slice(start, start + size);
  };

  return (
    <div className="space-y-6 max-w-[1600px] mx-auto px-4 md:px-6 pb-12">
      {/* Custom Confirmation Modal */}
      <AnimatePresence>
        {confirm.show && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-slate-900/40 backdrop-blur-[2px]">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white rounded-[2rem] shadow-2xl w-full max-w-md overflow-hidden border border-slate-100"
            >
              <div className="p-8 text-center space-y-4">
                <div className={`mx-auto w-16 h-16 rounded-full flex items-center justify-center ${confirm.type === 'danger' ? 'bg-red-50 text-red-500' : 'bg-amber-50 text-amber-500'}`}>
                  <AlertTriangle className="w-8 h-8" />
                </div>
                <div className="space-y-2">
                  <h3 className="text-xl font-black text-slate-900">{confirm.title}</h3>
                  <p className="text-sm text-slate-500 leading-relaxed px-4">{confirm.message}</p>
                </div>
              </div>
              <div className="flex border-t border-slate-50">
                <button 
                  onClick={() => setConfirm(prev => ({ ...prev, show: false }))}
                  className="flex-1 py-5 text-sm font-bold text-slate-400 hover:bg-slate-50 transition-colors"
                >
                  取消
                </button>
                <button 
                  onClick={confirm.onConfirm}
                  className={`flex-1 py-5 text-sm font-black text-white transition-all active:opacity-90 ${confirm.type === 'danger' ? 'bg-red-500 hover:bg-red-600' : 'bg-indigo-500 hover:bg-indigo-600'}`}
                >
                  确认执行
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Status Feedback Modal */}
      <AnimatePresence>
        {statusModal.isOpen && (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md flex items-center justify-center z-[110] p-4">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white rounded-3xl p-8 max-w-sm w-full shadow-2xl text-center relative overflow-hidden"
            >
              {/* Top Accent Line */}
              <div className={`absolute top-0 left-0 w-full h-1.5 ${
                statusModal.type === 'success' ? 'bg-emerald-500' : 
                statusModal.type === 'error' ? 'bg-red-500' : 'bg-blue-500'
              }`}></div>
              
              <div className={`mx-auto w-16 h-16 rounded-2xl flex items-center justify-center mb-4 ${
                statusModal.type === 'success' ? 'bg-emerald-50 text-emerald-600' : 
                statusModal.type === 'error' ? 'bg-red-50 text-red-600' : 'bg-blue-50 text-blue-600'
              }`}>
                {statusModal.type === 'success' && <CheckCircle className="w-10 h-10" />}
                {statusModal.type === 'error' && <AlertCircle className="w-10 h-10" />}
                {statusModal.type === 'info' && <RefreshCw className="w-10 h-10 animate-spin" />}
              </div>
              
              <h3 className="text-xl font-bold text-slate-900 mb-2">{statusModal.title}</h3>
              <p className="text-slate-500 text-sm leading-relaxed mb-6">{statusModal.message}</p>
              
              <button 
                onClick={() => setStatusModal({ ...statusModal, isOpen: false })}
                className={`w-full py-3 rounded-xl font-bold text-white transition-all shadow-lg ${
                  statusModal.type === 'success' 
                    ? 'bg-emerald-500 hover:bg-emerald-600 shadow-emerald-900/20' 
                    : statusModal.type === 'error'
                      ? 'bg-red-500 hover:bg-red-600 shadow-red-900/20'
                      : 'bg-blue-500 hover:bg-blue-600 shadow-blue-900/20'
                }`}
              >
                我知道了
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-xl md:text-2xl font-bold text-slate-900">知识库中心</h2>
          <p className="text-slate-500 text-xs md:text-sm">统一管理企业知识资产，为调阻机诊断助手提供专业数据支撑。</p>
        </div>
        <div className="flex w-full sm:w-auto gap-3">
          {activeStep !== 'list' && (
            <button 
              onClick={() => {
                setActiveStep('list');
                setViewingFile(null);
                setSelectedFile(null);
                setSelectedChunk(null);
              }}
              className="flex-1 sm:flex-none px-4 py-2 border border-slate-200 text-slate-600 rounded-xl hover:bg-slate-50 transition-colors flex items-center justify-center gap-2 font-medium bg-white text-sm"
            >
              <ChevronLeft className="w-4 h-4" />
              返回
            </button>
          )}
          {activeStep === 'list' && (
            <button 
              onClick={() => setActiveStep('upload')}
              className="flex-1 sm:flex-none flex items-center justify-center gap-2 bg-indigo-600 text-white px-5 py-2.5 rounded-xl hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100 active:scale-95 font-bold text-sm"
            >
              <Plus className="w-5 h-5" />
              导入知识文档
            </button>
          )}
        </div>
      </div>

      <AnimatePresence mode="wait">
        {activeStep === 'list' && (
          <motion.div 
            key="list"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-4"
          >
            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row gap-4">
               <div className="flex-1 relative">
                  <Search className="w-5 h-5 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2" />
                  <input 
                    type="text" 
                    placeholder="输入文件名进行搜索..."
                    value={fileKeyword}
                    onChange={(e) => setFileKeyword(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                    className="w-full pl-12 pr-4 py-2.5 bg-slate-50 border border-slate-100 rounded-xl focus:ring-4 focus:ring-indigo-100 focus:border-indigo-400 outline-none transition-all text-sm"
                  />
               </div>
               <button 
                onClick={handleSearch}
                className="px-6 py-2.5 bg-slate-900 text-white rounded-xl font-bold hover:bg-slate-800 transition-all text-sm"
               >
                 搜索
               </button>
            </div>

            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full border-collapse min-w-[1200px]">
                  <thead>
                    <tr className="bg-slate-50/80 border-b border-slate-200">
                      <th className="px-6 py-4 text-[13px] font-bold text-slate-400 w-20 text-center uppercase tracking-wider">序号</th>
                      <th className="px-6 py-4 text-[13px] font-bold text-slate-400 text-center uppercase tracking-wider">文档名称</th>
                      <th className="px-6 py-4 text-[13px] font-bold text-slate-400 w-32 text-center uppercase tracking-wider">上传人</th>
                      <th className="px-6 py-4 text-[13px] font-bold text-slate-400 w-44 text-center uppercase tracking-wider">上传时间</th>
                      <th className="px-6 py-4 text-[13px] font-bold text-slate-400 w-32 text-center uppercase tracking-wider">处理状态</th>
                      <th className="px-6 py-4 text-[13px] font-bold text-slate-400 w-44 text-center uppercase tracking-wider">规格 (段/字)</th>
                      <th className="px-6 py-4 text-[13px] font-bold text-slate-400 w-32 text-center uppercase tracking-wider">检索状态</th>
                      <th className="px-6 py-4 text-[13px] font-bold text-slate-400 w-40 text-center uppercase tracking-wider">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {loading ? (
                      <tr><td colSpan={8} className="px-6 py-20 text-center"><RefreshCw className="w-8 h-8 animate-spin mx-auto text-indigo-500 opacity-20" /></td></tr>
                    ) : files.length === 0 ? (
                      <tr><td colSpan={8} className="px-6 py-20 text-center text-slate-400">未找到相关文档</td></tr>
                    ) : (
                      files.map((file, index) => (
                        <tr key={file.id} className="hover:bg-slate-50/30 transition-colors group">
                          <td className="px-6 py-6 text-center"><span className="text-sm font-mono text-slate-400">{((filePage - 1) * 10 + index + 1).toString().padStart(2, '0')}</span></td>
                          <td className="px-6 py-6 text-center font-bold text-slate-800 truncate max-w-[200px]">{file.filename}</td>
                          <td className="px-6 py-6 text-center">
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-slate-100 text-slate-600 rounded-lg text-xs font-bold">
                              <User className="w-3 h-3" />
                              {file.uploader_name || '系统'}
                            </span>
                          </td>
                          <td className="px-6 py-6 text-center text-xs text-slate-400 whitespace-nowrap">{formatDate(file.created_at)}</td>
                          <td className="px-6 py-6 text-center"><StatusBadge status={file.status} /></td>
                          <td className="px-6 py-6 text-center text-xs text-slate-500 font-bold">
                             {file.segment_count} 段 / {file.char_count} 字
                          </td>
                          <td className="px-6 py-6 text-center">
                             <div className="w-20 mx-auto">
                                {file.is_active ? (
                                  <span className="inline-flex items-center gap-1 text-emerald-600 font-bold text-[11px] bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-100 w-full justify-center">
                                    <CheckCircle className="w-3 h-3" /> 可用
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 text-slate-400 font-bold text-[11px] bg-slate-50 px-2 py-0.5 rounded-md border border-slate-200 w-full justify-center">
                                    <X className="w-3 h-3" /> 已禁用
                                  </span>
                                )}
                             </div>
                          </td>
                          <td className="px-6 py-6 text-center">
                             <div className="flex justify-center items-center gap-3">
                                <div 
                                  onClick={() => handleToggleFileActive(file.id)}
                                  className={`relative w-12 h-6 rounded-full cursor-pointer transition-colors duration-300 shadow-inner flex-shrink-0 ${file.is_active ? 'bg-indigo-600' : 'bg-slate-200'}`}
                                >
                                  <motion.div 
                                    animate={{ x: file.is_active ? 26 : 4 }}
                                    transition={{ type: "spring", stiffness: 500, damping: 30 }}
                                    className="absolute top-1 w-4 h-4 bg-white rounded-full shadow-sm"
                                  />
                                </div>

                                <div className="flex gap-1 border-l border-slate-100 pl-3">
                                  {(file.status === 'uploaded' || file.status === 'error') && (
                                    <button onClick={() => handleConfigureFile(file)} className="p-2 text-slate-400 hover:text-indigo-600 transition-colors rounded-lg hover:bg-white" title="配置"><Settings className="w-5 h-5" /></button>
                                  )}
                                  {file.status === 'embedded' && (
                                    <button onClick={() => fetchChunks(file)} className="p-2 text-slate-400 hover:text-indigo-600 transition-colors rounded-lg hover:bg-white" title="详情"><Eye className="w-5 h-5" /></button>
                                  )}
                                  <button onClick={() => handleDeleteFile(file.id)} className="p-2 text-slate-400 hover:text-red-600 transition-colors rounded-lg hover:bg-white" title="删除"><Trash2 className="w-5 h-5" /></button>
                                </div>
                             </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              <div className="bg-slate-50/50 px-6 py-2 border-t border-slate-200">
                 <Pagination current={filePage} total={totalFiles} pageSize={10} onChange={setFileFilesPage} />
              </div>
            </div>
          </motion.div>
        )}

        {activeStep === 'upload' && (
          <motion.div 
            key="upload"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`bg-white p-12 md:p-24 rounded-3xl border-2 border-dashed flex flex-col items-center justify-center space-y-8 shadow-sm transition-all duration-300 ${
              isDragging ? 'border-indigo-500 bg-indigo-50/50 scale-[1.01]' : 'border-slate-200'
            }`}
          >
            <div className={`p-6 md:p-8 rounded-[1.5rem] md:rounded-[2rem] transition-colors duration-300 ${isDragging ? 'bg-indigo-600 text-white' : 'bg-indigo-50 text-indigo-600'}`}>
              <Upload className="w-12 h-12 md:w-16 md:h-16" />
            </div>
            <div className="text-center space-y-3">
              <h3 className="text-xl md:text-3xl font-black text-slate-900">
                {isDragging ? '释放以上传文件' : '导入业务知识文档'}
              </h3>
              <p className="text-slate-500 max-w-lg mx-auto leading-relaxed md:leading-loose text-sm md:text-lg px-4">
                支持拖拽上传或点击下方按钮，仅限 .docx, .txt, .md。
              </p>
            </div>
            {!isDragging && (
              <label className="cursor-pointer bg-slate-950 text-white px-8 md:px-12 py-3 md:py-5 rounded-xl md:rounded-2xl font-black hover:bg-slate-800 transition-all shadow-xl active:scale-95 text-base md:text-xl tracking-tight">
                浏览本地文件
                <input type="file" className="hidden" onChange={handleFileUpload} accept=".docx,.txt,.md" />
              </label>
            )}
          </motion.div>
        )}

        {activeStep === 'preview' && selectedFile && (
          <motion.div 
            key="preview"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            className="grid grid-cols-1 lg:grid-cols-4 gap-6 md:gap-8"
          >
            <div className="lg:col-span-1 space-y-6">
              <div className="bg-white p-6 md:p-8 rounded-2xl shadow-sm border border-slate-200 space-y-6">
                <h3 className="font-black text-slate-900 flex items-center gap-3 text-lg md:text-xl">
                  <Settings className="w-5 h-5 md:w-6 md:h-6 text-indigo-600" />
                  切片策略
                </h3>
                <div className="space-y-4">
                  <label className="text-xs md:text-sm font-black text-slate-700 uppercase tracking-widest">分段分隔符</label>
                  <input 
                    type="text" 
                    value={separator}
                    onChange={(e) => setSeparator(e.target.value)}
                    className="w-full px-4 py-3 md:px-5 md:py-4 border-2 border-slate-100 rounded-xl md:rounded-2xl focus:ring-4 focus:ring-indigo-100 focus:border-indigo-400 outline-none transition-all font-mono text-base md:text-lg"
                    placeholder="例如: ##"
                  />
                  <div className="flex flex-wrap gap-2">
                    {['##', '\\n\\n', '###', '\\n'].map(s => (
                      <button key={s} onClick={() => setSeparator(s)} className={`px-3 py-1.5 md:px-4 md:py-2 text-[10px] md:text-xs font-bold rounded-lg md:rounded-xl transition-all ${separator === s ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-100' : 'bg-slate-50 text-slate-400 hover:bg-slate-100'}`}>{s}</button>
                    ))}
                  </div>
                </div>
                <button onClick={() => handlePreview(selectedFile.id, separator)} disabled={loading} className="w-full py-3 md:py-4 bg-slate-900 text-white rounded-xl hover:bg-slate-800 transition-all font-black flex items-center justify-center gap-3 shadow-xl active:scale-95 text-sm md:text-base">
                  <RefreshCw className={`w-4 h-4 md:w-5 md:h-5 ${loading ? 'animate-spin' : ''}`} />
                  预览切分效果
                </button>
                <div className="pt-6 border-t border-slate-100">
                  <button onClick={handleEmbed} disabled={isEmbedding || previewChunks.length === 0} className="w-full py-4 md:py-5 bg-indigo-600 text-white rounded-xl md:rounded-2xl hover:bg-indigo-700 transition-all shadow-2xl shadow-indigo-200 flex items-center justify-center gap-3 font-black text-base md:text-xl disabled:opacity-50">
                    {isEmbedding ? '正在同步向量库...' : '同步至知识库'}
                    {!isEmbedding && <ArrowRight className="w-5 h-5 md:w-6 md:h-6" />}
                  </button>
                </div>
              </div>

              <div className="bg-indigo-50/50 p-6 rounded-2xl border border-indigo-100 space-y-4">
                <h4 className="text-xs md:text-sm font-bold text-indigo-900 uppercase tracking-widest">预览数据分析</h4>
                <div className="space-y-3">
                   <div className="bg-white p-3 rounded-xl border border-indigo-50 flex justify-between items-center">
                      <p className="text-[10px] text-slate-400 font-bold uppercase">分段数量</p>
                      <p className="text-base md:text-lg font-black text-indigo-600">{previewChunks.length} 段</p>
                   </div>
                   <div className="bg-white p-3 rounded-xl border border-indigo-50 flex justify-between items-center">
                      <p className="text-[10px] text-slate-400 font-bold uppercase">总字符数</p>
                      <p className="text-base md:text-lg font-black text-indigo-600">{previewChunks.reduce((acc, c) => acc + c.length, 0)} 字</p>
                   </div>
                   <div className="pt-2 border-t border-indigo-100">
                      <p className="text-[10px] text-indigo-300 font-bold uppercase mb-1">正在处理文档</p>
                      <p className="text-xs font-bold text-indigo-900 truncate">{selectedFile.filename}</p>
                   </div>
                </div>
              </div>
            </div>

            <div className="lg:col-span-3 space-y-4">
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col h-[500px] md:h-[750px]">
                <div className="bg-slate-50/80 px-4 py-3 md:px-8 md:py-5 border-b border-slate-200 flex justify-between items-center">
                  <h3 className="font-black text-slate-900 text-base md:text-lg">切片结果预览</h3>
                  {previewChunks.length > 0 && <span className="bg-indigo-100 text-indigo-700 px-2 py-0.5 md:px-3 md:py-1 rounded-full text-[10px] md:text-xs font-black">{previewChunks.length} 段</span>}
                </div>
                <div className="flex-1 overflow-auto custom-scrollbar">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse table-fixed min-w-[600px]">
                      <thead>
                        <tr className="bg-white border-b border-slate-100">
                          <th className="px-4 py-3 md:px-8 md:py-4 text-[10px] md:text-[11px] font-black text-slate-400 uppercase w-16 md:w-24 text-center">序号</th>
                          <th className="px-4 py-3 md:px-8 md:py-4 text-[10px] md:text-[11px] font-black text-slate-400 uppercase text-center">分段文本正文预览</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                        {loading ? (
                          <tr><td colSpan={2} className="px-8 py-32 text-center text-slate-400 font-bold">正在计算切片...</td></tr>
                        ) : previewChunks.length > 0 ? (
                          getPagedData(previewChunks, previewPage, previewSize).map((chunk, idx) => {
                            const realIdx = (previewPage - 1) * previewSize + idx;
                            const isExpanded = expandedPreviewIndices.includes(realIdx);
                            
                            return (
                              <tr key={idx} className="hover:bg-slate-50/30 transition-colors">
                                <td className="px-4 py-3 md:px-8 md:py-5 align-top text-center">
                                  <span className="text-[10px] md:text-xs font-mono font-bold text-slate-300">{(realIdx + 1).toString().padStart(3, '0')}</span>
                                </td>
                                <td className="px-4 py-3 md:px-8 md:py-5">
                                  <div className="space-y-2 md:space-y-3">
                                    <p className={`text-xs md:text-sm text-slate-600 leading-relaxed ${isExpanded ? '' : 'line-clamp-2'}`}>
                                      {chunk}
                                    </p>
                                    <button 
                                      onClick={() => {
                                        setExpandedPreviewIndices(prev => 
                                          isExpanded ? prev.filter(i => i !== realIdx) : [...prev, realIdx]
                                        );
                                      }}
                                      className="text-[10px] md:text-[11px] font-bold text-indigo-600 hover:text-indigo-700 flex items-center gap-1 transition-colors"
                                    >
                                      {isExpanded ? (
                                        <>
                                          <ChevronLeft className="w-2.5 h-2.5 md:w-3 md:h-3 rotate-90" />
                                          收起全文
                                        </>
                                      ) : (
                                        <>
                                          <Maximize2 className="w-2.5 h-2.5 md:w-3 md:h-3" />
                                          展开全文
                                        </>
                                      )}
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })
                        ) : (
                          <tr><td colSpan={2} className="px-8 py-32 text-center text-slate-400 font-bold opacity-30">等待预览指令</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
                <div className="bg-slate-50/50 px-4 py-2 border-t border-slate-200">
                   <Pagination current={previewPage} total={previewChunks.length} pageSize={previewSize} onChange={setPreviewPage} />
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {activeStep === 'chunks' && viewingFile && (
          <motion.div 
            key="chunks"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="space-y-6"
          >
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 md:gap-6">
              {[
                { label: '文档分段', value: chunks.length, unit: '片段', icon: Database, color: 'text-blue-600', bg: 'bg-blue-50' },
                { label: '字数总计', value: viewingFile.char_count, unit: '字', icon: Info, color: 'text-emerald-600', bg: 'bg-emerald-50' },
                { label: '平均处理', value: (chunks.reduce((acc, c) => acc + (c.embedding_time || 0), 0) / chunks.length || 0).toFixed(2), unit: 's', icon: Activity, color: 'text-amber-600', bg: 'bg-amber-50' },
                { label: '维护时间', value: formatDate(viewingFile.updated_at).split(' ')[0], unit: '', icon: Calendar, color: 'text-purple-600', bg: 'bg-purple-50' },
              ].map((stat, i) => (
                <div key={i} className="bg-white p-4 md:p-5 rounded-2xl md:rounded-3xl border border-slate-200 shadow-sm flex items-center gap-4 md:gap-5">
                   <div className={`p-3 md:p-4 ${stat.bg} ${stat.color} rounded-xl md:rounded-2xl`}><stat.icon className="w-5 h-5 md:w-6 md:h-6" /></div>
                   <div>
                      <p className="text-[9px] md:text-[10px] font-black text-slate-400 uppercase tracking-widest mb-0.5">{stat.label}</p>
                      <p className="text-xl md:text-2xl font-black text-slate-900 tabular-nums">{stat.value}<span className="text-xs font-bold text-slate-400 ml-1">{stat.unit}</span></p>
                   </div>
                </div>
              ))}
            </div>

            <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden flex flex-col min-h-[500px] md:min-h-[700px]">
              <div className="bg-slate-50/80 px-4 py-3 md:px-8 md:py-5 border-b border-slate-200 flex justify-between items-center">
                <div className="flex items-center gap-2 md:gap-3">
                  <div className="p-1.5 md:p-2 bg-indigo-600 rounded-lg md:rounded-xl"><FileText className="w-4 h-4 md:w-5 md:h-5 text-white" /></div>
                  <h3 className="font-black text-slate-900 text-base md:text-lg truncate max-w-[200px] md:max-w-none">{viewingFile.filename}</h3>
                </div>
              </div>
              
              <div className="flex-1 overflow-auto custom-scrollbar">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse table-fixed min-w-[1200px]">
                    <thead>
                      <tr className="border-b border-slate-100 bg-white">
                        <th className="px-4 py-3 md:px-6 md:py-4 text-[10px] md:text-[11px] font-black text-slate-400 uppercase w-16 md:w-20 text-center">序号</th>
                        <th className="px-4 py-3 md:px-6 md:py-4 text-[10px] md:text-[11px] font-black text-slate-400 uppercase text-center w-[35%]">知识片段内容</th>
                        <th className="px-4 py-3 md:px-6 md:py-4 text-[10px] md:text-[11px] font-black text-slate-400 uppercase text-center">创建信息</th>
                        <th className="px-4 py-3 md:px-6 md:py-4 text-[10px] md:text-[11px] font-black text-slate-400 uppercase text-center">最后修改</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {getPagedData(chunks, chunkPage, chunkSize).map((chunk, idx) => (
                        <tr 
                          key={chunk.id} 
                          onClick={() => { setSelectedChunk(chunk); setEditContent(chunk.content); }}
                          className="group cursor-pointer hover:bg-slate-50/50 transition-colors"
                        >
                          <td className="px-4 py-3 md:px-6 md:py-5 align-top text-center"><span className="text-[10px] md:text-xs font-mono font-black text-slate-300">{((chunkPage-1)*chunkSize + idx + 1).toString().padStart(3, '0')}</span></td>
                          <td className="px-4 py-3 md:px-6 md:py-5"><p className="text-xs md:text-sm text-slate-600 leading-relaxed line-clamp-2 md:line-clamp-3 font-medium">{chunk.content}</p></td>
                          <td className="px-4 py-3 md:px-6 md:py-5 text-center">
                             <div className="flex flex-col items-center gap-1">
                                <span className="text-xs font-bold text-slate-700 inline-flex items-center gap-1">
                                   <User className="w-3 h-3 text-slate-400" />
                                   {chunk.creator_name || viewingFile.uploader_name || '系统'}
                                </span>
                                <span className="text-[10px] text-slate-400 font-mono">{formatDate(chunk.created_at)}</span>
                             </div>
                          </td>
                          <td className="px-4 py-3 md:px-6 md:py-5 text-center">
                             <div className="flex flex-col items-center gap-1">
                                <span className="text-xs font-bold text-indigo-600 inline-flex items-center gap-1">
                                   <RefreshCw className="w-3 h-3 text-indigo-300" />
                                   {chunk.updater_name || chunk.creator_name || '系统'}
                                </span>
                                <span className="text-[10px] text-slate-400 font-mono">{formatDate(chunk.updated_at)}</span>
                             </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              
              <div className="bg-slate-50/50 px-4 py-2 border-t border-slate-200">
                 <Pagination current={chunkPage} total={chunks.length} pageSize={chunkSize} onChange={setChunkPage} />
              </div>
            </div>

            {/* Editing Modal Overlay */}
            <AnimatePresence>
              {selectedChunk && (
                <div 
                  className="fixed inset-0 z-50 flex items-center justify-center p-4 md:p-6 bg-slate-900/60 backdrop-blur-sm select-none"
                  onClick={() => setSelectedChunk(null)}
                >
                  <motion.div 
                    initial={{ scale: 0.95, opacity: 0, y: 20 }}
                    animate={{ scale: 1, opacity: 1, y: 0 }}
                    exit={{ scale: 0.95, opacity: 0, y: 20 }}
                    onClick={(e) => e.stopPropagation()}
                    className="w-full max-w-4xl bg-white rounded-[1.5rem] md:rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col h-[600px] md:h-[800px] max-h-[95vh] md:max-h-[90vh] select-text"
                  >
                    <div className="bg-slate-50 px-6 py-5 md:px-10 md:py-8 border-b border-slate-100 flex items-center justify-between shrink-0">
                      <div className="flex items-center gap-3 md:gap-5">
                        <div className="p-2.5 md:p-3.5 bg-indigo-600 text-white rounded-xl md:rounded-2xl shadow-lg shadow-indigo-100"><Edit2 className="w-5 h-5 md:w-6 md:h-6" /></div>
                        <div>
                          <h4 className="text-lg md:text-2xl font-black text-slate-900">编辑知识分段</h4>
                          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-0.5 md:mt-1">
                            <p className="text-[10px] md:text-xs text-slate-400 font-bold uppercase tracking-widest">最后更新: {formatDate(selectedChunk.updated_at)}</p>
                            <div className="flex items-center gap-1.5 px-2 py-0.5 bg-indigo-50 text-indigo-600 rounded-lg border border-indigo-100/50">
                               <User className="w-3 h-3" />
                               <span className="text-[10px] md:text-xs font-bold uppercase tracking-widest">修改人: {selectedChunk.updater_name || selectedChunk.creator_name || '系统'}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                      <button onClick={() => setSelectedChunk(null)} className="p-1 md:p-2 text-slate-300 hover:text-slate-900 transition-colors"><X className="w-6 h-6 md:w-8 md:h-8" /></button>
                    </div>

                    <div className="flex-1 p-6 md:p-10 overflow-y-auto custom-scrollbar">
                      <div className="space-y-4 md:space-y-6">
                        <div className="flex justify-between items-end px-1">
                           <span className="text-[10px] md:text-xs font-black text-slate-400 uppercase tracking-[0.1em] md:tracking-[0.2em]">片段正文内容</span>
                           <div className="flex gap-2 md:gap-4">
                              <span className="text-[9px] md:text-[11px] font-bold text-slate-400">字数: <span className="text-indigo-600">{editContent.length}</span></span>
                              <span className="text-[9px] md:text-[11px] font-bold text-slate-400 hidden sm:inline">耗时: <span className="text-indigo-600">{selectedChunk.embedding_time}s</span></span>
                           </div>
                        </div>
                        <textarea 
                          value={editContent} onChange={(e) => setEditContent(e.target.value)}
                          className="w-full h-[300px] md:h-[400px] p-6 md:p-10 text-base md:text-lg leading-relaxed md:leading-loose text-slate-700 border-2 border-slate-100 rounded-[1.5rem] md:rounded-[2rem] focus:ring-[8px] md:focus:ring-[12px] focus:ring-indigo-50 focus:border-indigo-400 outline-none resize-none shadow-inner bg-slate-50/30 transition-all font-sans"
                        />
                      </div>
                    </div>

                    <div className="px-6 py-5 md:px-10 md:py-8 bg-slate-50 border-t border-slate-100 flex flex-col md:flex-row justify-between items-center gap-4">
                      <button onClick={() => handleDeleteChunk(selectedChunk.id)} className="w-full md:w-auto px-6 py-3 text-xs md:text-sm font-black text-red-400 hover:text-red-600 flex items-center gap-2 hover:bg-red-50 rounded-xl transition-all">
                        <Trash2 className="w-4 h-4 md:w-5 md:h-5" />彻底删除
                      </button>
                      <div className="flex gap-3 md:gap-4 w-full md:w-auto">
                        <button onClick={() => { setEditContent(selectedChunk.content); setSelectedChunk(null); }} className="flex-1 md:flex-none px-6 md:px-8 py-3 text-xs md:text-sm font-black text-slate-400 hover:text-slate-800">取消</button>
                        <button onClick={handleUpdateChunk} disabled={isUpdating || editContent === selectedChunk.content} className="flex-2 md:flex-none px-6 md:px-10 py-3 md:py-4 bg-indigo-600 text-white rounded-xl md:rounded-2xl hover:bg-indigo-700 font-black flex items-center justify-center gap-2 md:gap-3 shadow-xl shadow-indigo-100 disabled:opacity-50 transition-all active:scale-95 text-xs md:text-sm">
                          {isUpdating ? <RefreshCw className="w-4 h-4 md:w-5 md:h-5 animate-spin" /> : <Save className="w-4 h-4 md:w-5 md:h-5" />}同步更新
                        </button>
                      </div>
                    </div>
                  </motion.div>
                </div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function StatusBadge({ status }: { status: KnowledgeFile['status'] }) {
  switch (status) {
    case 'uploaded':
      return (
        <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-[10px] font-black bg-blue-50 text-blue-600 border border-blue-100 uppercase tracking-tight">
          <Clock className="w-3.5 h-3.5" />
          待处理
        </span>
      );
    case 'embedding':
      return (
        <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-[10px] font-black bg-amber-50 text-amber-600 border border-amber-100 uppercase tracking-tight">
          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
          同步中
        </span>
      );
    case 'embedded':
      return (
        <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-[10px] font-black bg-emerald-50 text-emerald-700 border border-emerald-100 uppercase tracking-tight">
          <CheckCircle className="w-3.5 h-3.5" />
          已完成
        </span>
      );
    case 'error':
      return (
        <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-[10px] font-black bg-red-50 text-red-600 border border-red-100 uppercase tracking-tight">
          <AlertCircle className="w-3.5 h-3.5" />
          异常
        </span>
      );
    default:
      return null;
  }
}
