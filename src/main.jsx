import React, {useEffect, useMemo, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import './styles.css';

const LS_KEY = 'evidence-workbench-v1';
const OLD_KEY = 'research-library';
const VERSION = 1;
const STANCES = ['支持', '反驳', '存疑'];
const STANCE_CLASS = {'支持': 'support', '反驳': 'refute', '存疑': 'doubt'};

const seedPapers = [
  {id: 'p1', title: 'The Extended Mind', authors: 'Clark, A. & Chalmers, D.', year: 1998, venue: 'Analysis', tags: ['具身认知', '经典'], abstract: '本文提出心智延展论：当外部环境稳定地承担认知功能时，心智边界可以超越头脑与身体。', status: '阅读中', cite: 'Clark, A. & Chalmers, D. (1998). The Extended Mind. Analysis.'},
  {id: 'p2', title: 'Situated Learning', authors: 'Lave, J. & Wenger, E.', year: 1991, venue: 'Cambridge University Press', tags: ['学习科学', '社会'], abstract: '学习发生在真实情境的参与过程中，知识与共同体实践不可分割。', status: '待读', cite: 'Lave, J. & Wenger, E. (1991). Situated Learning.'},
  {id: 'p3', title: 'Designing with Data', authors: 'Miller, S.', year: 2022, venue: 'MIT Press', tags: ['设计研究', '方法'], abstract: '一套面向设计师的数据研究方法，讨论如何把定性洞察转化为可行动的设计决策。', status: '已读', cite: 'Miller, S. (2022). Designing with Data.'},
];

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `id-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);

// 统一把所有 id 规范为字符串（select 值、JSON 导入、旧数据都可能是数字）
// 同时兜底清洗字段类型，避免历史损坏数据（如 tags 含对象）导致渲染崩溃
const asStr = (v, d = '') => (typeof v === 'string' ? v : d);
const asTags = v => (Array.isArray(v) ? v.filter(t => typeof t === 'string') : []);
const asYear = v => {
  const n = typeof v === 'number' ? v : parseInt(v, 10);
  return Number.isFinite(n) ? n : new Date().getFullYear();
};
const normalizeDb = db => ({
  version: VERSION,
  papers: (db.papers || []).map(p => ({
    ...p,
    id: String(p.id),
    title: asStr(p.title),
    authors: asStr(p.authors),
    venue: asStr(p.venue),
    abstract: asStr(p.abstract),
    status: asStr(p.status, '待读'),
    cite: asStr(p.cite),
    notes: asStr(p.notes),
    year: asYear(p.year),
    tags: asTags(p.tags),
  })),
  projects: (db.projects || []).map(p => ({...p, id: String(p.id), name: asStr(p.name), question: asStr(p.question)})),
  links: (db.links || []).map(l => ({
    ...l,
    id: String(l.id ?? uid()),
    projectId: String(l.projectId),
    paperId: String(l.paperId),
    stance: STANCES.includes(l.stance) ? l.stance : '存疑',
    excerpt: asStr(l.excerpt),
    note: asStr(l.note),
  })),
});

function loadDb() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const db = JSON.parse(raw);
      if (db && Array.isArray(db.papers) && Array.isArray(db.projects) && Array.isArray(db.links)) return normalizeDb(db);
    }
    const old = JSON.parse(localStorage.getItem(OLD_KEY) || 'null');
    if (Array.isArray(old) && old.length) return normalizeDb({papers: old, projects: [], links: []});
  } catch { /* fall through to seed */ }
  return normalizeDb({papers: seedPapers, projects: [], links: []});
}

// 导入校验：版本、字段类型、重复数据全部通过才返回 db，任何失败都不触碰本地数据
const isOptStr = v => v == null || typeof v === 'string';
function validateImport(data) {
  const err = error => ({ok: false, error});
  if (!data || typeof data !== 'object' || Array.isArray(data)) return err('文件不是有效的 JSON 对象');
  if (data.version !== VERSION) return err(`数据版本不支持：${data.version ?? '缺失 version 字段'}（当前仅支持 v${VERSION}）`);
  const {papers, projects, links} = data;
  if (!Array.isArray(papers) || !Array.isArray(projects) || !Array.isArray(links)) return err('缺少 papers / projects / links 数组字段');

  const paperIds = new Set();
  for (const [i, p] of papers.entries()) {
    if (!p || typeof p !== 'object') return err(`第 ${i + 1} 篇文献不是对象`);
    if (p.id == null || typeof p.title !== 'string' || !p.title.trim()) return err(`第 ${i + 1} 篇文献缺少 id 或 title 字段`);
    if (paperIds.has(String(p.id))) return err(`文献 id 重复：${String(p.id)}`);
    paperIds.add(String(p.id));
    if (p.tags != null && (!Array.isArray(p.tags) || p.tags.some(t => typeof t !== 'string'))) return err(`文献「${p.title}」的 tags 必须是字符串数组`);
    if (![p.authors, p.venue, p.abstract, p.status, p.cite, p.notes].every(isOptStr)) return err(`文献「${p.title}」存在类型错误的字段（作者/出版物/摘要/状态/引用/笔记应为字符串）`);
    if (p.year != null && !(typeof p.year === 'number' && Number.isFinite(p.year)) && !(typeof p.year === 'string' && p.year.trim() !== '' && !isNaN(+p.year))) return err(`文献「${p.title}」的 year 必须是数字`);
  }
  const projectIds = new Set();
  for (const [i, p] of projects.entries()) {
    if (!p || typeof p !== 'object') return err(`第 ${i + 1} 个项目不是对象`);
    if (p.id == null || typeof p.name !== 'string' || !p.name.trim()) return err(`第 ${i + 1} 个项目缺少 id 或 name 字段`);
    if (projectIds.has(String(p.id))) return err(`项目 id 重复：${String(p.id)}`);
    projectIds.add(String(p.id));
    if (!isOptStr(p.question)) return err(`项目「${p.name}」的 question 必须是字符串`);
  }
  const pairSet = new Set();
  const linkIds = new Set();
  for (const [i, l] of links.entries()) {
    if (!l || typeof l !== 'object') return err(`第 ${i + 1} 条关联不是对象`);
    if (!projectIds.has(String(l.projectId))) return err(`第 ${i + 1} 条关联引用了不存在的项目：${String(l.projectId)}`);
    if (!paperIds.has(String(l.paperId))) return err(`第 ${i + 1} 条关联引用了不存在的文献：${String(l.paperId)}`);
    if (!STANCES.includes(l.stance)) return err(`第 ${i + 1} 条关联立场无效：${String(l.stance)}（应为 ${STANCES.join('/')}）`);
    if (!isOptStr(l.excerpt) || !isOptStr(l.note)) return err(`第 ${i + 1} 条关联的 excerpt/note 必须是字符串`);
    if (l.id != null) {
      const lid = String(l.id);
      if (linkIds.has(lid)) return err(`关联 id 重复：${lid}`);
      linkIds.add(lid);
    }
    const key = `${l.projectId}::${l.paperId}`;
    if (pairSet.has(key)) return err(`重复关联：项目 ${String(l.projectId)} 与文献 ${String(l.paperId)}`);
    pairSet.add(key);
  }
  return {ok: true, db: normalizeDb({papers, projects, links})};
}

const emptyPaperForm = {title: '', authors: '', year: '2024', venue: '', abstract: '', tags: ''};
const emptyLinkForm = {paperId: '', stance: '支持', excerpt: '', note: ''};

function App() {
  const [db, setDb] = useState(loadDb);
  const [undoStack, setUndoStack] = useState([]);
  const [notice, setNotice] = useState('');
  const [view, setView] = useState('library');

  // 文献库
  const [selectedPaperId, setSelectedPaperId] = useState(null);
  const [query, setQuery] = useState('');
  const [tag, setTag] = useState('全部');
  const [showPaperModal, setShowPaperModal] = useState(false);
  const [paperForm, setPaperForm] = useState(emptyPaperForm);

  // 项目
  const [activeProjectId, setActiveProjectId] = useState(null);
  const [showProjectModal, setShowProjectModal] = useState(false);
  const [projectForm, setProjectForm] = useState({name: '', question: ''});
  const [linkModal, setLinkModal] = useState(false);
  const [linkForm, setLinkForm] = useState(emptyLinkForm);
  const [editLinkId, setEditLinkId] = useState(null);
  const [editForm, setEditForm] = useState(emptyLinkForm);
  const [stanceFilter, setStanceFilter] = useState('全部');
  const [linkTagFilter, setLinkTagFilter] = useState('全部');
  const [batchMode, setBatchMode] = useState(false);
  const [checked, setChecked] = useState(() => new Set());

  // 对比
  const [cmpA, setCmpA] = useState(null);
  const [cmpB, setCmpB] = useState(null);

  const fileRef = useRef(null);

  useEffect(() => { localStorage.setItem(LS_KEY, JSON.stringify(db)); }, [db]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(''), 2800);
    return () => clearTimeout(t);
  }, [notice]);

  const notify = msg => setNotice(msg);

  // 所有会修改数据的操作都经过 commit，从而支持撤销
  const commit = (next, label) => {
    setUndoStack(s => [...s.slice(-49), {label, state: db}]);
    setDb(next);
    notify(label);
  };
  // 文本类连续编辑（如笔记逐字输入）用相同 key 合并为一条撤销记录：
  // 栈顶 key 相同则只更新数据、保留最初快照，撤销时一次回到本次编辑前
  const commitCoalesced = (next, label, key) => {
    const top = undoStack[undoStack.length - 1];
    if (top && top.key === key) {
      setDb(next);
    } else {
      setUndoStack(s => [...s.slice(-49), {label, state: db, key}]);
      setDb(next);
    }
  };
  const undo = () => {
    const last = undoStack[undoStack.length - 1];
    if (!last) return;
    setDb(last.state);
    setUndoStack(undoStack.slice(0, -1));
    notify(`已撤销：${last.label}`);
  };

  // ---------- 派生数据 ----------
  const papersById = useMemo(() => new Map(db.papers.map(p => [p.id, p])), [db.papers]);
  const linksByProject = useMemo(() => {
    const m = new Map();
    for (const l of db.links) {
      if (!m.has(l.projectId)) m.set(l.projectId, []);
      m.get(l.projectId).push(l);
    }
    return m;
  }, [db.links]);
  const linksForProject = id => linksByProject.get(id) || [];
  const coverage = id => db.papers.length ? linksForProject(id).length / db.papers.length : 0;

  const allTags = useMemo(() => ['全部', ...new Set(db.papers.flatMap(x => x.tags || []))], [db.papers]);
  const filteredPapers = useMemo(() => db.papers.filter(x =>
    (tag === '全部' || (x.tags || []).includes(tag)) &&
    `${x.title}${x.authors}${x.abstract}`.toLowerCase().includes(query.toLowerCase())
  ), [db.papers, tag, query]);
  const curPaper = db.papers.find(x => x.id === selectedPaperId) || db.papers[0] || null;

  const activeProject = db.projects.find(p => p.id === activeProjectId) || null;
  const activeLinks = useMemo(() => {
    if (!activeProject) return [];
    return linksForProject(activeProject.id).filter(l => {
      const paper = papersById.get(l.paperId);
      if (!paper) return false;
      if (stanceFilter !== '全部' && l.stance !== stanceFilter) return false;
      if (linkTagFilter !== '全部' && !(paper.tags || []).includes(linkTagFilter)) return false;
      return true;
    });
  }, [activeProject, linksByProject, papersById, stanceFilter, linkTagFilter]);

  const projIds = db.projects.map(p => p.id);
  const aId = projIds.includes(cmpA) ? cmpA : projIds[0];
  const bId = projIds.includes(cmpB) ? cmpB : projIds.find(id => id !== aId);
  const compare = useMemo(() => {
    if (!aId || !bId || aId === bId) return null;
    const mapA = new Map(linksForProject(aId).map(l => [l.paperId, l]));
    const mapB = new Map(linksForProject(bId).map(l => [l.paperId, l]));
    const both = [...mapA.keys()].filter(id => mapB.has(id));
    return {
      both: both.map(id => ({paper: papersById.get(id), a: mapA.get(id), b: mapB.get(id)})).filter(x => x.paper),
      conflicts: both.filter(id => mapA.get(id).stance !== mapB.get(id).stance).map(id => ({paper: papersById.get(id), a: mapA.get(id), b: mapB.get(id)})).filter(x => x.paper),
      onlyA: [...mapA.keys()].filter(id => !mapB.has(id)).map(id => ({paper: papersById.get(id), link: mapA.get(id)})).filter(x => x.paper),
      onlyB: [...mapB.keys()].filter(id => !mapA.has(id)).map(id => ({paper: papersById.get(id), link: mapB.get(id)})).filter(x => x.paper),
    };
  }, [aId, bId, linksByProject, papersById]);

  // ---------- 文献库操作 ----------
  // 笔记等文本编辑走可合并的撤销：连续输入只产生一条撤销记录
  const updatePaper = (id, k, v) => commitCoalesced({...db, papers: db.papers.map(x => x.id === id ? {...x, [k]: v} : x)}, '编辑文献笔记', `paper:${id}:${k}`);
  const addPaper = () => {
    if (!paperForm.title.trim()) return;
    const p = {
      ...paperForm, id: uid(), year: +paperForm.year || new Date().getFullYear(),
      tags: paperForm.tags.split(',').map(x => x.trim()).filter(Boolean),
      status: '待读',
      cite: `${paperForm.authors} (${paperForm.year}). ${paperForm.title}. ${paperForm.venue}.`,
    };
    commit({...db, papers: [...db.papers, p]}, '文献已加入研究库');
    setSelectedPaperId(p.id);
    setPaperForm(emptyPaperForm);
    setShowPaperModal(false);
  };
  const toggleStatus = p => commit({...db, papers: db.papers.map(x => x.id === p.id ? {...x, status: x.status === '已读' ? '待读' : '已读'} : x)}, p.status === '已读' ? `已标记为待读：${p.title}` : `已标记为已读：${p.title}`);
  const copyCite = p => { navigator.clipboard?.writeText(p.cite); notify('引用文本已复制'); };

  // ---------- 项目操作 ----------
  const createProject = () => {
    if (!projectForm.name.trim()) return;
    const p = {id: uid(), name: projectForm.name.trim(), question: projectForm.question.trim(), created: new Date().toISOString()};
    commit({...db, projects: [...db.projects, p]}, `已创建项目「${p.name}」`);
    setActiveProjectId(p.id);
    setProjectForm({name: '', question: ''});
    setShowProjectModal(false);
  };
  const deleteProject = p => {
    if (!window.confirm(`删除项目「${p.name}」及其全部关联？（可撤销）`)) return;
    commit({...db, projects: db.projects.filter(x => x.id !== p.id), links: db.links.filter(l => l.projectId !== p.id)}, `已删除项目「${p.name}」`);
    if (activeProjectId === p.id) setActiveProjectId(null);
  };
  const openProject = id => { setActiveProjectId(id); setView('projects'); setBatchMode(false); setChecked(new Set()); setStanceFilter('全部'); setLinkTagFilter('全部'); };

  // ---------- 关联操作 ----------
  const linkedPaperIds = activeProject ? new Set(linksForProject(activeProject.id).map(l => l.paperId)) : new Set();
  const linkablePapers = db.papers.filter(p => !linkedPaperIds.has(p.id));
  const addLink = () => {
    if (!activeProject || !linkForm.paperId) return;
    if (linkedPaperIds.has(linkForm.paperId)) { notify('该文献已关联到本项目，禁止重复关联'); return; }
    const l = {id: uid(), projectId: activeProject.id, paperId: linkForm.paperId, stance: linkForm.stance, excerpt: linkForm.excerpt.trim(), note: linkForm.note.trim(), created: new Date().toISOString()};
    commit({...db, links: [...db.links, l]}, `已关联「${papersById.get(l.paperId)?.title}」为${l.stance}证据`);
    setLinkForm(emptyLinkForm);
    setLinkModal(false);
  };
  const removeLinks = ids => {
    const n = ids.length;
    if (!n) return;
    commit({...db, links: db.links.filter(l => !ids.includes(l.id))}, n > 1 ? `已批量移除 ${n} 条关联` : '已移除 1 条关联');
    setChecked(new Set());
  };
  const saveEditLink = () => {
    commit({...db, links: db.links.map(l => l.id === editLinkId ? {...l, stance: editForm.stance, excerpt: editForm.excerpt.trim(), note: editForm.note.trim()} : l)}, '已更新关联');
    setEditLinkId(null);
  };
  const changeStance = (l, stance) => commit({...db, links: db.links.map(x => x.id === l.id ? {...x, stance} : x)}, `已将「${papersById.get(l.paperId)?.title}」立场改为${stance}`);

  // ---------- 导入导出 ----------
  const exportJson = () => {
    const payload = {app: 'evidence-workbench', version: VERSION, exportedAt: new Date().toISOString(), papers: db.papers, projects: db.projects, links: db.links};
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], {type: 'application/json'}));
    a.download = `evidence-workbench-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    notify('已导出 JSON 数据');
  };
  const onImportFile = e => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      let data;
      try { data = JSON.parse(reader.result); } catch { notify('导入失败：文件不是有效的 JSON，本地数据未改动'); return; }
      const result = validateImport(data);
      if (!result.ok) { notify(`导入失败：${result.error}，本地数据未改动`); return; }
      commit(result.db, `已导入 ${result.db.papers.length} 篇文献、${result.db.projects.length} 个项目、${result.db.links.length} 条关联`);
      setActiveProjectId(null);
      setView('library');
    };
    reader.readAsText(file);
  };

  const toggleChecked = id => {
    const next = new Set(checked);
    next.has(id) ? next.delete(id) : next.add(id);
    setChecked(next);
  };

  const stanceBadge = s => <span className={`stance ${STANCE_CLASS[s]}`}>{s}</span>;
  const projName = id => db.projects.find(p => p.id === id)?.name || '未知项目';

  const headerTitle = view === 'library' ? '所有文献' : view === 'projects' ? '研究项目' : '对比分析';
  const headerCrumb = view === 'library' ? 'RESEARCH / LIBRARY' : view === 'projects' ? 'EVIDENCE / PROJECTS' : 'EVIDENCE / COMPARE';

  return <div className="app">
    <aside>
      <div className="logo"><span>∴</span> EVIDENCE DESK</div>
      <div className="library-head"><span>研究证据工作台</span><strong>{db.projects.length}<small> 个项目 · {db.links.length} 条证据</small></strong></div>
      <nav>
        <button className={view === 'library' ? 'active' : ''} onClick={() => setView('library')}>▤ <span>文献库</span><b>{db.papers.length}</b></button>
        <button className={view === 'projects' ? 'active' : ''} onClick={() => setView('projects')}>◈ <span>研究项目</span><b>{db.projects.length}</b></button>
        <button className={view === 'compare' ? 'active' : ''} onClick={() => setView('compare')}>⇄ <span>对比分析</span></button>
      </nav>
      <div className="side-tags">
        <small>项目速览</small>
        {db.projects.map(p => <button key={p.id} onClick={() => openProject(p.id)}>◈ {p.name}<b className="side-cov">{Math.round(coverage(p.id) * 100)}%</b></button>)}
        {!db.projects.length && <small className="side-empty">还没有项目</small>}
      </div>
      <div className="side-foot"><small>本地数据库 · localStorage 持久化</small></div>
    </aside>

    <main>
      <header>
        <div><span className="crumb">{headerCrumb}</span><h1>{headerTitle}</h1></div>
        <div className="actions">
          <button className="outline undo-btn" onClick={undo} disabled={!undoStack.length} title={undoStack.length ? `撤销：${undoStack[undoStack.length - 1].label}` : '没有可撤销的操作'}>↩ 撤销{undoStack.length ? ` (${undoStack.length})` : ''}</button>
          <button className="outline" onClick={() => fileRef.current?.click()}>⇪ 导入</button>
          <button className="outline" onClick={exportJson}>⇓ 导出</button>
          {view === 'library' && <button className="primary" onClick={() => setShowPaperModal(true)}>＋ 添加文献</button>}
          {view === 'projects' && <button className="primary" onClick={() => setShowProjectModal(true)}>＋ 新建项目</button>}
        </div>
      </header>
      <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={onImportFile}/>

      {view === 'library' && <>
        <div className="toolbar">
          <div className="search">⌕<input placeholder="搜索标题、作者或摘要…" value={query} onChange={e => setQuery(e.target.value)}/>{query && <button onClick={() => setQuery('')}>×</button>}</div>
          <div className="tag-filter">{allTags.map(t => <button className={tag === t ? 'on' : ''} onClick={() => setTag(t)} key={t}>{t}</button>)}</div>
        </div>
        <div className="body">
          <section className="paper-list">
            {filteredPapers.map(p => <button className={'paper ' + (curPaper?.id === p.id ? 'selected' : '')} onClick={() => setSelectedPaperId(p.id)} key={p.id}>
              <div className="paper-year">{p.year}</div>
              <div className="paper-copy"><h3>{p.title}</h3><p>{p.authors}</p><div>{(p.tags || []).map(t => <span key={t}>#{t}</span>)}</div></div>
              <small className={'status ' + p.status}>{p.status}</small>
            </button>)}
            {!filteredPapers.length && <div className="no-result">没有找到匹配的文献</div>}
          </section>
          <section className="detail">
            {curPaper && <>
              <div className="detail-top"><span className="status reading">{curPaper.status}</span><span className="ev-count">{db.links.filter(l => l.paperId === curPaper.id).length} 个项目引用</span></div>
              <h2>{curPaper.title}</h2>
              <p className="authors">{curPaper.authors}</p>
              <div className="cite-actions">
                <button onClick={() => copyCite(curPaper)}>▣ 复制引用</button>
                <button onClick={() => toggleStatus(curPaper)}>{curPaper.status === '已读' ? '标记为待读' : '标记为已读'}</button>
              </div>
              <div className="detail-section"><h4>摘要 <span>ABSTRACT</span></h4><p>{curPaper.abstract}</p></div>
              <div className="detail-section"><h4>出版信息 <span>PUBLICATION</span></h4><div className="pub-grid"><div><small>出版物</small><strong>{curPaper.venue}</strong></div><div><small>年份</small><strong>{curPaper.year}</strong></div></div></div>
              <div className="detail-section"><h4>所属项目 <span>EVIDENCE IN PROJECTS</span></h4>
                <div className="proj-chips">
                  {db.links.filter(l => l.paperId === curPaper.id).map(l => <button key={l.id} className="proj-chip" onClick={() => openProject(l.projectId)}>{projName(l.projectId)} {stanceBadge(l.stance)}</button>)}
                  {!db.links.some(l => l.paperId === curPaper.id) && <p className="muted">尚未关联到任何项目</p>}
                </div>
              </div>
              <div className="detail-section"><h4>我的笔记 <span>PRIVATE</span></h4><textarea className="notes" placeholder="记录你的阅读想法…" value={curPaper.notes || ''} onChange={e => updatePaper(curPaper.id, 'notes', e.target.value)}/></div>
            </>}
          </section>
        </div>
      </>}

      {view === 'projects' && <div className="proj-view">
        <section className="proj-list">
          {db.projects.map(p => {
            const ls = linksForProject(p.id);
            const cov = Math.round(coverage(p.id) * 100);
            return <button key={p.id} className={'proj-card ' + (activeProject?.id === p.id ? 'selected' : '')} onClick={() => openProject(p.id)}>
              <h3>{p.name}</h3>
              <div className="cov-bar"><i style={{width: cov + '%'}}/></div>
              <p><b>{cov}%</b> 覆盖率 · {ls.length}/{db.papers.length} 篇</p>
              <div className="mini-stances">{STANCES.map(s => <span key={s} className={'dot ' + STANCE_CLASS[s]}>{ls.filter(l => l.stance === s).length}</span>)}</div>
            </button>;
          })}
          {!db.projects.length && <div className="no-result">还没有研究项目<br/><button className="primary" onClick={() => setShowProjectModal(true)}>＋ 新建项目</button></div>}
        </section>

        <section className="proj-detail">
          {activeProject ? <>
            <div className="proj-head">
              <div>
                <h2>{activeProject.name}</h2>
                {activeProject.question && <p className="question">研究问题：{activeProject.question}</p>}
              </div>
              <div className="proj-head-actions">
                <button className="primary" onClick={() => { setLinkForm({...emptyLinkForm, paperId: linkablePapers[0]?.id || ''}); setLinkModal(true); }} disabled={!linkablePapers.length} title={linkablePapers.length ? '' : '所有文献均已关联'}>＋ 关联文献</button>
                <button className="outline" onClick={() => { setBatchMode(!batchMode); setChecked(new Set()); }}>{batchMode ? '退出批量' : '批量移除'}</button>
                <button className="outline danger" onClick={() => deleteProject(activeProject)}>删除项目</button>
              </div>
            </div>
            <div className="cov-row">
              <span>证据覆盖率</span>
              <div className="cov-bar big"><i style={{width: Math.round(coverage(activeProject.id) * 100) + '%'}}/></div>
              <b>{Math.round(coverage(activeProject.id) * 100)}%</b>
              <span className="muted">{linksForProject(activeProject.id).length}/{db.papers.length} 篇文献</span>
              <span className="stance-stats">{STANCES.map(s => <span key={s}>{stanceBadge(s)}{linksForProject(activeProject.id).filter(l => l.stance === s).length}</span>)}</span>
            </div>
            <div className="link-filters">
              <div className="tag-filter">{['全部', ...STANCES].map(s => <button key={s} className={stanceFilter === s ? 'on' : ''} onClick={() => setStanceFilter(s)}>{s}</button>)}</div>
              <div className="tag-filter">{allTags.map(t => <button key={t} className={linkTagFilter === t ? 'on' : ''} onClick={() => setLinkTagFilter(t)}># {t}</button>)}</div>
            </div>
            {batchMode && <div className="batch-bar">
              <label><input type="checkbox" checked={activeLinks.length > 0 && activeLinks.every(l => checked.has(l.id))} onChange={e => setChecked(e.target.checked ? new Set(activeLinks.map(l => l.id)) : new Set())}/> 全选（{checked.size}/{activeLinks.length}）</label>
              <button className="primary danger-bg" disabled={!checked.size} onClick={() => { removeLinks([...checked]); setBatchMode(false); }}>移除所选（{checked.size}）</button>
            </div>}
            <div className="link-list">
              {activeLinks.map(l => {
                const p = papersById.get(l.paperId);
                return <div className="link-row" key={l.id}>
                  {batchMode && <input type="checkbox" checked={checked.has(l.id)} onChange={() => toggleChecked(l.id)}/>}
                  <div className="link-main">
                    <div className="link-title">
                      <select value={l.stance} onChange={e => changeStance(l, e.target.value)} className={'stance-select ' + STANCE_CLASS[l.stance]}>{STANCES.map(s => <option key={s} value={s}>{s}</option>)}</select>
                      <strong>{p.title}</strong>
                      <span className="muted">{p.authors} · {p.year}</span>
                    </div>
                    {l.excerpt && <blockquote>“{l.excerpt}”</blockquote>}
                    {l.note && <p className="link-note">✎ {l.note}</p>}
                    <div className="link-tags">{(p.tags || []).map(t => <span key={t}>#{t}</span>)}</div>
                  </div>
                  <div className="link-ops">
                    <button onClick={() => { setEditLinkId(l.id); setEditForm({stance: l.stance, excerpt: l.excerpt || '', note: l.note || ''}); }}>编辑</button>
                    <button onClick={() => removeLinks([l.id])}>移除</button>
                  </div>
                </div>;
              })}
              {!activeLinks.length && <div className="no-result">{linksForProject(activeProject.id).length ? '当前筛选条件下没有关联证据' : '尚未关联任何文献证据'}</div>}
            </div>
          </> : <div className="no-result big-hint">◈<br/>选择左侧项目查看证据，或新建一个研究项目</div>}
        </section>
      </div>}

      {view === 'compare' && <div className="compare-view">
        {db.projects.length < 2 ? <div className="no-result big-hint">⇄<br/>至少需要两个研究项目才能进行对比分析</div> : <>
          <div className="cmp-selectors">
            <label>项目 A<select value={aId || ''} onChange={e => setCmpA(e.target.value)}>{db.projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
            <span className="cmp-vs">⇄</span>
            <label>项目 B<select value={bId || ''} onChange={e => setCmpB(e.target.value)}>{db.projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          </div>
          {compare ? <>
            <div className="cmp-summary">
              <span>共现 <b>{compare.both.length}</b></span>
              <span className={compare.conflicts.length ? 'has-conflict' : ''}>立场冲突 <b>{compare.conflicts.length}</b></span>
              <span>仅 {projName(aId)} <b>{compare.onlyA.length}</b></span>
              <span>仅 {projName(bId)} <b>{compare.onlyB.length}</b></span>
            </div>
            {compare.conflicts.length > 0 && <div className="cmp-section">
              <h4>⚡ 立场冲突 <span>CONFLICTS</span></h4>
              {compare.conflicts.map(({paper, a, b}) => <div className="conflict-card" key={paper.id}>
                <strong>{paper.title}</strong>
                <div className="conflict-sides">
                  <div><small>{projName(aId)}</small>{stanceBadge(a.stance)}{a.excerpt && <blockquote>“{a.excerpt}”</blockquote>}</div>
                  <div><small>{projName(bId)}</small>{stanceBadge(b.stance)}{b.excerpt && <blockquote>“{b.excerpt}”</blockquote>}</div>
                </div>
              </div>)}
            </div>}
            <div className="cmp-section">
              <h4>共现文献 <span>CO-OCCURRING</span></h4>
              {compare.both.map(({paper, a, b}) => <div className={'cmp-row ' + (a.stance !== b.stance ? 'conflict' : '')} key={paper.id}>
                <strong>{paper.title}</strong>
                <span>{projName(aId)} {stanceBadge(a.stance)}</span>
                <span>{projName(bId)} {stanceBadge(b.stance)}</span>
              </div>)}
              {!compare.both.length && <p className="muted">两个项目没有共同关联的文献</p>}
            </div>
            <div className="cmp-cols">
              <div className="cmp-section"><h4>仅 {projName(aId)} <span>ONLY A</span></h4>
                {compare.onlyA.map(({paper, link}) => <div className="cmp-row" key={paper.id}><strong>{paper.title}</strong><span>{stanceBadge(link.stance)}</span></div>)}
                {!compare.onlyA.length && <p className="muted">无独有文献</p>}
              </div>
              <div className="cmp-section"><h4>仅 {projName(bId)} <span>ONLY B</span></h4>
                {compare.onlyB.map(({paper, link}) => <div className="cmp-row" key={paper.id}><strong>{paper.title}</strong><span>{stanceBadge(link.stance)}</span></div>)}
                {!compare.onlyB.length && <p className="muted">无独有文献</p>}
              </div>
            </div>
          </> : <div className="no-result big-hint">请选择两个不同的项目进行对比</div>}
        </>}
      </div>}
    </main>

    <nav className="mobile-tabs">
      <button className={view === 'library' ? 'active' : ''} onClick={() => setView('library')}>▤<span>文献库</span></button>
      <button className={view === 'projects' ? 'active' : ''} onClick={() => setView('projects')}>◈<span>项目</span></button>
      <button className={view === 'compare' ? 'active' : ''} onClick={() => setView('compare')}>⇄<span>对比</span></button>
    </nav>

    {showPaperModal && <div className="modal-bg"><div className="modal">
      <button className="close" onClick={() => setShowPaperModal(false)}>×</button>
      <span className="crumb">NEW REFERENCE</span><h2>添加一篇文献</h2>
      <label>标题<input value={paperForm.title} onChange={e => setPaperForm({...paperForm, title: e.target.value})} placeholder="论文或书籍标题"/></label>
      <label>作者<input value={paperForm.authors} onChange={e => setPaperForm({...paperForm, authors: e.target.value})}/></label>
      <div className="two"><label>年份<input type="number" value={paperForm.year} onChange={e => setPaperForm({...paperForm, year: e.target.value})}/></label><label>出版物<input value={paperForm.venue} onChange={e => setPaperForm({...paperForm, venue: e.target.value})}/></label></div>
      <label>关键词<input value={paperForm.tags} onChange={e => setPaperForm({...paperForm, tags: e.target.value})} placeholder="用逗号分隔"/></label>
      <label>摘要<textarea rows="3" value={paperForm.abstract} onChange={e => setPaperForm({...paperForm, abstract: e.target.value})}/></label>
      <button className="primary full" onClick={addPaper}>保存文献</button>
    </div></div>}

    {showProjectModal && <div className="modal-bg"><div className="modal">
      <button className="close" onClick={() => setShowProjectModal(false)}>×</button>
      <span className="crumb">NEW PROJECT</span><h2>新建研究项目</h2>
      <label>项目名称<input value={projectForm.name} onChange={e => setProjectForm({...projectForm, name: e.target.value})} placeholder="例如：具身认知综述"/></label>
      <label>研究问题<textarea rows="3" value={projectForm.question} onChange={e => setProjectForm({...projectForm, question: e.target.value})} placeholder="这个项目想回答什么问题？"/></label>
      <button className="primary full" onClick={createProject}>创建项目</button>
    </div></div>}

    {linkModal && activeProject && <div className="modal-bg"><div className="modal">
      <button className="close" onClick={() => setLinkModal(false)}>×</button>
      <span className="crumb">LINK EVIDENCE</span><h2>关联文献到「{activeProject.name}」</h2>
      <label>选择文献（已关联的不会重复出现）
        <select value={linkForm.paperId} onChange={e => setLinkForm({...linkForm, paperId: e.target.value})}>
          {linkablePapers.map(p => <option key={p.id} value={p.id}>{p.title}（{p.year}）</option>)}
        </select>
      </label>
      <div className="stance-picker"><span>立场</span>{STANCES.map(s => <button key={s} className={linkForm.stance === s ? 'on ' + STANCE_CLASS[s] : ''} onClick={() => setLinkForm({...linkForm, stance: s})}>{s}</button>)}</div>
      <label>摘录<textarea rows="3" value={linkForm.excerpt} onChange={e => setLinkForm({...linkForm, excerpt: e.target.value})} placeholder="引用原文关键句…"/></label>
      <label>笔记<textarea rows="2" value={linkForm.note} onChange={e => setLinkForm({...linkForm, note: e.target.value})} placeholder="这条证据如何支撑研究问题？"/></label>
      <button className="primary full" onClick={addLink} disabled={!linkForm.paperId}>保存关联</button>
    </div></div>}

    {editLinkId && <div className="modal-bg"><div className="modal">
      <button className="close" onClick={() => setEditLinkId(null)}>×</button>
      <span className="crumb">EDIT EVIDENCE</span><h2>编辑关联证据</h2>
      <div className="stance-picker"><span>立场</span>{STANCES.map(s => <button key={s} className={editForm.stance === s ? 'on ' + STANCE_CLASS[s] : ''} onClick={() => setEditForm({...editForm, stance: s})}>{s}</button>)}</div>
      <label>摘录<textarea rows="3" value={editForm.excerpt} onChange={e => setEditForm({...editForm, excerpt: e.target.value})}/></label>
      <label>笔记<textarea rows="2" value={editForm.note} onChange={e => setEditForm({...editForm, note: e.target.value})}/></label>
      <button className="primary full" onClick={saveEditLink}>保存修改</button>
    </div></div>}

    {notice && <div className="toast">{notice}</div>}
  </div>;
}

createRoot(document.getElementById('root')).render(<App/>);
