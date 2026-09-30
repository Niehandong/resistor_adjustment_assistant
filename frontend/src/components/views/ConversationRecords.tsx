import React, { useState, useEffect } from 'react';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Search, Eye, X, CheckCircle2, XCircle, ThumbsUp, ThumbsDown, Clock, Cpu, Database, Brain,
  ChevronDown, ChevronRight, Ban, FileText, RotateCcw, User as UserIcon, Bot, GitBranch, Trash2, Copy, Check
} from 'lucide-react';
import api from '../../services/api';
import { Pagination } from '../Common/Pagination';
import { DateRangeFilter } from '../Common/DateRangeFilter';

// --- 类型定义 ---
interface ConversationItem {
  id: string;
  title: string | null;
  user_id: number | null;
  user_name: string | null;
  status: number;
  message_count: number;
  error_count: number;
  like_count: number;
  dislike_count: number;
  create_time: string;
  last_message_at: string;
}

interface MessageItem {
  id: string;
  user_name: string | null;
  query_text: string;
  answer: string;
  is_error: boolean;
  feedback: number;
  source_count: number;
  top_score: number | null;
  total_duration_ms: number | null;
  total_tokens: number | null;
  has_trace: boolean;
  created_at: string;
}

interface SourceItem {
  file_id: number | null;
  chunk_id: number | null;
  source: string | null;
  score: number;
  content: string;
}

interface RetrievalHit extends SourceItem {
  rank: number;
  blocked: boolean;
}

interface TraceStep {
  seq: number;
  step_type: 'embedding' | 'retrieval' | 'llm' | string;
  name: string | null;
  detail: Record<string, unknown> | null;
  output_preview: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  duration_ms: number | null;
  error: string | null;
}

interface MessageDetail {
  id: string;
  query_text: string;
  answer: string;
  sources: SourceItem[];
  is_error: boolean;
  created_at: string;
  traces: TraceStep[];
}

interface Filters {
  keyword: string;
  user_name: string;
  has_error: string;
  has_dislike: string;
  start_date: string;
  end_date: string;
}

const EMPTY_FILTERS: Filters = { keyword: '', user_name: '', has_error: '', has_dislike: '', start_date: '', end_date: '' };

const STEP_META: Record<string, { label: string; icon: React.ElementType; color: string; bar: string }> = {
  embedding: { label: '查询向量化', icon: Cpu, color: 'text-sky-600 bg-sky-50 border-sky-100', bar: 'bg-sky-400' },
  retrieval: { label: '知识库检索', icon: Database, color: 'text-emerald-600 bg-emerald-50 border-emerald-100', bar: 'bg-emerald-400' },
  llm: { label: '大模型生成', icon: Brain, color: 'text-indigo-600 bg-indigo-50 border-indigo-100', bar: 'bg-indigo-400' },
};

const formatTime = (iso: string) => (iso ? iso.replace('T', ' ').slice(0, 19) : '-');
const formatMs = (ms: number | null | undefined) => {
  if (ms === null || ms === undefined) return '-';
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms}ms`;
};

// 相似度得分着色：越高越可信
const scoreClass = (score: number | null | undefined) => {
  if (score === null || score === undefined) return 'text-slate-400';
  if (score >= 0.7) return 'text-emerald-600';
  if (score >= 0.5) return 'text-amber-600';
  return 'text-red-500';
};

const FeedbackBadge = ({ feedback }: { feedback: number }) => {
  if (feedback === 1) return <span className="inline-flex items-center gap-1 text-emerald-600 text-xs"><ThumbsUp className="w-3.5 h-3.5" />赞同</span>;
  if (feedback === 2) return <span className="inline-flex items-center gap-1 text-red-500 text-xs"><ThumbsDown className="w-3.5 h-3.5" />不满意</span>;
  return <span className="text-slate-300 text-xs">-</span>;
};

const StatusBadge = ({ isError }: { isError: boolean }) => isError ? (
  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap bg-red-50 text-red-600 border border-red-100"><XCircle className="w-3 h-3" />失败</span>
) : (
  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap bg-emerald-50 text-emerald-600 border border-emerald-100"><CheckCircle2 className="w-3 h-3" />成功</span>
);

// --- 复制到剪贴板 ---
// 内网通过 http://IP 访问时 navigator.clipboard 不可用（仅限 https / localhost），回退到 execCommand
const copyText = async (text: string) => {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  try {
    if (!document.execCommand('copy')) throw new Error('复制失败');
  } finally {
    document.body.removeChild(textarea);
  }
};

const CopyButton = ({ text, title = '复制' }: { text: string; title?: string }) => {
  const [copied, setCopied] = useState(false);
  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation(); // 避免触发所在行的点击
    try {
      await copyText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      alert('复制失败，请手动选择复制');
    }
  };
  return (
    <button
      onClick={handleCopy}
      title={copied ? '已复制' : title}
      className={`shrink-0 inline-flex items-center gap-1 p-1 rounded-md transition-colors ${copied ? 'text-emerald-600' : 'text-slate-400 hover:text-indigo-600 hover:bg-indigo-50'}`}
    >
      {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
      {copied && <span className="text-[11px] font-medium">已复制</span>}
    </button>
  );
};

// --- 可折叠文本块 ---
const Collapsible = ({ title, children, defaultOpen = false }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-slate-200 rounded-lg overflow-hidden">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center gap-2 px-3 py-2 bg-slate-50 hover:bg-slate-100 text-xs font-semibold text-slate-600 transition-colors">
        {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        {title}
      </button>
      {open && <div className="p-3 bg-white">{children}</div>}
    </div>
  );
};

// --- 链路步骤卡片 ---
const TraceStepCard = ({ step, answer }: { step: TraceStep; answer?: string }) => {
  const meta = STEP_META[step.step_type] || { label: step.step_type, icon: FileText, color: 'text-slate-600 bg-slate-50 border-slate-100', bar: 'bg-slate-400' };
  const Icon = meta.icon;
  const d = step.detail || {};
  const hits = (d.hits as RetrievalHit[] | undefined) || [];

  return (
    <div className={`relative pl-10 pb-6 last:pb-0`}>
      <div className="absolute left-[15px] top-8 bottom-0 w-px bg-slate-200" />
      <div className={`absolute left-0 top-0 w-8 h-8 rounded-full border flex items-center justify-center ${step.error ? 'text-red-600 bg-red-50 border-red-200' : meta.color}`}>
        <Icon className="w-4 h-4" />
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-2 min-h-8">
        <span className="font-bold text-slate-800 text-sm">{step.seq + 1}. {meta.label}</span>
        {step.name && <span className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">{step.name}</span>}
        <span className="inline-flex items-center gap-1 text-xs text-slate-500"><Clock className="w-3 h-3" />{formatMs(step.duration_ms)}</span>
        {step.total_tokens !== null && (
          <span className="text-xs text-slate-500">tokens：{step.prompt_tokens} + {step.completion_tokens} = <b className="text-slate-700">{step.total_tokens}</b></span>
        )}
      </div>

      {step.error && (
        <div className="mb-2 p-3 rounded-lg bg-red-50 border border-red-100 text-xs text-red-700 break-all">
          <b>错误：</b>{step.error}
        </div>
      )}

      {step.step_type === 'embedding' && (
        <div className="text-xs text-slate-600 space-y-1">
          <div><span className="text-slate-400">查询文本：</span>{String(d.query ?? '')}</div>
          {d.dimension !== undefined && <div><span className="text-slate-400">向量维度：</span>{String(d.dimension)}</div>}
        </div>
      )}

      {step.step_type === 'retrieval' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            <div className="p-2 rounded-lg bg-slate-50"><div className="text-slate-400">启用文件数</div><div className="font-bold text-slate-700">{String(d.active_file_count ?? '-')}</div></div>
            <div className="p-2 rounded-lg bg-slate-50"><div className="text-slate-400">召回上限</div><div className="font-bold text-slate-700">{String(d.limit ?? '-')}</div></div>
            <div className="p-2 rounded-lg bg-slate-50"><div className="text-slate-400">有效命中</div><div className="font-bold text-emerald-600">{String(d.hit_count ?? '-')}</div></div>
            <div className="p-2 rounded-lg bg-slate-50"><div className="text-slate-400">停用拦截</div><div className="font-bold text-amber-600">{String(d.blocked_count ?? '-')}</div></div>
          </div>
          {d.expr !== undefined && (
            <div className="text-xs"><span className="text-slate-400">过滤条件：</span><code className="font-mono text-slate-600 break-all">{String(d.expr)}</code></div>
          )}
          {hits.length > 0 ? (
            <div className="space-y-2">
              {hits.map(h => (
                <div key={h.rank} className={`p-3 rounded-lg border text-xs ${h.blocked ? 'border-amber-200 bg-amber-50/50 opacity-70' : 'border-slate-200 bg-white'}`}>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-1.5">
                    <span className="font-bold text-slate-500">#{h.rank}</span>
                    <span className={`font-mono font-bold ${scoreClass(h.score)}`}>{h.score.toFixed(4)}</span>
                    <span className="text-slate-700 font-medium">{h.source || '未知来源'}</span>
                    <span className="text-slate-400">文件 {h.file_id ?? '-'} · 切片 {h.chunk_id ?? '-'}</span>
                    {h.blocked && <span className="inline-flex items-center gap-1 text-amber-700"><Ban className="w-3 h-3" />文件已停用，已拦截</span>}
                  </div>
                  <div className="text-slate-600 whitespace-pre-wrap break-words leading-relaxed">{h.content}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-xs text-slate-500 whitespace-pre-wrap">{step.output_preview || '无命中'}</div>
          )}
        </div>
      )}

      {step.step_type === 'llm' && (
        <div className="space-y-2">
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div className="p-2 rounded-lg bg-slate-50"><div className="text-slate-400">首字耗时</div><div className="font-bold text-slate-700">{formatMs(d.first_token_ms as number | undefined)}</div></div>
            <div className="p-2 rounded-lg bg-slate-50"><div className="text-slate-400">历史轮数</div><div className="font-bold text-slate-700">{String(d.history_rounds ?? '-')}</div></div>
            <div className="p-2 rounded-lg bg-slate-50"><div className="text-slate-400">参考资料数</div><div className="font-bold text-slate-700">{String(d.reference_count ?? '-')}</div></div>
          </div>
          {d.user_message !== undefined && (
            <Collapsible title="发送给大模型的内容（问题 + 参考资料）">
              <pre className="text-xs text-slate-600 whitespace-pre-wrap break-words font-sans leading-relaxed max-h-96 overflow-y-auto">{String(d.user_message)}</pre>
            </Collapsible>
          )}
          <Collapsible title="模型回答" defaultOpen>
            <div className="prose prose-sm max-w-none prose-slate break-words">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{answer || step.output_preview || '（未生成回答）'}</ReactMarkdown>
            </div>
          </Collapsible>
        </div>
      )}
    </div>
  );
};

// --- 第三层：检索过程抽屉 ---
const TraceDrawer = ({ messageId, onClose }: { messageId: string; onClose: () => void }) => {
  const [detail, setDetail] = useState<MessageDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'trace' | 'sources'>('trace');

  useEffect(() => {
    setLoading(true);
    setError('');
    setTab('trace');
    api.get(`/conversation-records/messages/${messageId}`)
      .then(res => setDetail(res as unknown as MessageDetail))
      .catch(e => setError(e instanceof Error ? e.message : '加载失败'))
      .finally(() => setLoading(false));
  }, [messageId]);

  const totalMs = detail?.traces.reduce((sum, t) => sum + (t.duration_ms || 0), 0) || 0;

  return (
    <div className="fixed inset-0 z-[60] flex justify-end">
      <div className="absolute inset-0 bg-slate-900/30" onClick={onClose} />
      <div className="relative w-full max-w-4xl h-full bg-white shadow-2xl flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div className="min-w-0">
            <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2"><GitBranch className="w-5 h-5 text-indigo-600" />检索过程</h3>
            {detail && <p className="text-xs text-slate-500 mt-0.5 truncate">问题：{detail.query_text}</p>}
          </div>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors shrink-0"><X className="w-5 h-5" /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {loading ? (
            <div className="text-center text-slate-400 py-20">加载中...</div>
          ) : error || !detail ? (
            <div className="text-center text-red-500 py-20">{error || '记录不存在'}</div>
          ) : (
            <>
              <div className="flex gap-1 border-b border-slate-200 mb-4">
                {([['trace', '检索过程'], ['sources', `引用来源（${detail.sources.length}）`]] as const).map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => setTab(key)}
                    className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors ${tab === key ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {tab === 'trace' && (
                detail.traces.length === 0 ? (
                  <div className="p-4 rounded-xl bg-slate-50 text-xs text-slate-400 text-center">该记录没有链路追踪数据（链路追踪上线前的历史记录）</div>
                ) : (
                  <>
                    <div className="text-xs text-slate-500 mb-3">总耗时 <b className="text-slate-700">{formatMs(totalMs)}</b></div>
                    {/* 耗时占比条 */}
                    {totalMs > 0 && (
                      <div className="mb-5">
                        <div className="flex h-2 rounded-full overflow-hidden bg-slate-100">
                          {detail.traces.map(t => (
                            <div key={t.seq} className={t.error ? 'bg-red-400' : (STEP_META[t.step_type]?.bar || 'bg-slate-400')} style={{ width: `${((t.duration_ms || 0) / totalMs) * 100}%` }} title={`${STEP_META[t.step_type]?.label || t.step_type}：${formatMs(t.duration_ms)}`} />
                          ))}
                        </div>
                        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
                          {detail.traces.map(t => (
                            <span key={t.seq} className="inline-flex items-center gap-1.5 text-[11px] text-slate-500">
                              <span className={`w-2 h-2 rounded-full ${t.error ? 'bg-red-400' : (STEP_META[t.step_type]?.bar || 'bg-slate-400')}`} />
                              {STEP_META[t.step_type]?.label || t.step_type} {formatMs(t.duration_ms)}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    <div>{detail.traces.map(t => <TraceStepCard key={t.seq} step={t} answer={t.step_type === 'llm' ? detail.answer : undefined} />)}</div>
                  </>
                )
              )}

              {tab === 'sources' && (
                detail.sources.length === 0 ? (
                  <div className="p-4 rounded-xl bg-slate-50 text-xs text-slate-400 text-center">本轮没有引用任何知识库内容</div>
                ) : (
                  <div className="space-y-2">
                    {detail.sources.map((s, i) => (
                      <Collapsible key={i} defaultOpen title={`参考资料 ${i + 1} · ${s.source || '未知来源'} · 切片 ${s.chunk_id ?? '-'} · 得分 ${s.score.toFixed(4)}`}>
                        <div className="text-xs text-slate-600 whitespace-pre-wrap break-words leading-relaxed">{s.content}</div>
                      </Collapsible>
                    ))}
                  </div>
                )
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

// --- 第二层：会话详情抽屉（一问一答时间线） ---
const ConversationDrawer = ({ conversation, onClose }: { conversation: ConversationItem; onClose: () => void }) => {
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [traceMessageId, setTraceMessageId] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError('');
    api.get(`/conversation-records/conversations/${conversation.id}/messages`)
      .then(res => setMessages((res as unknown as { messages: MessageItem[] }).messages || []))
      .catch(e => setError(e instanceof Error ? e.message : '加载失败'))
      .finally(() => setLoading(false));
  }, [conversation.id]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-3xl h-full bg-slate-50 shadow-2xl flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-white">
          <div className="min-w-0">
            <h3 className="text-lg font-bold text-slate-900 truncate flex items-center gap-2">
              {conversation.title || '新会话'}
              {conversation.status === 2 && <span className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-slate-100 text-slate-500"><Trash2 className="w-3 h-3" />用户已删除</span>}
            </h3>
            <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-1">
              {conversation.user_name || '未知用户'} · 共 {conversation.message_count} 轮 · <span className="font-mono">{conversation.id}</span>
              <CopyButton text={conversation.id} title="复制会话ID" />
            </p>
          </div>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors shrink-0"><X className="w-5 h-5" /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {loading ? (
            <div className="text-center text-slate-400 py-20">加载聊天记录中...</div>
          ) : error ? (
            <div className="text-center text-red-500 py-20">{error}</div>
          ) : messages.length === 0 ? (
            <div className="text-center text-slate-400 py-20">该会话暂无问答记录</div>
          ) : (
            <div className="space-y-6">
              {messages.map((m, idx) => (
                <div key={m.id} className="space-y-3">
                  <div className="flex items-center gap-2 text-[11px] text-slate-400">
                    <span className="font-bold">第 {idx + 1} 轮</span>
                    <span>{formatTime(m.created_at)}</span>
                    <span className="flex-1 h-px bg-slate-200" />
                  </div>

                  {/* 用户提问 */}
                  <div className="flex gap-3">
                    <div className="w-8 h-8 shrink-0 rounded-full bg-indigo-600 text-white flex items-center justify-center"><UserIcon className="w-4 h-4" /></div>
                    <div className="flex-1 min-w-0 p-3 rounded-xl bg-indigo-50 border border-indigo-100">
                      <div className="text-xs font-bold text-indigo-700 mb-1">{m.user_name || '用户'}</div>
                      <div className="text-sm text-slate-800 whitespace-pre-wrap break-words">{m.query_text}</div>
                    </div>
                  </div>

                  {/* 助手回答 */}
                  <div className="flex gap-3">
                    <div className={`w-8 h-8 shrink-0 rounded-full flex items-center justify-center ${m.is_error ? 'bg-red-500 text-white' : 'bg-slate-800 text-white'}`}><Bot className="w-4 h-4" /></div>
                    <div className={`flex-1 min-w-0 rounded-xl border bg-white ${m.is_error ? 'border-red-200' : 'border-slate-200'}`}>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 border-b border-slate-100 text-xs">
                        <span className="font-bold text-slate-700">诊断助手</span>
                        <StatusBadge isError={m.is_error} />
                        <span className="text-slate-500">引用 <b className="text-slate-700">{m.source_count}</b> 条 · 最高分 <b className={`font-mono ${scoreClass(m.top_score)}`}>{m.top_score !== null ? m.top_score.toFixed(4) : '-'}</b></span>
                        <span className="text-slate-500 inline-flex items-center gap-1"><Clock className="w-3 h-3" />{formatMs(m.total_duration_ms)}</span>
                        {m.total_tokens !== null && <span className="text-slate-500">{m.total_tokens} tokens</span>}
                        <FeedbackBadge feedback={m.feedback} />
                        <button
                          onClick={() => setTraceMessageId(m.id)}
                          className="ml-auto inline-flex items-center gap-1 px-2 py-1 rounded-md text-indigo-600 hover:bg-indigo-50 font-semibold transition-colors"
                        >
                          <GitBranch className="w-3.5 h-3.5" />查看检索过程
                        </button>
                      </div>
                      <div className="p-3 prose prose-sm max-w-none prose-slate break-words">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.answer || '（未成功生成回答）'}</ReactMarkdown>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {traceMessageId && <TraceDrawer messageId={traceMessageId} onClose={() => setTraceMessageId(null)} />}
    </div>
  );
};

// --- 第一层：会话记录列表 ---
export function ConversationRecords() {
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [size] = useState(10);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [viewing, setViewing] = useState<ConversationItem | null>(null);

  // 文本框防抖，下拉框和日期立即生效
  const debouncedKeyword = useDebouncedValue(filters.keyword);
  const debouncedUserName = useDebouncedValue(filters.user_name);
  const { has_error, has_dislike, start_date, end_date } = filters;

  useEffect(() => {
    let ignore = false; // 条件变化后丢弃过期请求的结果，避免慢响应覆盖新结果
    const fetchConversations = async () => {
      try {
        setLoading(true);
        // 只传非空的筛选条件
        const effective: Filters = { keyword: debouncedKeyword, user_name: debouncedUserName, has_error, has_dislike, start_date, end_date };
        const params: Record<string, string | number> = { page, size };
        (Object.keys(effective) as (keyof Filters)[]).forEach(k => { if (effective[k] !== '') params[k] = effective[k]; });
        const res = await api.get('/conversation-records/conversations', { params });
        if (ignore) return;
        const data = res as unknown as { items: ConversationItem[]; total: number };
        setConversations(data.items || []);
        setTotal(data.total || 0);
      } catch (error) {
        if (!ignore) console.error('Error:', error);
      } finally {
        if (!ignore) setLoading(false);
      }
    };
    fetchConversations();
    return () => { ignore = true; };
  }, [page, size, debouncedKeyword, debouncedUserName, has_error, has_dislike, start_date, end_date]);

  const updateFilter = (key: keyof Filters, value: string) => {
    setFilters(prev => ({ ...prev, [key]: value }));
    setPage(1); // 筛选变化时回到第一页
  };

  const inputClass = 'border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all text-slate-700 bg-white';

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl md:text-2xl font-bold text-slate-900">会话记录</h2>
        <p className="text-xs md:text-sm text-slate-500">查看所有用户的诊断会话，逐轮回看问答内容，并可查看每个问题的检索过程，便于排查问题。</p>
      </div>

      {/* 筛选栏 */}
      <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="relative sm:col-span-2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input type="text" placeholder="搜索会话标题、会话ID或提问内容..." value={filters.keyword} onChange={e => updateFilter('keyword', e.target.value)} className={`${inputClass} w-full pl-10`} />
          </div>
          <input type="text" placeholder="提问用户" value={filters.user_name} onChange={e => updateFilter('user_name', e.target.value)} className={inputClass} />
          <div className="grid grid-cols-2 gap-3">
            <select value={filters.has_error} onChange={e => updateFilter('has_error', e.target.value)} className={inputClass}>
              <option value="">全部状态</option>
              <option value="true">含失败问答</option>
              <option value="false">全部成功</option>
            </select>
            <select value={filters.has_dislike} onChange={e => updateFilter('has_dislike', e.target.value)} className={inputClass}>
              <option value="">全部反馈</option>
              <option value="true">含不满意</option>
              <option value="false">无不满意</option>
            </select>
          </div>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2 text-sm text-slate-500">
            <DateRangeFilter
              start={filters.start_date}
              end={filters.end_date}
              onChange={(start_date, end_date) => { setFilters(prev => ({ ...prev, start_date, end_date })); setPage(1); }}
            />
            <button onClick={() => { setFilters(EMPTY_FILTERS); setPage(1); }} className="inline-flex items-center gap-1 px-3 py-2 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors">
              <RotateCcw className="w-4 h-4" />重置
            </button>
          </div>
          <div className="text-xs md:text-sm text-slate-500">
            共找到 <span className="font-bold text-indigo-600">{total}</span> 个会话
          </div>
        </div>
      </div>

      {/* 列表 */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm min-w-[1080px]">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-medium whitespace-nowrap">
              <tr>
                <th className="px-6 py-4">会话ID</th>
                <th className="px-4 py-4 min-w-[160px]">会话标题</th>
                <th className="px-4 py-4 w-24">用户</th>
                <th className="px-3 py-4 w-16 text-center">轮数</th>
                <th className="px-3 py-4 w-16 text-center">失败</th>
                <th className="px-3 py-4 w-28 text-center">赞同 / 不满意</th>
                <th className="px-4 py-4">创建 / 最近活动</th>
                <th className="px-6 py-4 w-28 text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && conversations.length === 0 ? (
                <tr><td colSpan={8} className="px-6 py-8 text-center text-slate-400">加载中...</td></tr>
              ) : conversations.length === 0 ? (
                <tr><td colSpan={8} className="px-6 py-8 text-center text-slate-400">暂无数据</td></tr>
              ) : (
                conversations.map(c => (
                  <tr key={c.id} className="hover:bg-slate-50/50 transition-colors cursor-pointer" onClick={() => setViewing(c)}>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-1">
                        <span className="font-mono text-xs text-slate-500 whitespace-nowrap">{c.id}</span>
                        <CopyButton text={c.id} title="复制会话ID" />
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-slate-900 line-clamp-1" title={c.title || ''}>{c.title || '新会话'}</span>
                        {c.status === 2 && <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-500">已删除</span>}
                      </div>
                    </td>
                    <td className="px-4 py-4 text-slate-700 whitespace-nowrap">{c.user_name || '-'}</td>
                    <td className="px-3 py-4 text-center font-semibold text-slate-700">{c.message_count}</td>
                    <td className="px-3 py-4 text-center">
                      {c.error_count > 0 ? <span className="inline-flex items-center gap-1 text-red-600 font-semibold"><XCircle className="w-3.5 h-3.5" />{c.error_count}</span> : <span className="text-slate-300">0</span>}
                    </td>
                    <td className="px-3 py-4 text-center text-xs whitespace-nowrap">
                      <span className={c.like_count > 0 ? 'text-emerald-600 font-semibold' : 'text-slate-300'}>{c.like_count}</span>
                      <span className="text-slate-300 mx-1.5">/</span>
                      <span className={c.dislike_count > 0 ? 'text-red-500 font-semibold' : 'text-slate-300'}>{c.dislike_count}</span>
                    </td>
                    <td className="px-4 py-4 font-mono text-xs whitespace-nowrap">
                      <div className="text-slate-500">{formatTime(c.create_time)}</div>
                      <div className="text-slate-400 mt-0.5">{formatTime(c.last_message_at)}</div>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button onClick={e => { e.stopPropagation(); setViewing(c); }} className="inline-flex items-center gap-1 text-indigo-600 px-2 py-1.5 hover:bg-indigo-50 rounded-lg transition-colors text-xs font-semibold whitespace-nowrap">
                        <Eye className="w-4 h-4" />查看记录
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="px-6 py-2 border-t border-slate-100 bg-slate-50/50">
          <Pagination current={page} total={total} pageSize={size} onChange={setPage} />
        </div>
      </div>

      {viewing && <ConversationDrawer conversation={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}
