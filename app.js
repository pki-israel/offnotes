(function(){
'use strict';

/* ============================= util ============================= */
const $ = (s, el) => (el || document).querySelector(s);
const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
const esc = s => String(s ?? '')
  .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
  .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
const uid = () => (crypto.randomUUID ? crypto.randomUUID()
  : 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2));
const fmtDate = ts => {
  const d = new Date(ts);
  return d.toLocaleDateString('pt-BR', {day:'2-digit', month:'2-digit', year:'2-digit'})
    + ' ' + d.toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit'});
};
const fmtTime = ts => new Date(ts).toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit', second:'2-digit'});

let toastTimer = null;
function toast(msg){
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

function download(name, mime, content){
  const blob = new Blob([content], {type: mime});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 400);
}

/* confirm dialog (promise) */
let confirmResolve = null;
function askConfirm(title, msg){
  return new Promise(res => {
    confirmResolve = res;
    $('#confirmTitle').textContent = title;
    $('#confirmMsg').textContent = msg;
    $('#dlgConfirm').showModal();
  });
}
$('#btnConfirmOk').addEventListener('click', () => {
  $('#dlgConfirm').close();
  if (confirmResolve){ confirmResolve(true); confirmResolve = null; }
});
$('#dlgConfirm').addEventListener('close', () => {
  if (confirmResolve){ confirmResolve(false); confirmResolve = null; }
});

/* base64url helpers (bytes <-> string) */
function b64uFromBytes(bytes){
  let bin = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH)
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return btoa(bin).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function bytesFromB64u(s){
  s = s.replace(/-/g,'+').replace(/_/g,'/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const encodeText = s => new TextEncoder().encode(s);
const decodeText = b => new TextDecoder().decode(b);

/* ============================= storage ============================= */
const KEY = 'grafite.v1';
let db = null;

function loadDB(){
  try { db = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch(e){ db = null; }
  if (!db || typeof db !== 'object') db = {};
  db.notes = Array.isArray(db.notes) ? db.notes : [];
  db.trash = Array.isArray(db.trash) ? db.trash : [];
  db.collections = Array.isArray(db.collections) ? db.collections : [];
  db.settings = Object.assign({sort:'recent', theme:null, lastOpen:null}, db.settings || {});
}
function persist(){
  try {
    localStorage.setItem(KEY, JSON.stringify(db));
    return true;
  } catch(e){
    toast('Não foi possível salvar: armazenamento do navegador cheio.');
    return false;
  }
}

const TYPE_LABEL = {texto:'Texto', rico:'Formatado', markdown:'Markdown', tarefas:'Tarefas'};

function newNote(type){
  const now = Date.now();
  return {
    id: uid(), type: type,
    title: '', content: type === 'tarefas' ? '[]' : '',
    collection: '', created: now, updated: now, versions: []
  };
}
const getNote = id => db.notes.find(n => n.id === id) || null;

/* plain text of a note (for search, snippet, counts, txt export) */
function plainText(note){
  if (note.type === 'rico'){
    const d = document.createElement('div');
    d.innerHTML = note.content;
    return d.innerText || '';
  }
  if (note.type === 'tarefas'){
    return taskItems(note).map(t => (t.d ? '[x] ' : '[ ] ') + t.t).join('\n');
  }
  return note.content || '';
}
function taskItems(note){
  try {
    const v = JSON.parse(note.content || '[]');
    return Array.isArray(v) ? v : [];
  } catch(e){ return []; }
}

/* ============================= sanitizer ============================= */
const ALLOWED_TAGS = new Set(['P','DIV','BR','B','STRONG','I','EM','U','S','STRIKE','DEL',
  'H1','H2','H3','H4','UL','OL','LI','A','BLOCKQUOTE','PRE','CODE','SPAN','SUB','SUP','HR','FONT']);
function sanitizeHTML(html){
  const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
  (function walk(node){
    Array.from(node.children).forEach(el => {
      walk(el);
      if (!ALLOWED_TAGS.has(el.tagName)){
        el.replaceWith(...Array.from(el.childNodes));
        return;
      }
      Array.from(el.attributes).forEach(attr => {
        const name = attr.name.toLowerCase();
        if (el.tagName === 'A' && name === 'href'){
          const v = attr.value.trim();
          if (/^(https?:|mailto:)/i.test(v)){
            el.setAttribute('target','_blank');
            el.setAttribute('rel','noopener noreferrer');
            return;
          }
        }
        el.removeAttribute(attr.name);
      });
    });
  })(doc.body);
  return doc.body.innerHTML;
}

/* ============================= markdown ============================= */
function mdInline(s){
  s = esc(s);
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  return s;
}
function mdRender(src){
  const lines = String(src || '').split(/\r?\n/);
  let html = '', i = 0;
  let list = null;   // 'ul' | 'ol' | null
  let para = [];
  const flushPara = () => {
    if (para.length){ html += '<p>' + para.map(mdInline).join('<br>') + '</p>'; para = []; }
  };
  const closeList = () => { if (list){ html += '</' + list + '>'; list = null; } };
  while (i < lines.length){
    const line = lines[i];
    if (/^```/.test(line)){
      flushPara(); closeList();
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])){ buf.push(lines[i]); i++; }
      i++;
      html += '<pre><code>' + esc(buf.join('\n')) + '</code></pre>';
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h){
      flushPara(); closeList();
      const lv = h[1].length;
      html += '<h' + lv + '>' + mdInline(h[2]) + '</h' + lv + '>';
      i++; continue;
    }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)){
      flushPara(); closeList(); html += '<hr>'; i++; continue;
    }
    const bq = line.match(/^>\s?(.*)$/);
    if (bq){
      flushPara(); closeList();
      const buf = [bq[1]];
      i++;
      while (i < lines.length && /^>\s?/.test(lines[i])){ buf.push(lines[i].replace(/^>\s?/,'')); i++; }
      html += '<blockquote><p>' + buf.map(mdInline).join('<br>') + '</p></blockquote>';
      continue;
    }
    const ul = line.match(/^\s*[-*+]\s+(.*)$/);
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ul || ol){
      flushPara();
      const want = ul ? 'ul' : 'ol';
      if (list !== want){ closeList(); html += '<' + want + '>'; list = want; }
      let item = (ul || ol)[1];
      const chk = item.match(/^\[( |x|X)\]\s+(.*)$/);
      if (chk){
        item = '<input type="checkbox" disabled' + (chk[1].toLowerCase() === 'x' ? ' checked' : '') + '> '
          + mdInline(chk[2]);
      } else item = mdInline(item);
      html += '<li>' + item + '</li>';
      i++; continue;
    }
    if (/^\s*$/.test(line)){ flushPara(); closeList(); i++; continue; }
    para.push(line);
    i++;
  }
  flushPara(); closeList();
  return html;
}

/* rendered HTML of a note (preview, share viewer, print, html export) */
function renderedHTML(note){
  if (note.type === 'rico') return sanitizeHTML(note.content);
  if (note.type === 'markdown') return mdRender(note.content);
  if (note.type === 'tarefas'){
    const items = taskItems(note);
    if (!items.length) return '<p><em>Lista vazia.</em></p>';
    return '<ul style="list-style:none; padding-left:4px">' + items.map(t =>
      '<li style="margin:.3em 0"><input type="checkbox" disabled' + (t.d ? ' checked' : '') + '> '
      + (t.d ? '<s>' + esc(t.t) + '</s>' : esc(t.t)) + '</li>').join('') + '</ul>';
  }
  return '<p>' + esc(note.content).replace(/\n/g,'<br>') + '</p>';
}

/* ============================= state ============================= */
let cur = null;          // current note id
let dirty = false;
let saveTimer = null;
let mdPreviewOn = false;
let savedRange = null;   // rich text link selection
let taskDraft = [];      // working copy of the open task list

/* ============================= sidebar / list ============================= */
function visibleNotes(){
  const q = $('#search').value.trim().toLowerCase();
  const col = $('#filterCol').value;
  let list = db.notes.slice();
  if (col) list = list.filter(n => n.collection === col);
  if (q) list = list.filter(n =>
    (n.title || '').toLowerCase().includes(q) || plainText(n).toLowerCase().includes(q));
  if (db.settings.sort === 'alpha')
    list.sort((a,b) => (a.title || 'Sem título').localeCompare(b.title || 'Sem título', 'pt-BR'));
  else
    list.sort((a,b) => b.updated - a.updated);
  return list;
}

function renderList(){
  const host = $('#noteList');
  const notes = visibleNotes();
  if (!notes.length){
    const hasAny = db.notes.length > 0;
    host.innerHTML = '<div class="empty-list">' +
      (hasAny ? 'Nenhuma nota corresponde à busca ou ao filtro.' :
        'Nenhuma nota ainda.<br>Crie a primeira em “Nova nota”.') + '</div>';
    return;
  }
  host.innerHTML = '';
  notes.forEach(n => {
    const div = document.createElement('div');
    div.className = 'note-item' + (n.id === cur ? ' current' : '');
    div.setAttribute('role','button');
    div.tabIndex = 0;
    const snippet = plainText(n).replace(/\s+/g,' ').trim().slice(0, 90);
    div.innerHTML =
      '<span class="t">' + esc(n.title || 'Sem título') + '</span>' +
      '<span class="s">' + (esc(snippet) || '<i>vazia</i>') + '</span>' +
      '<span class="m">' + fmtDate(n.updated) +
        ' <span class="tag">' + TYPE_LABEL[n.type] + '</span>' +
        (n.collection ? ' <span class="tag">' + esc(n.collection) + '</span>' : '') +
      '</span>' +
      '<span class="row-actions">' +
        '<button data-act="dup" title="Duplicar nota">⧉</button>' +
        '<button data-act="del" title="Mover para a lixeira">✕</button>' +
      '</span>';
    div.addEventListener('click', e => {
      const act = e.target.closest('[data-act]');
      if (act){
        e.stopPropagation();
        if (act.dataset.act === 'dup') duplicateNote(n.id);
        else trashNote(n.id);
        return;
      }
      openNote(n.id);
      document.body.classList.remove('side-open');
    });
    div.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' '){ e.preventDefault(); openNote(n.id); }
    });
    host.appendChild(div);
  });
}

function renderColSelects(){
  const opts = ['<option value="">Todas as coleções</option>']
    .concat(db.collections.map(c => '<option value="' + esc(c) + '">' + esc(c) + '</option>')).join('');
  const f = $('#filterCol');
  const prev = f.value;
  f.innerHTML = opts;
  if (db.collections.includes(prev)) f.value = prev;
}

/* ============================= editor ============================= */
function setSaveState(text, saved){
  const el = $('#saveState');
  if (el){ el.textContent = text; el.classList.toggle('saved', !!saved); }
}

function openNote(id){
  flushSave();
  cur = id;
  db.settings.lastOpen = id;
  persist();
  mdPreviewOn = false;
  renderEditor();
  renderList();
}

function renderEditor(){
  const sheet = $('#sheet');
  const note = cur ? getNote(cur) : null;
  if (!note){
    sheet.innerHTML =
      '<div class="empty-editor">' +
        '<h2>Nenhuma nota aberta</h2>' +
        '<p>Selecione uma nota na lista ao lado ou crie uma nova. Tudo é salvo automaticamente neste navegador.</p>' +
        '<div class="quick-types">' +
          '<button class="btn" data-newtype="texto">Texto simples</button>' +
          '<button class="btn" data-newtype="rico">Texto formatado</button>' +
          '<button class="btn" data-newtype="markdown">Markdown</button>' +
          '<button class="btn" data-newtype="tarefas">Lista de tarefas</button>' +
        '</div>' +
      '</div>';
    $$('#sheet [data-newtype]').forEach(b =>
      b.addEventListener('click', () => createNote(b.dataset.newtype)));
    renderStatusbar();
    return;
  }

  const colOpts = ['<option value="">Sem coleção</option>']
    .concat(db.collections.map(c =>
      '<option value="' + esc(c) + '"' + (note.collection === c ? ' selected' : '') + '>' + esc(c) + '</option>'
    )).join('');

  sheet.innerHTML =
    '<div class="sheet-head">' +
      '<input class="title-in" id="titleIn" placeholder="Título da nota" value="' + esc(note.title) + '">' +
      '<div class="meta-row">' +
        '<span class="tag">' + TYPE_LABEL[note.type] + '</span>' +
        '<select id="colSel" aria-label="Coleção da nota">' + colOpts + '</select>' +
        '<span>criada em ' + fmtDate(note.created) + '</span>' +
        '<span class="spacer"></span>' +
        '<span class="save-state saved" id="saveState">Salva</span>' +
      '</div>' +
    '</div>' +
    buildToolbarHTML(note) +
    '<div class="content-host" id="contentHost"></div>';

  $('#titleIn').addEventListener('input', markDirty);
  $('#colSel').addEventListener('change', () => {
    note.collection = $('#colSel').value;
    note.updated = Date.now();
    persist(); renderList();
    toast(note.collection ? 'Nota movida para “' + note.collection + '”.' : 'Nota removida da coleção.');
  });

  buildContent(note);
  wireToolbar(note);
  renderStatusbar();
}

function buildToolbarHTML(note){
  if (note.type === 'rico'){
    return '<div class="toolbar" id="toolbar">' +
      '<button class="tb" data-cmd="bold" title="Negrito (Ctrl+B)"><b>N</b></button>' +
      '<button class="tb" data-cmd="italic" title="Itálico (Ctrl+I)"><i>I</i></button>' +
      '<button class="tb" data-cmd="underline" title="Sublinhado (Ctrl+U)"><u>S</u></button>' +
      '<button class="tb" data-cmd="strikeThrough" title="Tachado"><s>T</s></button>' +
      '<span class="sep"></span>' +
      '<button class="tb" data-block="h2" title="Título">T1</button>' +
      '<button class="tb" data-block="h3" title="Subtítulo">T2</button>' +
      '<button class="tb" data-block="p" title="Parágrafo normal">P</button>' +
      '<button class="tb" data-block="blockquote" title="Citação">”</button>' +
      '<span class="sep"></span>' +
      '<button class="tb" data-cmd="insertUnorderedList" title="Lista com marcadores">• Lista</button>' +
      '<button class="tb" data-cmd="insertOrderedList" title="Lista numerada">1. Lista</button>' +
      '<span class="sep"></span>' +
      '<button class="tb" id="tbLink" title="Inserir link">Link</button>' +
      '<button class="tb" data-cmd="removeFormat" title="Limpar formatação">Limpar</button>' +
      '<div class="link-bar" id="linkBar">' +
        '<input type="text" id="linkUrl" placeholder="https://exemplo.com" aria-label="Endereço do link">' +
        '<button class="btn btn-sm" id="linkApply">Aplicar</button>' +
        '<button class="btn btn-sm btn-ghost" id="linkCancel">Cancelar</button>' +
      '</div>' +
    '</div>';
  }
  if (note.type === 'markdown'){
    return '<div class="toolbar" id="toolbar">' +
      '<button class="tb' + (mdPreviewOn ? '' : ' on') + '" id="mdEdit">Editar</button>' +
      '<button class="tb' + (mdPreviewOn ? ' on' : '') + '" id="mdView">Visualizar</button>' +
      '<span class="sep"></span>' +
      '<span style="font-size:11.5px; color:var(--faint)">Suporta títulos (#), listas, **negrito**, *itálico*, `código`, blocos ``` e [links](url)</span>' +
    '</div>';
  }
  return '';
}

function buildContent(note){
  const host = $('#contentHost');
  if (note.type === 'texto'){
    host.innerHTML = '<textarea class="ta-main" id="taMain" placeholder="Escreva sua nota aqui."></textarea>';
    const ta = $('#taMain');
    ta.value = note.content;
    ta.addEventListener('input', markDirty);
    return;
  }
  if (note.type === 'markdown'){
    if (mdPreviewOn){
      host.innerHTML = '<div class="rendered">' + (mdRender(note.content) || '<p><em>Nota vazia.</em></p>') + '</div>';
    } else {
      host.innerHTML = '<textarea class="ta-main mono" id="taMain" placeholder="# Escreva em Markdown"></textarea>';
      const ta = $('#taMain');
      ta.value = note.content;
      ta.addEventListener('input', markDirty);
    }
    return;
  }
  if (note.type === 'rico'){
    host.innerHTML = '<div class="rte" id="rte" contenteditable="true"></div>';
    const rte = $('#rte');
    rte.innerHTML = sanitizeHTML(note.content);
    rte.addEventListener('input', markDirty);
    return;
  }
  if (note.type === 'tarefas'){
    host.innerHTML = '<div class="tasks" id="tasksHost"></div>';
    taskDraft = taskItems(note);
    renderTasks(note);
  }
}

/* ----- tasks ----- */
function renderTasks(note){
  const host = $('#tasksHost');
  if (!host) return;
  const draftEl = $('#taskNew', host);
  const draft = draftEl ? draftEl.value : '';
  const items = taskDraft;
  const done = items.filter(t => t.d).length;
  let html = '<div class="task-progress">' +
    (items.length ? done + ' de ' + items.length + ' concluídas' : 'Nenhuma tarefa ainda') + '</div>';
  html += items.map((t, idx) =>
    '<div class="task-row' + (t.d ? ' done' : '') + '" data-i="' + idx + '">' +
      '<input type="checkbox"' + (t.d ? ' checked' : '') + ' aria-label="Concluir tarefa">' +
      '<input type="text" class="task-text" value="' + esc(t.t) + '">' +
      '<span class="t-act">' +
        '<button data-move="-1" title="Mover para cima">↑</button>' +
        '<button data-move="1" title="Mover para baixo">↓</button>' +
        '<button data-tdel title="Excluir tarefa">✕</button>' +
      '</span>' +
    '</div>').join('');
  html += '<div class="task-add">' +
    '<input type="text" id="taskNew" placeholder="Nova tarefa">' +
    '<button class="btn" id="taskAdd">Adicionar</button>' +
    '</div>';
  host.innerHTML = html;
  if (draft) $('#taskNew', host).value = draft;

  const commit = () => markDirty();
  $$('.task-row', host).forEach(row => {
    const i = Number(row.dataset.i);
    $('input[type=checkbox]', row).addEventListener('change', e => {
      items[i].d = e.target.checked; commit(); renderTasks(note);
    });
    $('.task-text', row).addEventListener('input', e => {
      items[i].t = e.target.value; commit();
    });
    $$('[data-move]', row).forEach(b => b.addEventListener('click', () => {
      const j = i + Number(b.dataset.move);
      if (j < 0 || j >= items.length) return;
      [items[i], items[j]] = [items[j], items[i]];
      commit(); renderTasks(note);
    }));
    $('[data-tdel]', row).addEventListener('click', () => {
      items.splice(i, 1); commit(); renderTasks(note);
    });
  });
  const inNew = $('#taskNew', host);
  const addTask = () => {
    if (!inNew.value.trim()) return;
    items.push({t: inNew.value.trim(), d: false});
    inNew.value = '';
    commit(); renderTasks(note);
    $('#taskNew').focus();
  };
  inNew.addEventListener('keydown', e => { if (e.key === 'Enter') addTask(); });
  $('#taskAdd', host).addEventListener('click', addTask);
}

/* ----- rich text toolbar ----- */
function wireToolbar(note){
  const tb = $('#toolbar');
  if (!tb) return;
  if (note.type === 'markdown'){
    $('#mdEdit').addEventListener('click', () => { flushSave(); mdPreviewOn = false; renderEditor(); });
    $('#mdView').addEventListener('click', () => { flushSave(); mdPreviewOn = true; renderEditor(); });
    return;
  }
  /* rico */
  $$('[data-cmd]', tb).forEach(b => b.addEventListener('mousedown', e => {
    e.preventDefault();
    document.execCommand(b.dataset.cmd, false, null);
    markDirty();
  }));
  $$('[data-block]', tb).forEach(b => b.addEventListener('mousedown', e => {
    e.preventDefault();
    document.execCommand('formatBlock', false, '<' + b.dataset.block + '>');
    markDirty();
  }));
  const linkBar = $('#linkBar');
  $('#tbLink').addEventListener('mousedown', e => {
    e.preventDefault();
    const sel = window.getSelection();
    savedRange = (sel && sel.rangeCount) ? sel.getRangeAt(0).cloneRange() : null;
    linkBar.classList.add('open');
    $('#linkUrl').focus();
  });
  const closeLinkBar = () => { linkBar.classList.remove('open'); $('#linkUrl').value = ''; };
  $('#linkApply').addEventListener('click', () => {
    let url = $('#linkUrl').value.trim();
    if (!url) return closeLinkBar();
    if (!/^(https?:\/\/|mailto:)/i.test(url)) url = 'https://' + url;
    const sel = window.getSelection();
    if (savedRange){ sel.removeAllRanges(); sel.addRange(savedRange); }
    if (sel.isCollapsed){
      document.execCommand('insertHTML', false,
        '<a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + esc(url) + '</a>');
    } else {
      document.execCommand('createLink', false, url);
    }
    markDirty();
    closeLinkBar();
  });
  $('#linkUrl').addEventListener('keydown', e => { if (e.key === 'Enter') $('#linkApply').click(); });
  $('#linkCancel').addEventListener('click', closeLinkBar);
}

/* ----- statusbar ----- */
function renderStatusbar(){
  const bar = $('#statusbar');
  if (!cur){
    bar.innerHTML = '<span>Grafite guarda tudo localmente no seu navegador. Use “Backup” para exportar suas notas.</span>';
    return;
  }
  bar.innerHTML =
    '<span class="counts" id="counts"></span>' +
    '<span class="spacer"></span>' +
    '<button class="btn-ghost btn" id="sbShare">Compartilhar</button>' +
    '<button class="btn-ghost btn" id="sbHistory">Histórico</button>' +
    '<div class="menu-wrap">' +
      '<button class="btn-ghost btn caret" id="sbExport">Exportar</button>' +
      '<div class="menu" id="menuExport" style="bottom:calc(100% + 6px); top:auto">' +
        '<button data-exp="txt">Texto (.txt)</button>' +
        '<button data-exp="md">Markdown (.md)</button>' +
        '<button data-exp="html">Página HTML (.html)</button>' +
        '<button data-exp="doc">Word (.doc)</button>' +
        '<hr>' +
        '<button data-exp="print">Imprimir / salvar em PDF</button>' +
      '</div>' +
    '</div>' +
    '<button class="btn-ghost btn" id="sbPrint">Imprimir</button>' +
    '<button class="btn-ghost btn" id="sbZen">Modo foco</button>';
  updateCounts();
  $('#sbShare').addEventListener('click', openShare);
  $('#sbHistory').addEventListener('click', openHistory);
  $('#sbPrint').addEventListener('click', doPrint);
  $('#sbZen').addEventListener('click', toggleZen);
  $('#sbExport').addEventListener('click', e => {
    e.stopPropagation();
    toggleMenu($('#menuExport'));
  });
  $$('#menuExport [data-exp]').forEach(b =>
    b.addEventListener('click', () => { closeMenus(); doExport(b.dataset.exp); }));
}

function updateCounts(){
  const el = $('#counts');
  if (!el || !cur) return;
  const note = getNote(cur);
  if (!note) return;
  const txt = plainText(note);
  const words = txt.trim() ? txt.trim().split(/\s+/).length : 0;
  el.textContent = words + ' palavras · ' + txt.length + ' caracteres';
}

/* ============================= saving ============================= */
function markDirty(){
  dirty = true;
  setSaveState('Editando…', false);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 800);
}

function collectContent(note){
  if (note.type === 'texto' || note.type === 'markdown'){
    const ta = $('#taMain');
    return ta ? ta.value : note.content;
  }
  if (note.type === 'rico'){
    const rte = $('#rte');
    return rte ? rte.innerHTML : note.content;
  }
  if (note.type === 'tarefas'){
    return $('#tasksHost') ? JSON.stringify(taskDraft) : note.content;
  }
  return note.content;
}

const VERSION_GAP = 5 * 60 * 1000;
const VERSION_MAX = 20;

function saveNow(){
  clearTimeout(saveTimer);
  if (!cur) { dirty = false; return; }
  const note = getNote(cur);
  if (!note) { dirty = false; return; }
  const titleEl = $('#titleIn');
  const newTitle = titleEl ? titleEl.value : note.title;
  const newContent = collectContent(note);

  if (newContent !== note.content || newTitle !== note.title){
    /* snapshot da versão anterior, no máximo a cada 5 minutos */
    if (newContent !== note.content){
      const last = note.versions[note.versions.length - 1];
      if (!last || (Date.now() - last.ts) > VERSION_GAP){
        note.versions.push({ts: note.updated, title: note.title, content: note.content});
        while (note.versions.length > VERSION_MAX) note.versions.shift();
      }
    }
    note.title = newTitle;
    note.content = newContent;
    note.updated = Date.now();
    persist();
    renderList();
  }
  dirty = false;
  setSaveState('Salva às ' + fmtTime(Date.now()), true);
  updateCounts();
}
function flushSave(){ if (dirty) saveNow(); }

/* ============================= note actions ============================= */
function createNote(type){
  flushSave();
  const n = newNote(type);
  db.notes.unshift(n);
  persist();
  cur = n.id;
  db.settings.lastOpen = n.id;
  mdPreviewOn = false;
  renderEditor();
  renderList();
  const t = $('#titleIn');
  if (t) t.focus();
}

function duplicateNote(id){
  const src = getNote(id);
  if (!src) return;
  const copy = Object.assign({}, src, {
    id: uid(),
    title: (src.title || 'Sem título') + ' (cópia)',
    created: Date.now(), updated: Date.now(), versions: []
  });
  db.notes.unshift(copy);
  persist();
  renderList();
  toast('Nota duplicada.');
}

async function trashNote(id){
  const note = getNote(id);
  if (!note) return;
  const ok = await askConfirm('Mover para a lixeira',
    'A nota “' + (note.title || 'Sem título') + '” será movida para a lixeira. Você pode restaurá-la depois.');
  if (!ok) return;
  db.notes = db.notes.filter(n => n.id !== id);
  note.deletedAt = Date.now();
  db.trash.unshift(note);
  if (cur === id){ cur = null; db.settings.lastOpen = null; renderEditor(); }
  persist();
  renderList();
  updateTrashLabel();
  toast('Nota movida para a lixeira.');
}

/* ============================= menus ============================= */
function closeMenus(){ $$('.menu.open').forEach(m => m.classList.remove('open')); }
function toggleMenu(menu){
  const was = menu.classList.contains('open');
  closeMenus();
  if (!was) menu.classList.add('open');
}
document.addEventListener('click', e => {
  if (!e.target.closest('.menu-wrap')) closeMenus();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape'){
    closeMenus();
    if (document.body.classList.contains('zen')) toggleZen();
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's'){
    e.preventDefault();
    flushSave();
    toast('Nota salva.');
  }
});

/* ============================= share ============================= */
function shareObj(note){
  return {y: note.type, t: note.title, c: note.content};
}
async function encryptShare(obj, pass){
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const keyMat = await crypto.subtle.importKey('raw', encodeText(pass), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    {name:'PBKDF2', salt, iterations:150000, hash:'SHA-256'},
    keyMat, {name:'AES-GCM', length:256}, false, ['encrypt']);
  const data = await crypto.subtle.encrypt({name:'AES-GCM', iv}, key, encodeText(JSON.stringify(obj)));
  return b64uFromBytes(salt) + '.' + b64uFromBytes(iv) + '.' + b64uFromBytes(new Uint8Array(data));
}
async function decryptShare(payload, pass){
  const [s, i, d] = payload.split('.');
  const salt = bytesFromB64u(s), iv = bytesFromB64u(i), data = bytesFromB64u(d);
  const keyMat = await crypto.subtle.importKey('raw', encodeText(pass), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    {name:'PBKDF2', salt, iterations:150000, hash:'SHA-256'},
    keyMat, {name:'AES-GCM', length:256}, false, ['decrypt']);
  const plain = await crypto.subtle.decrypt({name:'AES-GCM', iv}, key, data);
  return JSON.parse(decodeText(new Uint8Array(plain)));
}

function openShare(){
  if (!cur) return;
  flushSave();
  $('#shareOut').style.display = 'none';
  $('#shareUrl').value = '';
  $('#shPass').value = '';
  $('#dlgShare').showModal();
}
$$('input[name=shmode]').forEach(r => r.addEventListener('change', () => {
  $('#shPwField').style.display = $('#shPw').checked ? '' : 'none';
}));
$('#btnGenLink').addEventListener('click', async () => {
  const note = getNote(cur);
  if (!note) return;
  const base = location.href.split('#')[0];
  let frag;
  try {
    if ($('#shPw').checked){
      const pass = $('#shPass').value;
      if (!pass){ toast('Informe uma senha para proteger a nota.'); return; }
      frag = '#s=' + await encryptShare(shareObj(note), pass);
    } else {
      frag = '#n=' + b64uFromBytes(encodeText(JSON.stringify(shareObj(note))));
    }
  } catch(e){
    toast('Não foi possível gerar o link.');
    return;
  }
  const url = base + frag;
  $('#shareUrl').value = url;
  $('#shareOut').style.display = 'flex';
  if (url.length > 20000)
    toast('Atenção: a nota é grande e o link ficou muito longo; pode não funcionar em todos os apps.');
});
$('#btnCopyLink').addEventListener('click', async () => {
  const v = $('#shareUrl').value;
  try {
    await navigator.clipboard.writeText(v);
    toast('Link copiado.');
  } catch(e){
    $('#shareUrl').select();
    document.execCommand('copy');
    toast('Link copiado.');
  }
});

/* ----- shared note viewer ----- */
let sharedNote = null;
function checkSharedHash(){
  const h = location.hash || '';
  if (h.startsWith('#n=')){
    try {
      const obj = JSON.parse(decodeText(bytesFromB64u(h.slice(3))));
      showViewer(obj);
    } catch(e){ toast('Link de nota inválido.'); }
  } else if (h.startsWith('#s=')){
    showViewerPassword(h.slice(3));
  }
}
function viewerBody(obj){
  const fake = {type: obj.y || 'texto', title: obj.t || '', content: obj.c || ''};
  return '<div class="viewer-sheet">' +
    '<h1 class="vtitle">' + (esc(fake.title) || 'Sem título') + '</h1>' +
    '<div class="rendered">' + renderedHTML(fake) + '</div>' +
  '</div>';
}
function showViewer(obj){
  sharedNote = obj;
  $('#viewerScroll').innerHTML = viewerBody(obj);
  $('#viewer').classList.add('open');
}
function showViewerPassword(payload){
  sharedNote = null;
  $('#viewerScroll').innerHTML =
    '<div class="pw-box">' +
      '<h3>Nota protegida por senha</h3>' +
      '<p>O conteúdo está criptografado com AES-256-GCM. Digite a senha para abrir.</p>' +
      '<div class="pw-err" id="pwErr">Senha incorreta ou link corrompido.</div>' +
      '<input type="password" id="pwIn" placeholder="Senha" autocomplete="off">' +
      '<button class="btn btn-primary" id="pwGo">Abrir nota</button>' +
    '</div>';
  $('#viewer').classList.add('open');
  const go = async () => {
    try {
      const obj = await decryptShare(payload, $('#pwIn').value);
      showViewer(obj);
    } catch(e){
      $('#pwErr').style.display = 'block';
    }
  };
  $('#pwGo').addEventListener('click', go);
  $('#pwIn').addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  $('#pwIn').focus();
}
$('#btnCloseViewer').addEventListener('click', () => {
  $('#viewer').classList.remove('open');
  history.replaceState(null, '', location.href.split('#')[0]);
});
$('#btnSaveCopy').addEventListener('click', () => {
  if (!sharedNote){ toast('Abra a nota com a senha antes de salvar uma cópia.'); return; }
  const n = newNote(sharedNote.y || 'texto');
  n.title = sharedNote.t || 'Nota compartilhada';
  n.content = sharedNote.c || '';
  db.notes.unshift(n);
  persist();
  renderList();
  toast('Cópia salva no seu bloco.');
});

/* ============================= history ============================= */
function openHistory(){
  if (!cur) return;
  flushSave();
  const note = getNote(cur);
  const body = $('#historyBody');
  if (!note.versions.length){
    body.innerHTML = '<p>Nenhuma versão anterior guardada ainda. Uma versão é registrada automaticamente quando a nota muda, no máximo a cada 5 minutos (últimas ' + VERSION_MAX + ').</p>';
  } else {
    body.innerHTML = note.versions.slice().reverse().map((v, ridx) => {
      const idx = note.versions.length - 1 - ridx;
      return '<div class="list-row" data-v="' + idx + '">' +
        '<div class="grow">' +
          '<div>' + esc(v.title || 'Sem título') + '</div>' +
          '<div class="sub">' + fmtDate(v.ts) + ' · ' + (v.content || '').length + ' caracteres</div>' +
        '</div>' +
        '<button class="btn btn-sm" data-vview="' + idx + '">Ver</button>' +
        '<button class="btn btn-sm" data-vrestore="' + idx + '">Restaurar</button>' +
      '</div><div class="ver-preview" data-vp="' + idx + '" style="display:none"></div>';
    }).join('');
    $$('#historyBody [data-vview]').forEach(b => b.addEventListener('click', () => {
      const i = b.dataset.vview;
      const pv = $('#historyBody [data-vp="' + i + '"]');
      const v = note.versions[Number(i)];
      const fake = {type: note.type, content: v.content};
      pv.textContent = plainText(fake).slice(0, 4000) || '(vazia)';
      pv.style.display = pv.style.display === 'none' ? 'block' : 'none';
    }));
    $$('#historyBody [data-vrestore]').forEach(b => b.addEventListener('click', async () => {
      const v = note.versions[Number(b.dataset.vrestore)];
      const ok = await askConfirm('Restaurar versão',
        'A nota voltará ao estado de ' + fmtDate(v.ts) + '. A versão atual será guardada no histórico.');
      if (!ok) return;
      note.versions.push({ts: note.updated, title: note.title, content: note.content});
      while (note.versions.length > VERSION_MAX) note.versions.shift();
      note.title = v.title;
      note.content = v.content;
      note.updated = Date.now();
      persist();
      $('#dlgHistory').close();
      renderEditor(); renderList();
      toast('Versão restaurada.');
    }));
  }
  $('#dlgHistory').showModal();
}

/* ============================= export / import / print ============================= */
function safeName(s){
  return (s || 'nota').replace(/[\\/:*?"<>|]/g, '-').slice(0, 60).trim() || 'nota';
}
function fullHTMLDoc(note){
  return '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">' +
    '<title>' + esc(note.title || 'Nota') + '</title>' +
    '<style>body{font:16px/1.65 -apple-system,"Segoe UI",sans-serif; max-width:760px; margin:40px auto; padding:0 20px; color:#24272a}' +
    'pre{background:#f0f1f2; border:1px solid #d5d8da; border-radius:8px; padding:12px; overflow-x:auto}' +
    'code{font-family:Consolas,monospace} blockquote{border-left:3px solid #b4bac0; margin-left:0; padding-left:14px; color:#646a70}</style>' +
    '</head><body><h1>' + (esc(note.title) || 'Sem título') + '</h1>' +
    renderedHTML(note) + '</body></html>';
}
function doExport(kind){
  if (!cur) return;
  flushSave();
  const note = getNote(cur);
  const name = safeName(note.title);
  if (kind === 'txt'){
    download(name + '.txt', 'text/plain;charset=utf-8', plainText(note));
  } else if (kind === 'md'){
    let md;
    if (note.type === 'markdown') md = note.content;
    else if (note.type === 'tarefas')
      md = taskItems(note).map(t => '- [' + (t.d ? 'x' : ' ') + '] ' + t.t).join('\n');
    else md = plainText(note);
    download(name + '.md', 'text/markdown;charset=utf-8', md);
  } else if (kind === 'html'){
    download(name + '.html', 'text/html;charset=utf-8', fullHTMLDoc(note));
  } else if (kind === 'doc'){
    download(name + '.doc', 'application/msword;charset=utf-8', fullHTMLDoc(note));
  } else if (kind === 'print'){
    doPrint();
  }
}
function doPrint(){
  if (!cur) return;
  flushSave();
  const note = getNote(cur);
  $('#printArea').innerHTML =
    '<h1 class="ptitle">' + (esc(note.title) || 'Sem título') + '</h1>' +
    '<div class="rendered">' + renderedHTML(note) + '</div>';
  window.print();
}

$('#btnImport').addEventListener('click', () => $('#fileImport').click());
$('#fileImport').addEventListener('change', () => {
  const f = $('#fileImport').files[0];
  if (!f) return;
  const reader = new FileReader();
  reader.onload = () => {
    const isMd = /\.(md|markdown)$/i.test(f.name);
    const n = newNote(isMd ? 'markdown' : 'texto');
    n.title = f.name.replace(/\.[^.]+$/, '');
    n.content = String(reader.result || '');
    db.notes.unshift(n);
    persist();
    openNote(n.id);
    toast('Arquivo importado como ' + (isMd ? 'Markdown' : 'texto') + '.');
  };
  reader.readAsText(f, 'utf-8');
  $('#fileImport').value = '';
});

/* ============================= collections ============================= */
function renderCollectionsDialog(){
  const host = $('#colList');
  if (!db.collections.length){
    host.innerHTML = '<p>Nenhuma coleção criada ainda.</p>';
  } else {
    host.innerHTML = db.collections.map((c, i) => {
      const count = db.notes.filter(n => n.collection === c).length;
      return '<div class="list-row" data-ci="' + i + '">' +
        '<input type="text" value="' + esc(c) + '" aria-label="Nome da coleção">' +
        '<span class="sub">' + count + ' nota' + (count === 1 ? '' : 's') + '</span>' +
        '<button class="btn btn-sm" data-crename>Renomear</button>' +
        '<button class="btn btn-sm btn-danger" data-cdel>Excluir</button>' +
      '</div>';
    }).join('');
    $$('#colList .list-row').forEach(row => {
      const i = Number(row.dataset.ci);
      $('[data-crename]', row).addEventListener('click', () => {
        const nv = $('input', row).value.trim();
        if (!nv) return toast('O nome não pode ficar vazio.');
        if (db.collections.includes(nv) && nv !== db.collections[i])
          return toast('Já existe uma coleção com esse nome.');
        const old = db.collections[i];
        db.collections[i] = nv;
        db.notes.forEach(n => { if (n.collection === old) n.collection = nv; });
        db.trash.forEach(n => { if (n.collection === old) n.collection = nv; });
        persist(); renderColSelects(); renderList(); renderCollectionsDialog();
        toast('Coleção renomeada.');
      });
      $('[data-cdel]', row).addEventListener('click', async () => {
        const c = db.collections[i];
        const ok = await askConfirm('Excluir coleção',
          'A coleção “' + c + '” será excluída. As notas dela não serão apagadas, apenas ficarão sem coleção.');
        if (!ok) return;
        db.collections.splice(i, 1);
        db.notes.forEach(n => { if (n.collection === c) n.collection = ''; });
        db.trash.forEach(n => { if (n.collection === c) n.collection = ''; });
        persist(); renderColSelects(); renderList(); renderCollectionsDialog();
        if (cur) renderEditor();
        toast('Coleção excluída.');
      });
    });
  }
}
$('#btnCollections').addEventListener('click', () => {
  renderCollectionsDialog();
  $('#dlgCollections').showModal();
});
$('#btnAddCol').addEventListener('click', () => {
  const v = $('#newColName').value.trim();
  if (!v) return;
  if (db.collections.includes(v)) return toast('Essa coleção já existe.');
  db.collections.push(v);
  db.collections.sort((a,b) => a.localeCompare(b, 'pt-BR'));
  $('#newColName').value = '';
  persist(); renderColSelects(); renderCollectionsDialog();
  if (cur) renderEditor();
  toast('Coleção criada.');
});
$('#newColName').addEventListener('keydown', e => { if (e.key === 'Enter') $('#btnAddCol').click(); });

/* ============================= trash ============================= */
function updateTrashLabel(){
  $('#btnTrash').textContent = db.trash.length ? 'Lixeira (' + db.trash.length + ')' : 'Lixeira';
}
function renderTrashDialog(){
  const host = $('#trashBody');
  if (!db.trash.length){
    host.innerHTML = '<p>A lixeira está vazia.</p>';
    return;
  }
  host.innerHTML = db.trash.map((n, i) =>
    '<div class="list-row">' +
      '<div class="grow">' +
        '<div>' + esc(n.title || 'Sem título') + '</div>' +
        '<div class="sub">excluída em ' + fmtDate(n.deletedAt || n.updated) + ' · ' + TYPE_LABEL[n.type] + '</div>' +
      '</div>' +
      '<button class="btn btn-sm" data-tr="' + i + '">Restaurar</button>' +
      '<button class="btn btn-sm btn-danger" data-tx="' + i + '">Excluir de vez</button>' +
    '</div>').join('');
  $$('#trashBody [data-tr]').forEach(b => b.addEventListener('click', () => {
    const n = db.trash.splice(Number(b.dataset.tr), 1)[0];
    delete n.deletedAt;
    db.notes.unshift(n);
    persist(); renderList(); renderTrashDialog(); updateTrashLabel();
    toast('Nota restaurada.');
  }));
  $$('#trashBody [data-tx]').forEach(b => b.addEventListener('click', async () => {
    const n = db.trash[Number(b.dataset.tx)];
    const ok = await askConfirm('Excluir definitivamente',
      'A nota “' + (n.title || 'Sem título') + '” será apagada para sempre. Esta ação não pode ser desfeita.');
    if (!ok) return;
    db.trash.splice(Number(b.dataset.tx), 1);
    persist(); renderTrashDialog(); updateTrashLabel();
    toast('Nota excluída definitivamente.');
  }));
}
$('#btnTrash').addEventListener('click', () => {
  renderTrashDialog();
  $('#dlgTrash').showModal();
});
$('#btnEmptyTrash').addEventListener('click', async () => {
  if (!db.trash.length) return;
  const ok = await askConfirm('Esvaziar lixeira',
    'Todas as ' + db.trash.length + ' notas da lixeira serão apagadas para sempre.');
  if (!ok) return;
  db.trash = [];
  persist(); renderTrashDialog(); updateTrashLabel();
  toast('Lixeira esvaziada.');
});

/* ============================= backup ============================= */
$('#btnBackup').addEventListener('click', () => $('#dlgBackup').showModal());
$('#btnExportBackup').addEventListener('click', () => {
  flushSave();
  const stamp = new Date().toISOString().slice(0,10);
  download('grafite-backup-' + stamp + '.json', 'application/json;charset=utf-8',
    JSON.stringify(db, null, 2));
  toast('Backup gerado.');
});
$('#btnRestoreBackup').addEventListener('click', () => $('#fileBackup').click());
$('#fileBackup').addEventListener('change', () => {
  const f = $('#fileBackup').files[0];
  if (!f) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const inc = JSON.parse(String(reader.result));
      if (!inc || !Array.isArray(inc.notes)) throw new Error('formato');
      let added = 0, updated = 0;
      inc.notes.forEach(n => {
        if (!n || !n.id) return;
        const mine = getNote(n.id);
        if (!mine){ db.notes.push(n); added++; }
        else if ((n.updated || 0) > (mine.updated || 0)){
          Object.assign(mine, n); updated++;
        }
      });
      (inc.collections || []).forEach(c => {
        if (c && !db.collections.includes(c)) db.collections.push(c);
      });
      (inc.trash || []).forEach(n => {
        if (n && n.id && !db.trash.some(t => t.id === n.id) && !getNote(n.id)) db.trash.push(n);
      });
      db.collections.sort((a,b) => a.localeCompare(b, 'pt-BR'));
      persist();
      renderColSelects(); renderList(); updateTrashLabel();
      if (cur && !getNote(cur)){ cur = null; renderEditor(); }
      toast('Backup restaurado: ' + added + ' adicionadas, ' + updated + ' atualizadas.');
    } catch(e){
      toast('Arquivo de backup inválido.');
    }
  };
  reader.readAsText(f, 'utf-8');
  $('#fileBackup').value = '';
});

/* ============================= chrome ============================= */
$('#btnNew').addEventListener('click', e => { e.stopPropagation(); toggleMenu($('#menuNew')); });
$$('#menuNew [data-newtype]').forEach(b =>
  b.addEventListener('click', () => { closeMenus(); createNote(b.dataset.newtype); }));

$('#search').addEventListener('input', renderList);
$('#filterCol').addEventListener('change', renderList);
$('#btnSort').addEventListener('click', () => {
  db.settings.sort = db.settings.sort === 'alpha' ? 'recent' : 'alpha';
  $('#btnSort').textContent = db.settings.sort === 'alpha' ? 'A–Z' : 'Recentes';
  persist(); renderList();
});

$('#btnSide').addEventListener('click', () => {
  if (window.matchMedia('(max-width: 900px)').matches)
    document.body.classList.toggle('side-open');
  else {
    const app = $('#app');
    const hidden = app.style.gridTemplateColumns === '0px 1fr';
    app.style.gridTemplateColumns = hidden ? '300px 1fr' : '0px 1fr';
    $('#sidebar').style.display = hidden ? '' : 'none';
  }
});
$('#sideBackdrop').addEventListener('click', () => document.body.classList.remove('side-open'));

function toggleZen(){
  document.body.classList.toggle('zen');
  toast(document.body.classList.contains('zen')
    ? 'Modo foco ativado. Pressione Esc para sair.' : 'Modo foco desativado.');
}

/* theme: null (sistema) -> light -> dark -> null */
function applyTheme(){
  const t = db.settings.theme;
  if (t) document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
}
$('#btnTheme').addEventListener('click', () => {
  const seq = [null, 'light', 'dark'];
  const i = seq.indexOf(db.settings.theme);
  db.settings.theme = seq[(i + 1) % seq.length];
  persist(); applyTheme();
  toast('Tema: ' + (db.settings.theme === 'light' ? 'claro'
    : db.settings.theme === 'dark' ? 'escuro' : 'automático (sistema)'));
});

/* dialogs: fechar nos botões [data-close] */
$$('dialog').forEach(d => {
  $$('[data-close]', d).forEach(b => b.addEventListener('click', () => d.close()));
});

/* save on exit / background */
window.addEventListener('beforeunload', flushSave);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushSave();
});
window.addEventListener('hashchange', checkSharedHash);

/* ============================= boot ============================= */
loadDB();
applyTheme();
$('#btnSort').textContent = db.settings.sort === 'alpha' ? 'A–Z' : 'Recentes';

if (!db.notes.length && !localStorage.getItem('grafite.welcomed')){
  const w = newNote('markdown');
  w.title = 'Bem-vindo ao Grafite';
  w.content = [
    '# Bem-vindo ao Grafite',
    '',
    'Este é o seu bloco de notas pessoal. Tudo fica salvo **automaticamente** neste navegador enquanto você digita.',
    '',
    '## O que você pode fazer',
    '',
    '- Criar notas de **texto simples**, **texto formatado**, **Markdown** e **listas de tarefas**',
    '- Organizar em **coleções** e encontrar tudo pela **busca**',
    '- Ver o **histórico de versões** de cada nota e restaurar estados antigos',
    '- **Exportar** como TXT, Markdown, HTML, Word ou PDF (via impressão)',
    '- **Compartilhar** por link, inclusive com **proteção por senha** (criptografia AES-256-GCM feita no seu navegador)',
    '- Usar o **modo foco** para escrever sem distração',
    '',
    '## Importante saber',
    '',
    '- As notas ficam no armazenamento local **deste navegador**, não em um servidor.',
    '- Por isso, use o botão **Backup** (barra lateral) de tempos em tempos para baixar um arquivo `.json` com tudo.',
    '- Limpar os dados do navegador apaga as notas — o backup é a sua garantia.',
    '',
    '> Dica: pressione `Ctrl+S` a qualquer momento para forçar o salvamento.'
  ].join('\n');
  db.notes.push(w);
  localStorage.setItem('grafite.welcomed', '1');
  persist();
}

renderColSelects();
updateTrashLabel();
renderList();

const last = db.settings.lastOpen && getNote(db.settings.lastOpen) ? db.settings.lastOpen
  : (db.notes.length ? visibleNotes()[0]?.id : null);
if (last){ cur = last; }
renderEditor();
checkSharedHash();

})();
