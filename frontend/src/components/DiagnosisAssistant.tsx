import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Bot, Send, User, Plus, MessageSquare, 
  Pencil, Trash2, Brain, 
  ChevronDown, ChevronRight, Square,
  PanelLeftClose, PanelLeftOpen,
  ThumbsUp, ThumbsDown
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Cookies from 'js-cookie';
import dayjs from 'dayjs';
import api from '../services/api';
import { handleSessionExpired, getStoredSessionId, storeSessionId } from '../services/authSession';

// --- 类型定义 ---
interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  feedback?: number; // 0-none, 1-like, 2-dislike
  timestamp: Date;
}

interface SessionInfo {
  session_id: string;
  title: string;
  like_count?: number;
  dislike_count?: number;
}

// --- 辅助工具 ---
const generateUUID = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
};

const formatAssistantContent = (raw: any): string => {
  if (typeof raw === 'string') return raw;
  if (raw && typeof raw === 'object' && raw.answer) return raw.answer;
  return String(raw || '');
};

// --- 子组件：思考展示 ---
const ThinkingProcess = ({ content, isStreaming }: { content: string; isStreaming?: boolean }) => {
  const [isExpanded, setIsExpanded] = useState(isStreaming || false);
  const thinkMatch = content.match(/<think>([\s\S]*?)(?:<\/think>|$)/);
  const thinkContent = thinkMatch ? thinkMatch[1].trim() : '';
  const mainContent = content.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/<think>[\s\S]*/, '').trim();

  if (!thinkContent && !mainContent) return null;

  return (
    <div className="space-y-4">
      {thinkContent && (
        <div className="border-l-2 border-slate-200 pl-4 my-1">
          <button onClick={() => setIsExpanded(!isExpanded)} className="flex items-center gap-2 text-xs text-slate-400 hover:text-slate-600 mb-1">
            <Brain className="w-3 h-3" />
            <span className="italic font-medium text-[11px]">思考过程</span>
            {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          </button>
          <AnimatePresence>
            {isExpanded && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                <div className="text-xs text-slate-400 italic leading-relaxed whitespace-pre-wrap pb-2">{thinkContent}</div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
      {mainContent && (
        <div className="prose prose-sm max-w-none prose-slate">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{mainContent}</ReactMarkdown>
        </div>
      )}
    </div>
  );
};

// --- 主组件 ---
export const DiagnosisAssistant = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [sessionId, setSessionId] = useState<string>('');
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [isSidebarVisible, setIsSidebarVisible] = useState(window.innerWidth > 1024);
  
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const stoppedByUserRef = useRef(false); // 区分「用户点击停止」与「切换会话导致的中断」

  // 自动调整文本框高度
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 160)}px`;
    }
  }, [input]);

  // 监听窗口大小变化
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth <= 1024 && isSidebarVisible) {
        setIsSidebarVisible(false);
      } else if (window.innerWidth > 1280 && !isSidebarVisible) {
        // 在宽屏上默认展开
        setIsSidebarVisible(true);
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [isSidebarVisible]);

  // 初始化
  useEffect(() => {
    const userStr = Cookies.get('raUserInfo') || localStorage.getItem('ra_user');
    if (userStr) { try { setCurrentUser(JSON.parse(userStr)); } catch (e) {} }

    const user = userStr ? JSON.parse(userStr) : null;
    // 每个账号恢复自己上次的会话，没有则新建
    let sid = user?.id ? getStoredSessionId(user.id) : null;
    if (!sid) {
      sid = generateUUID();
      if (user?.id) storeSessionId(user.id, sid);
    }
    setSessionId(sid);

    if (user?.id) {
      fetchSessions();
      fetchHistory(sid);
    }
  }, []);

  const fetchSessions = async () => {
    try {
      const res: any = await api.get('/diagnosis-assistant/sessions', { params: { limit: 100 } });
      if (res) setSessions(res);
    } catch (e) {}
  };

  const fetchHistory = async (sid: string) => {
    try {
      const data: any = await api.get(`/diagnosis-assistant/history/${sid}`);
      if (data && data.length > 0) {
        const msgs: Message[] = [];
        data.forEach((item: any) => {
          msgs.push({ id: `u-${item.id}`, role: 'user', content: item.query_text, timestamp: new Date(item.created_at) });
          msgs.push({ id: item.id, role: 'assistant', content: formatAssistantContent(item.answer), feedback: item.feedback, timestamp: new Date(item.created_at) });
        });
        setMessages(msgs);
      } else {
        setMessages([{ id: 'welcome', role: 'assistant', content: '你好！我是调阻机诊断助手，请描述设备的故障现象、报警信息或异常表现，我来帮你排查。', timestamp: new Date() }]);
      }
    } catch (e) {}
  };

  const handleNewChat = () => {
    if (isLoading) abortControllerRef.current?.abort();
    const newSid = generateUUID();
    if (currentUser?.id) storeSessionId(currentUser.id, newSid);
    setSessionId(newSid);
    setMessages([{ id: 'welcome', role: 'assistant', content: '开启新会话，请描述您遇到的设备问题。', timestamp: new Date() }]);
    // 在移动端开启新对话后自动收起侧边栏
    if (window.innerWidth <= 1024) setIsSidebarVisible(false);
  };

  const handleSelectSession = (sid: string) => {
    if (isLoading) abortControllerRef.current?.abort();
    setSessionId(sid);
    if (currentUser?.id) {
      storeSessionId(currentUser.id, sid);
      fetchHistory(sid);
    }
    // 在移动端选择会话后自动收起侧边栏
    if (window.innerWidth <= 1024) setIsSidebarVisible(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    // 记录是否是当前会话的第一个问题
    const isNewSession = messages.length <= 1;
    const userMsg: Message = { id: Date.now().toString(), role: 'user', content: input, timestamp: new Date() };
    
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);

    const aiId = (Date.now() + 1).toString();
    setMessages(prev => [...prev, { id: aiId, role: 'assistant', content: '...', timestamp: new Date() }]);

    abortControllerRef.current = new AbortController();
    stoppedByUserRef.current = false;

    try {
      const response = await fetch(`${import.meta.env.VITE_API_URL}/diagnosis-assistant/query/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId, query_text: userMsg.content }),
        signal: abortControllerRef.current.signal
      });

      // 鉴权失败时后端返回 JSON 信封而不是事件流
      if (response.headers.get('content-type')?.includes('application/json')) {
        const res = await response.json();
        if (res.code === 401) return handleSessionExpired();
        setMessages(p => p.map(m => m.id === aiId ? { ...m, content: res.msg || '请求失败' } : m));
        return;
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let streamContent = '';
      let buffer = ''; // 增加缓冲区处理不完整的行

      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // 最后一行可能不完整，留到下一轮

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;
          
          try {
            const data = JSON.parse(trimmed.slice(6));
            if (data.answer) {
              streamContent += data.answer;
              setMessages(p => p.map(m => m.id === aiId ? { ...m, content: streamContent } : m));
            }
            if (data.done) {
              // 会话结束后，如果是新会话的首轮，延迟刷新列表确保数据库写入完成
              if (isNewSession && currentUser?.id) {
                setTimeout(() => fetchSessions(), 500);
              }
              
              if (data.message_id) {
                setMessages(p => p.map(m => m.id === aiId ? { ...m, id: data.message_id } : m));
              }
            }
          } catch (e) {
            console.error('Failed to parse stream data:', trimmed, e);
          }
        }
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        if (stoppedByUserRef.current) {
          // 用户主动停止：标注后从后端重新拉取历史，拿到已保存的消息 ID 以便评价
          setMessages(p => p.map(m => m.id === aiId
            ? { ...m, content: m.content === '...' ? '（已停止生成）' : `${m.content}\n\n（已停止生成）` }
            : m));
          setTimeout(() => fetchHistory(sessionId), 800);
        }
      } else {
        console.error('Stream error:', err);
      }
    } finally { 
      setIsLoading(false); 
    }
  };

  const handleStop = () => {
    stoppedByUserRef.current = true;
    abortControllerRef.current?.abort();
  };

  const handleFeedback = async (messageId: string, feedback: number) => {
    if (!messageId || messageId.startsWith('welcome')) return;
    try {
      await api.post('/diagnosis-assistant/feedback', { message_id: messageId, feedback });
      setMessages(prev => prev.map(m => m.id === messageId ? { ...m, feedback } : m));
    } catch (e) {
      console.error('Feedback failed', e);
      alert(`评价未保存：${e instanceof Error ? e.message : '网络异常'}，请稍后重试`);
    }
  };

  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');

  const handleEditTitle = (e: React.MouseEvent, sid: string, currentTitle: string) => {
    e.stopPropagation();
    setEditingSessionId(sid);
    setEditingTitle(currentTitle);
  };

  const saveTitle = async (sid: string) => {
    if (!editingTitle.trim() || !currentUser?.id) return;
    try {
      await api.put(`/diagnosis-assistant/conversations/${sid}`, {
        title: editingTitle
      });
      setSessions(prev => prev.map(s => s.session_id === sid ? { ...s, title: editingTitle } : s));
      setEditingSessionId(null);
    } catch (e) {
      console.error('Update title failed', e);
    }
  };

  const handleSoftDelete = async (e: React.MouseEvent, sid: string) => {
    e.stopPropagation(); // 阻止触发会话选择
    if (!currentUser?.id) return;
    
    if (!window.confirm('确定要删除这个会话吗？')) return;

    try {
      await api.delete(`/diagnosis-assistant/conversations/${sid}`);
      
      // 更新列表
      setSessions(prev => prev.filter(s => s.session_id !== sid));
      
      // 如果删除的是当前选中的会话，则开启新对话
      if (sessionId === sid) {
        handleNewChat();
      }
    } catch (e) {
      console.error('Delete failed', e);
      alert('删除失败');
    }
  };

  useEffect(() => { 
    if (scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  return (
    <div className="flex h-full w-full bg-white overflow-hidden relative">
      {/* 侧边栏：会话列表 */}
      <aside 
        className={`${isSidebarVisible ? 'w-72 border-r' : 'w-0 border-r-0'} flex flex-col border-slate-100 bg-slate-50/50 shrink-0 transition-all duration-300 ease-in-out overflow-hidden z-20`}
      >
        <div className="p-4 shrink-0 border-b border-slate-100/50 w-72">
          <button onClick={handleNewChat} className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl flex items-center justify-center gap-2 font-medium transition-all shadow-sm active:scale-[0.98] text-sm">
            <Plus className="w-4 h-4" />
            <span>开启新对话</span>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-1 w-72">
          <div className="px-3 py-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest">会话记录</div>
          {sessions.map((s) => (
            <div 
              key={s.session_id} 
              onClick={() => handleSelectSession(s.session_id)}
              className={`group/item flex items-center gap-3 px-4 py-3 rounded-xl cursor-pointer transition-all ${sessionId === s.session_id ? 'bg-blue-50 text-blue-600 font-medium' : 'hover:bg-slate-100 text-slate-600'}`}
            >
              <MessageSquare className="w-4 h-4 shrink-0 opacity-70" />
              {editingSessionId === s.session_id ? (
                <input
                  autoFocus
                  className="flex-1 bg-white border border-blue-300 rounded px-2 py-0.5 text-sm outline-none"
                  value={editingTitle}
                  onChange={e => setEditingTitle(e.target.value)}
                  onBlur={() => saveTitle(s.session_id)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') saveTitle(s.session_id);
                    if (e.key === 'Escape') setEditingSessionId(null);
                  }}
                  onClick={e => e.stopPropagation()}
                />
              ) : (
                <>
                  <span className="flex-1 truncate text-sm">{s.title}</span>
                  <div className="opacity-0 group-hover/item:opacity-100 flex items-center gap-1 transition-all">
                    <button 
                      onClick={(e) => handleEditTitle(e, s.session_id, s.title)}
                      className="p-1 hover:bg-blue-100 hover:text-blue-600 rounded-md transition-all"
                      title="重命名"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button 
                      onClick={(e) => handleSoftDelete(e, s.session_id)}
                      className="p-1 hover:bg-red-50 hover:text-red-500 rounded-md transition-all"
                      title="删除会话"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      </aside>

      {/* 移动端侧边栏遮罩 */}
      {isSidebarVisible && window.innerWidth <= 1024 && (
        <div 
          className="fixed inset-0 bg-slate-900/20 z-10 backdrop-blur-sm lg:hidden" 
          onClick={() => setIsSidebarVisible(false)}
        />
      )}

      {/* 聊天区：Header + Messages + Footer */}
      <section className="flex-1 flex flex-col min-w-0 bg-white relative">
        {/* 固定头部 */}
        <header className="h-14 border-b border-slate-100 flex items-center justify-between px-4 md:px-6 shrink-0 bg-white/80 backdrop-blur-md z-10">
          <div className="flex items-center gap-3">
            <button 
              onClick={() => setIsSidebarVisible(!isSidebarVisible)}
              className="p-2 hover:bg-slate-100 rounded-lg text-slate-500 transition-colors"
              title={isSidebarVisible ? "收起历史记录" : "展开历史记录"}
            >
              {isSidebarVisible ? <PanelLeftClose className="w-5 h-5" /> : <PanelLeftOpen className="w-5 h-5" />}
            </button>
            <div className="h-4 w-[1px] bg-slate-200 mx-1 hidden md:block" />
            <div className="flex items-center gap-2">
              <div className="p-1.5 bg-emerald-50 rounded-lg"><Bot className="w-4 h-4 text-emerald-500" /></div>
              <h2 className="font-bold text-slate-700 text-sm tracking-tight">调阻机诊断助手</h2>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* 可以在这里添加更多操作按钮 */}
          </div>
        </header>

        {/* 关键滚动区：flex-1 + min-h-0 + overflow-y-auto */}
        <div className="flex-1 overflow-y-auto min-h-0 bg-slate-50/20" ref={scrollRef}>
          <div className="max-w-6xl mx-auto p-4 md:p-8 lg:p-10 space-y-6 md:space-y-8">
            {messages.map((m, i) => (
              <div key={m.id} className={`flex gap-3 md:gap-4 ${m.role === 'user' ? 'flex-row-reverse' : ''}`}>
                <div className={`w-8 h-8 md:w-9 md:h-9 rounded-xl flex items-center justify-center shrink-0 ${m.role === 'user' ? 'bg-blue-600' : 'bg-white border border-slate-100 shadow-sm'}`}>
                  {m.role === 'user' ? <User className="w-4 h-4 md:w-5 md:h-5 text-white" /> : <Bot className="w-4 h-4 md:w-5 md:h-5 text-emerald-500" />}
                </div>
                <div className={`max-w-[calc(100%-3.5rem)] md:max-w-[85%] p-3 md:p-4 rounded-2xl shadow-sm ${m.role === 'user' ? 'bg-blue-600 text-white rounded-tr-none' : 'bg-white text-slate-800 rounded-tl-none border border-slate-100'}`}>
                  {m.role === 'assistant' ? (
                    m.content === '...' ? (
                      <div className="flex gap-1 py-1">
                        <div className="w-1.5 h-1.5 bg-slate-300 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                        <div className="w-1.5 h-1.5 bg-slate-300 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                        <div className="w-1.5 h-1.5 bg-slate-300 rounded-full animate-bounce"></div>
                      </div>
                    ) : (
                      <>
                        <ThinkingProcess content={m.content} isStreaming={isLoading && i === messages.length-1} />
                        {!isLoading && m.id !== 'welcome' && (
                          <div className="mt-3 pt-3 border-t border-slate-50 flex items-center gap-4">
                            <button 
                              onClick={() => handleFeedback(m.id, m.feedback === 1 ? 0 : 1)}
                              className={`flex items-center gap-1.5 text-[10px] font-bold transition-colors ${m.feedback === 1 ? 'text-blue-600' : 'text-slate-400 hover:text-slate-600'}`}
                            >
                              <ThumbsUp className={`w-3.5 h-3.5 ${m.feedback === 1 ? 'fill-current' : ''}`} />
                              <span>赞同</span>
                            </button>
                            <button 
                              onClick={() => handleFeedback(m.id, m.feedback === 2 ? 0 : 2)}
                              className={`flex items-center gap-1.5 text-[10px] font-bold transition-colors ${m.feedback === 2 ? 'text-red-500' : 'text-slate-400 hover:text-slate-600'}`}
                            >
                              <ThumbsDown className={`w-3.5 h-3.5 ${m.feedback === 2 ? 'fill-current' : ''}`} />
                              <span>不满意</span>
                            </button>
                          </div>
                        )}
                      </>
                    )
                  ) : (
                    <div className="prose prose-sm prose-invert max-w-none break-words"><ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown></div>
                  )}
                  <div className={`text-[9px] mt-2 opacity-40 ${m.role === 'user' ? 'text-right' : ''}`}>
                    {dayjs(m.timestamp).format('YYYY-MM-DD HH:mm:ss')}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 固定底部输入框 */}
        <footer className="p-4 md:p-6 lg:p-8 border-t border-slate-100 shrink-0 bg-white">
          <form onSubmit={handleSubmit} className="max-w-6xl mx-auto relative">
            <textarea 
              ref={textareaRef}
              value={input} 
              onChange={e => setInput(e.target.value)} 
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit(e);
                }
              }}
              disabled={isLoading}
              placeholder="请描述故障现象、报警代码或异常情况..." 
              rows={1}
              className="w-full py-3 md:py-4 pl-4 md:pl-6 pr-14 md:pr-16 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-blue-500 focus:bg-white outline-none transition-all shadow-inner text-sm resize-none min-h-[44px] max-h-40 overflow-y-auto scrollbar-hide" 
            />
            <button 
              type={isLoading ? 'button' : 'submit'}
              onClick={isLoading ? handleStop : undefined}
              disabled={!isLoading && !input.trim()}
              title={isLoading ? '停止生成' : '发送'}
              className={`absolute right-2 bottom-2 w-9 h-9 md:w-10 md:h-10 rounded-xl flex items-center justify-center text-white transition-all ${isLoading ? 'bg-red-500' : 'bg-blue-600 hover:bg-blue-700 disabled:opacity-50'}`}
            >
              {isLoading ? <Square className="w-4 h-4 md:w-5 md:h-5 fill-current" /> : <Send className="w-4 h-4 md:w-5 md:h-5" />}
            </button>
          </form>
          <div className="max-w-6xl mx-auto mt-2 text-[10px] text-center text-slate-400">
            内容由 AI 生成，请核实重要信息。按 Enter 发送，Shift + Enter 换行。
          </div>
        </footer>
      </section>
    </div>
  );
};
