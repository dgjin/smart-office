import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, BookOpen, CheckCircle2, CircleHelp, Search, Sparkles, X } from 'lucide-react';
import { canUseHelpTopic, HELP_TOPICS, searchHelpTopics, type HelpTopic, type SystemView } from '../helpCatalog';

interface HelpDrawerProps {
  open: boolean;
  topicId?: string;
  roles: string[];
  allowedViews: ReadonlySet<SystemView>;
  onClose: () => void;
  onNavigate: (view: SystemView) => void;
  onAsk: (question: string) => void;
}

const categories: Array<'全部' | HelpTopic['category']> = ['全部', '会议与空间', '流程与会务', '系统管理'];

export default function HelpDrawer({ open, topicId, roles, allowedViews, onClose, onNavigate, onAsk }: HelpDrawerProps) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<(typeof categories)[number]>('全部');
  const [selectedId, setSelectedId] = useState<string>();
  const [question, setQuestion] = useState('');
  const drawerRef = useRef<HTMLElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const roleTopics = useMemo(() => HELP_TOPICS.filter(topic => canUseHelpTopic(topic, roles, allowedViews)), [roles, allowedViews]);
  const visibleTopics = useMemo(() => searchHelpTopics(query, roleTopics).filter(topic => category === '全部' || topic.category === category), [query, category, roleTopics]);
  const selected = visibleTopics.find(topic => topic.id === selectedId) || visibleTopics[0];

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setCategory('全部');
    setQuestion('');
    setSelectedId(topicId);
  }, [open, topicId]);

  useEffect(() => {
    if (selected && selected.id !== selectedId) setSelectedId(selected.id);
  }, [selected?.id, selectedId]);

  useEffect(() => {
    if (!open) return;
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const timer = window.setTimeout(() => searchRef.current?.focus(), 80);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !drawerRef.current) return;
      const focusable = [...drawerRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')]
        .filter(element => element.getAttribute('aria-hidden') !== 'true');
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('keydown', onKeyDown);
      if (returnFocusRef.current?.isConnected) returnFocusRef.current.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  const ask = (text: string) => {
    const message = text.trim();
    if (message) onAsk(message);
  };

  return (
    <div className="help-drawer-layer fixed inset-0 z-[160] flex justify-end">
      <button type="button" className="help-drawer-backdrop absolute inset-0" aria-label="关闭帮助" onClick={onClose} />
      <aside ref={drawerRef} className="help-drawer relative h-full w-full sm:w-[500px] flex flex-col" role="dialog" aria-modal="true" aria-labelledby="help-drawer-title">
        <header className="help-drawer-header shrink-0">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="help-drawer-mark"><BookOpen size={20} /></span>
              <div>
                <span className="help-drawer-kicker">OFFICE GUIDE / 功能支持</span>
                <h2 id="help-drawer-title">帮助与智能指导</h2>
              </div>
            </div>
            <button type="button" className="help-icon-button" aria-label="关闭帮助抽屉" onClick={onClose}><X size={18} /></button>
          </div>
          <p>按当前角色展示可用功能。操作指南与智办助手使用同一功能目录。</p>
        </header>

        <div className="help-drawer-tools shrink-0">
          <label className="help-search">
            <Search size={16} aria-hidden="true" />
            <span className="sr-only">搜索功能指南</span>
            <input ref={searchRef} value={query} maxLength={100} onChange={event => setQuery(event.target.value)} placeholder="搜索预约、审批、报表、设备…" />
            {query && <button type="button" aria-label="清空搜索" onClick={() => setQuery('')}><X size={14} /></button>}
          </label>
          <div className="help-category-tabs" role="tablist" aria-label="指南分类">
            {categories.map(item => <button key={item} type="button" role="tab" aria-selected={category === item} onClick={() => setCategory(item)}>{item}</button>)}
          </div>
        </div>

        <div className="help-drawer-body flex-1 min-h-0 overflow-y-auto custom-scrollbar">
          <section className="help-smart-card" aria-labelledby="smart-help-title">
            <div className="flex items-start gap-3">
              <span className="help-smart-icon"><Sparkles size={17} /></span>
              <div>
                <h3 id="smart-help-title">智能帮助</h3>
                <p>直接描述问题，智办会结合当前功能与权限给出指引。</p>
              </div>
            </div>
            <form onSubmit={event => { event.preventDefault(); ask(question); }}>
              <label className="sr-only" htmlFor="help-agent-question">向智办描述问题</label>
              <input id="help-agent-question" value={question} maxLength={500} onChange={event => setQuestion(event.target.value)} placeholder={selected ? `例如：${selected.title}要注意什么？` : '例如：如何申请会议室？'} />
              <button type="submit" disabled={!question.trim()} aria-label="发送智能帮助问题"><ArrowRight size={16} /></button>
            </form>
          </section>

          <div className="help-result-meta"><span>{query || category !== '全部' ? '筛选结果' : '全部功能指南'}</span><strong>{visibleTopics.length} 项</strong></div>
          {!visibleTopics.length ? (
            <div className="help-empty">
              <CircleHelp size={26} />
              <h3>没有找到匹配指南</h3>
              <p>换一个关键词，或让智办根据你的问题查找操作方法。</p>
              <button type="button" onClick={() => ask(query ? `我在系统中遇到“${query}”相关问题，请提供操作指导。` : '请介绍我可以使用的系统功能。')}>询问智办</button>
            </div>
          ) : (
            <div className="help-topic-layout">
              <nav className="help-topic-list" aria-label="功能指南列表">
                {visibleTopics.map(topic => <button key={topic.id} type="button" className={selected?.id === topic.id ? 'active' : ''} aria-pressed={selected?.id === topic.id} onClick={() => setSelectedId(topic.id)}><span>{topic.title}</span><small>{topic.category}</small></button>)}
              </nav>
              {selected && (
                <article className="help-topic-detail" aria-live="polite">
                  <span className="help-topic-category">{selected.category}</span>
                  <h3>{selected.title}</h3>
                  <p className="help-topic-summary">{selected.summary}</p>
                  <ol>
                    {selected.steps.map((step, index) => <li key={step}><span>{index + 1}</span><p>{step}</p></li>)}
                  </ol>
                  {selected.note && <div className="help-topic-note"><CheckCircle2 size={15} /><p>{selected.note}</p></div>}
                  <div className="help-topic-actions">
                    <button type="button" className="help-primary-action" onClick={() => onNavigate(selected.view)}>打开功能<ArrowRight size={15} /></button>
                    <button type="button" className="help-secondary-action" onClick={() => ask(`请结合系统当前功能，详细说明“${selected.title}”怎么操作，以及有哪些权限和提交限制。`)}><Sparkles size={14} />针对此指南提问</button>
                  </div>
                </article>
              )}
            </div>
          )}
        </div>
        <footer className="help-drawer-footer shrink-0">仅显示当前身份可用指南 · 高影响操作须在正式页面确认</footer>
      </aside>
    </div>
  );
}
