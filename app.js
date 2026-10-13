// WOS 아이디어 뱅크 화면 로직
// 화면: 홈, 아이디어 상세, 등록/수정, 정규 WOS 리스트, 내 활동, 심의, (관리)

import { CONFIG } from './config.js';
import { createStore } from './store.js';

// ───────────── 공통 도구 ─────────────

const DAY = 86400000;
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const main = $('#main');

const STATUS = {
  collecting: '의견 수렴', pending: '심의 대기', listed: '정규 WOS 등재',
  hold: '보류', rejected: '미채택', merged: '병합',
};
const DECISIONS = { listed: '등재', hold: '보류', rejected: '미채택' };
const CRITERIA = [
  { key: 'impact', label: '업무 절감 효과', max: 25, hint: '반복 빈도 × 소요시간, 영향받는 사람 수' },
  { key: 'empathy', label: '구성원 공감', max: 20, hint: '좋아요 수와 댓글 내용, 여러 부서의 반응인지 (최대 20점)' },
  { key: 'spread', label: '확산 가능성', max: 20, hint: '다른 학과·부서에도 그대로 쓸 수 있는지' },
  { key: 'feasible', label: '구현 가능성', max: 20, hint: '필요 자원, 샘플 사이트가 있으면 가산' },
  { key: 'risk', label: '위험·개인정보', max: 15, hint: '개인정보 처리, 최종 판단을 사람이 하는지' },
];
const ROLES = { member: '구성원', operator: '센터 운영자', committee: '추진위원', admin: '관리자' };
const REWARD_KINDS = { point: '챌린지 포인트', prize: '포상금', special: '특별상' };
const FREQ_UNITS = { day: '하루', week: '주', month: '월' };
const PER_YEAR = { day: 250, week: 52, month: 12 }; // 하루 단위는 연간 근무일 250일 기준

let store;
let user = null;

const isStaff = () => !!user && ['operator', 'committee', 'admin'].includes(user.role);
const isOperator = () => !!user && ['operator', 'admin'].includes(user.role);

function startOfDay(t) { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); }
function parseDate(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d).getTime(); }
function fmtDate(t) { const d = new Date(t); return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`; }
function fmtShort(t) { const d = new Date(t); return `${d.getMonth() + 1}/${d.getDate()}(${'일월화수목금토'[d.getDay()]})`; }
function isoDate(t) { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function ago(t) {
  const m = Math.floor((Date.now() - t) / 60000);
  if (m < 1) return '방금';
  if (m < 60) return `${m}분 전`;
  if (m < 1440) return `${Math.floor(m / 60)}시간 전`;
  if (m < 1440 * 7) return `${Math.floor(m / 1440)}일 전`;
  return fmtDate(t);
}

// 심의 회차: 설정된 날짜 + 이후 격주 자동 계산
function reviewRounds(count = 60) {
  const dates = CONFIG.reviewDates.map(parseDate);
  while (dates.length < count) dates.push(dates[dates.length - 1] + CONFIG.reviewIntervalDays * DAY);
  return dates.map((date, i) => ({ id: 'R' + isoDate(date), no: i + 1, date }));
}
function nextRound(now = Date.now()) { return reviewRounds().find((r) => r.date >= startOfDay(now)); }
// 이 시각 "이전"에 등록된 아이디어만 해당 회차 안건이 될 수 있음 (예: 11/5 심의 → 10/29까지 등록)
function cutoffFor(round) { return round.date - (CONFIG.cutoffDays - 1) * DAY; }
function ddayText(round) {
  const d = Math.round((round.date - startOfDay(Date.now())) / DAY);
  return d === 0 ? 'D-Day' : `D-${d}`;
}

function annualHours(i) {
  const per = PER_YEAR[i.freqUnit];
  if (!per || !(i.freqCount > 0) || !(i.minutes > 0)) return null;
  return Math.round((i.freqCount * per * i.minutes) / 60);
}

// 비슷한 아이디어 찾기: 두 글자 묶음(bigram) 겹침 비율
function grams(s) {
  const t = String(s || '').toLowerCase().replace(/[\s\p{P}]+/gu, '');
  const g = new Set();
  for (let i = 0; i < t.length - 1; i++) g.add(t.slice(i, i + 2));
  return g;
}
function similarity(a, b) {
  const A = grams(a); const B = grams(b);
  if (!A.size || !B.size) return 0;
  let n = 0;
  for (const x of A) if (B.has(x)) n++;
  return n / (A.size + B.size - n);
}

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove('show'), 2400);
}

async function busy(btn, fn) {
  if (btn) btn.disabled = true;
  try { return await fn(); } catch (e) { console.error(e); alert('처리하지 못했습니다: ' + (e.message || e)); return undefined; } finally { if (btn) btn.disabled = false; }
}

function statusChip(s) { return `<span class="chip st-${esc(s)}">${esc(STATUS[s] || s)}</span>`; }
function safeUrl(u) { try { const x = new URL(u); return ['http:', 'https:'].includes(x.protocol) ? x.href : null; } catch { return null; } }

function visibleIdeas(ideas) { return ideas.filter((i) => !i.hidden || isOperator()); }

function notifyN8n(payload) {
  if (!CONFIG.n8nWebhook) return;
  fetch(CONFIG.n8nWebhook, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(payload), mode: 'no-cors' })
    .catch((e) => console.warn('n8n 알림 실패', e));
}

function downloadCsv(filename, rows) {
  const csv = rows.map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// 실제 제안자 uid (익명 포함). 운영자 또는 본인만 읽을 수 있음
async function ownerOf(ideaId) {
  try { return (await store.get('ideaOwners', ideaId))?.uid || null; } catch { return null; }
}

// ───────────── 화면 틀 ─────────────

function renderNav() {
  const h = location.hash || '#/';
  const tab = (href, icon, label) => {
    const on = href === '#/' ? (h === '#/' || h === '' || h.startsWith('#/idea')) : h.startsWith(href);
    return `<a href="${href}" class="${on ? 'on' : ''}"><span class="ico">${icon}</span>${label}</a>`;
  };
  $('#nav').innerHTML = [
    tab('#/', '🏠', '홈'),
    tab('#/wos', '📋', '정규 WOS'),
    tab('#/new', '➕', '등록'),
    tab('#/me', '🙋', '내 활동'),
    isStaff() ? tab('#/review', '⚖️', '심의') : '',
    user?.role === 'admin' ? tab('#/admin', '⚙️', '관리') : '',
  ].join('');
  $('#userbox').innerHTML = user
    ? `<span class="who">${esc(user.name)}<small>${esc(ROLES[user.role] || '')}</small></span><button class="btn ghost sm" id="logout">로그아웃</button>`
    : '';
  $('#modebadge').hidden = store.mode !== 'demo';
}

const routes = [
  [/^#?\/?$/, homePage],
  [/^#\/idea\/([\w-]+)$/, detailPage],
  [/^#\/new$/, () => formPage(null)],
  [/^#\/edit\/([\w-]+)$/, formPage],
  [/^#\/wos$/, wosPage],
  [/^#\/me$/, mePage],
  [/^#\/review$/, reviewPage],
  [/^#\/admin$/, adminPage],
];

async function render() {
  if (!user) { renderNav(); return loginPage(); }
  if (!user.dept || !user.type) { renderNav(); return profilePage(true); }
  const h = location.hash || '#/';
  for (const [re, fn] of routes) {
    const m = h.match(re);
    if (!m) continue;
    renderNav();
    main.innerHTML = '<div class="loading">불러오는 중…</div>';
    try { await fn(...m.slice(1)); } catch (e) {
      console.error(e);
      main.innerHTML = `<div class="card error">화면을 불러오지 못했습니다.<br><small>${esc(e.message)}</small></div>`;
    }
    return;
  }
  location.hash = '#/';
}

// ───────────── 로그인 · 프로필 ─────────────

function loginPage() {
  if (store.mode === 'demo') {
    const users = store.demoUsers();
    main.innerHTML = `
      <section class="hero">
        <h1>WOS 아이디어 뱅크</h1>
        <p>업무 개선 아이디어를 언제든 올리고, 좋아요·댓글로 함께 다듬어 격주 심의에 올립니다.</p>
      </section>
      <div class="card">
        <h2>체험 모드</h2>
        <p class="muted">Firebase 연결 전이라 이 브라우저에만 저장됩니다. 역할별 화면을 보려면 아래 사용자 중 하나로 들어가세요.</p>
        <div class="demo-users">
          ${users.map((u) => `<button class="demo-user" data-uid="${esc(u.uid)}"><b>${esc(u.name)}</b><span>${esc(u.dept)} · ${esc(ROLES[u.role])}</span></button>`).join('')}
        </div>
        <button class="btn ghost sm" id="reset-demo">체험 데이터 초기화</button>
      </div>`;
    $$('.demo-user').forEach((b) => b.onclick = () => store.signIn(b.dataset.uid));
    $('#reset-demo').onclick = () => { if (confirm('체험 데이터를 처음 상태로 되돌릴까요?')) { store.resetDemo(); toast('초기화했습니다'); } };
    return;
  }
  main.innerHTML = `
    <section class="hero">
      <h1>WOS 아이디어 뱅크</h1>
      <p>업무 개선 아이디어를 언제든 올리고, 좋아요·댓글로 함께 다듬어 격주 심의에 올립니다.</p>
    </section>
    <div class="card center">
      <p>우송대 교원·직원은 학교 구글 계정(@${esc(CONFIG.allowedDomain)})으로 로그인하세요.</p>
      <button class="btn primary lg" id="google-login">학교 구글 계정으로 로그인</button>
    </div>`;
  $('#google-login').onclick = (e) => busy(e.target, () => store.signIn());
}

function profilePage(first) {
  main.innerHTML = `
    <div class="card">
      <h2>${first ? '처음 오셨네요! 소속을 알려 주세요' : '내 정보 수정'}</h2>
      <p class="muted">아이디어를 등록할 때 소속이 자동으로 들어갑니다.</p>
      <form id="pf" class="form">
        <label>이름<input name="name" required maxlength="20" value="${esc(user.name)}"></label>
        <label>소속(학과·부서)<input name="dept" required maxlength="30" placeholder="예: AI경영학과" value="${esc(user.dept)}"></label>
        <fieldset><legend>구분</legend>
          ${['교원', '직원'].map((t) => `<label class="inline"><input type="radio" name="type" value="${t}" required ${user.type === t ? 'checked' : ''}> ${t}</label>`).join('')}
        </fieldset>
        <button class="btn primary">저장</button>
        ${first ? '' : '<a class="btn ghost" href="#/me">취소</a>'}
      </form>
    </div>`;
  $('#pf').onsubmit = (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    busy(e.submitter, async () => {
      user = await store.saveProfile({ name: f.get('name').trim(), dept: f.get('dept').trim(), type: f.get('type') });
      toast('저장했습니다');
      if (first) render(); else location.hash = '#/me';
    });
  };
}

// ───────────── 홈 ─────────────

const homeState = { sort: 'new', cat: '', status: '', q: '' };

function ideaCard(i) {
  return `
    <a class="idea" href="#/idea/${esc(i.id)}">
      <div class="idea-top">${statusChip(i.status)}<span class="chip cat">${esc(i.category)}</span>${i.samples?.length ? '<span class="chip sample">샘플 있음</span>' : ''}${i.hidden ? '<span class="chip warn">숨김</span>' : ''}${i.wosNumber ? `<span class="chip wos">${esc(i.wosNumber)}</span>` : ''}</div>
      <h3>${esc(i.title)}</h3>
      <p class="tobe">${esc(i.tobe)}</p>
      <div class="meta"><span>${esc(i.authorName)}${i.authorDept ? ` · ${esc(i.authorDept)}` : ''}</span><span>${ago(i.createdAt)}</span><span class="counts">❤️ ${i.likeCount || 0} · 💬 ${i.commentCount || 0}</span></div>
    </a>`;
}

async function homePage() {
  const ideas = visibleIdeas(await store.list('ideas'));
  const round = nextRound();
  const weekAgo = Date.now() - 7 * DAY;
  const open = ideas.filter((i) => ['collecting', 'pending'].includes(i.status));
  const byLikes = (a, b) => (b.likeCount || 0) - (a.likeCount || 0) || b.createdAt - a.createdAt;
  const weekTop = [...open.filter((i) => i.createdAt >= weekAgo).sort(byLikes), ...open.filter((i) => i.createdAt < weekAgo).sort(byLikes)].slice(0, 3);

  main.innerHTML = `
    <section class="banner">
      <div>
        <div class="banner-label">다음 심의</div>
        <div class="banner-big">${fmtShort(round.date)} <span class="dday">${ddayText(round)}</span></div>
        <div class="banner-sub">${fmtShort(cutoffFor(round) - DAY)}까지 등록한 아이디어가 이번 심의 대상입니다</div>
      </div>
      <a class="btn light" href="#/new">아이디어 올리기</a>
    </section>
    ${weekTop.length ? `
    <section>
      <h2 class="sec">🔥 이번 주 인기 아이디어</h2>
      <div class="top3">${weekTop.map((i, n) => `<a class="top" href="#/idea/${esc(i.id)}"><span class="rank">${n + 1}</span><span class="t">${esc(i.title)}</span><span class="l">❤️ ${i.likeCount || 0}</span></a>`).join('')}</div>
    </section>` : ''}
    <section>
      <div class="filters">
        <input id="q" type="search" placeholder="검색 (제목·내용)" value="${esc(homeState.q)}">
        <select id="sort"><option value="new">최신순</option><option value="likes">좋아요순</option><option value="comments">댓글순</option></select>
        <select id="cat"><option value="">전체 분야</option>${CONFIG.categories.map((c) => `<option>${esc(c)}</option>`).join('')}</select>
        <select id="status"><option value="">전체 상태</option>${Object.entries(STATUS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
      </div>
      <div id="list"></div>
    </section>`;
  $('#sort').value = homeState.sort;
  $('#cat').value = homeState.cat;
  $('#status').value = homeState.status;

  const draw = () => {
    const q = homeState.q.trim().toLowerCase();
    let list = ideas.filter((i) => (!homeState.cat || i.category === homeState.cat)
      && (!homeState.status || i.status === homeState.status)
      && (!q || `${i.title} ${i.asis} ${i.tobe}`.toLowerCase().includes(q)));
    const sorters = {
      new: (a, b) => b.createdAt - a.createdAt,
      likes: byLikes,
      comments: (a, b) => (b.commentCount || 0) - (a.commentCount || 0) || b.createdAt - a.createdAt,
    };
    list = list.sort(sorters[homeState.sort]);
    $('#list').innerHTML = list.length ? list.map(ideaCard).join('') : '<div class="empty">조건에 맞는 아이디어가 없습니다.<br><a href="#/new">첫 아이디어를 올려 보세요 →</a></div>';
  };
  for (const k of ['sort', 'cat', 'status']) $('#' + k).onchange = (e) => { homeState[k] = e.target.value; draw(); };
  $('#q').oninput = (e) => { homeState.q = e.target.value; draw(); };
  draw();
}

// ───────────── 아이디어 상세 ─────────────

function sampleCard(url) {
  const safe = safeUrl(url);
  if (!safe) return '';
  const host = new URL(safe).hostname;
  return `
    <div class="sample-card">
      <a href="${esc(safe)}" target="_blank" rel="noopener noreferrer" class="sample-link">
        <img src="https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64" alt="" width="32" height="32" loading="lazy">
        <div><b>${esc(host)}</b><span>${esc(safe)}</span></div>
        <span class="go">바로가기 ↗</span>
      </a>
      <details><summary>화면 미리보기</summary><iframe src="${esc(safe)}" loading="lazy" sandbox="allow-scripts allow-same-origin allow-forms" referrerpolicy="no-referrer"></iframe><small class="muted">미리보기를 막아 둔 사이트는 '바로가기'로 열어 주세요.</small></details>
    </div>`;
}

async function detailPage(id) {
  const idea = await store.get('ideas', id);
  if (!idea || (idea.hidden && !isOperator())) { main.innerHTML = '<div class="card">아이디어를 찾을 수 없습니다. <a href="#/">목록으로</a></div>'; return; }
  const [ownerUid, likeDoc, comments] = await Promise.all([
    ownerOf(id),
    store.get(`ideas/${id}/likes`, user.uid),
    store.list(`ideas/${id}/comments`),
  ]);
  const mine = ownerUid === user.uid;
  const canEdit = (mine && ['collecting', 'hold'].includes(idea.status)) || isOperator();
  const canDelete = (mine && idea.status === 'collecting') || isOperator();
  const hours = annualHours(idea);
  let liked = !!likeDoc;

  comments.sort((a, b) => a.createdAt - b.createdAt);
  const roots = comments.filter((c) => !c.parentId);
  const children = (pid) => comments.filter((c) => c.parentId === pid);
  const commentHtml = (c) => `
    <div class="comment">
      <div class="c-head"><b>${esc(c.authorName)}</b>${c.byProposer ? '<span class="chip proposer">제안자</span>' : ''}<small>${ago(c.createdAt)}</small></div>
      <p>${esc(c.text)}</p>
      ${c.parentId ? '' : `<button class="link reply-btn" data-cid="${esc(c.id)}">답글</button>`}
      <div class="replies">${children(c.id).map(commentHtml).join('')}</div>
      <div class="reply-slot" id="reply-${esc(c.id)}"></div>
    </div>`;

  const history = idea.history || [];
  main.innerHTML = `
    <a href="#/" class="back">← 목록</a>
    <article class="card detail">
      <div class="idea-top">${statusChip(idea.status)}<span class="chip cat">${esc(idea.category)}</span>${idea.wosNumber ? `<a class="chip wos" href="#/wos">${esc(idea.wosNumber)}</a>` : ''}${idea.hidden ? '<span class="chip warn">숨김 처리됨</span>' : ''}</div>
      <h1>${esc(idea.title)}</h1>
      <div class="meta"><span>${esc(idea.authorName)}${idea.authorDept ? ` · ${esc(idea.authorDept)}` : ''}</span><span>${fmtDate(idea.createdAt)} 등록</span>${idea.resubmitted ? '<span class="chip">보완 재상정</span>' : ''}</div>
      ${idea.mergedInto ? `<div class="notice">이 아이디어는 <a href="#/idea/${esc(idea.mergedInto)}">다른 아이디어</a>에 병합되었습니다.</div>` : ''}

      <div class="asis-tobe">
        <div><h4>지금은 이렇게 하고 있어요</h4><p>${esc(idea.asis)}</p></div>
        <div class="arrow">→</div>
        <div><h4>이렇게 바꾸고 싶어요</h4><p>${esc(idea.tobe)}</p></div>
      </div>

      <dl class="facts">
        ${idea.targets?.length ? `<dt>대상 사용자</dt><dd>${idea.targets.map(esc).join(', ')}</dd>` : ''}
        ${hours ? `<dt>반복 빈도</dt><dd>${esc(FREQ_UNITS[idea.freqUnit])} ${esc(idea.freqCount)}건 × 건당 ${esc(idea.minutes)}분</dd><dt>연간 절감시간</dt><dd><b class="hl">약 ${hours.toLocaleString()}시간</b></dd>` : ''}
        ${idea.reusable ? `<dt>다른 학과 활용</dt><dd>${esc(idea.reusable)}</dd>` : ''}
        ${idea.coProposers?.length ? `<dt>함께할 사람</dt><dd>${idea.coProposers.map(esc).join(', ')}</dd>` : ''}
      </dl>

      ${idea.samples?.length ? `<h3 class="sub">샘플 사이트</h3>${idea.samples.map(sampleCard).join('')}` : ''}
      ${idea.attachments?.length ? `<h3 class="sub">첨부</h3><ul class="files">${idea.attachments.map((a) => `<li>${a.url ? `<a href="${esc(a.url)}" target="_blank" rel="noopener" download="${esc(a.name)}">${esc(a.name)}</a>` : esc(a.name) + ' <small class="muted">(체험 모드: 1MB 초과 파일은 보관 안 함)</small>'}</li>`).join('')}</ul>` : ''}

      <div class="actions">
        <button class="btn like ${liked ? 'on' : ''}" id="like">❤️ 좋아요 <b id="like-n">${idea.likeCount || 0}</b></button>
        ${canEdit ? `<a class="btn ghost" href="#/edit/${esc(id)}">${idea.status === 'hold' && mine ? '보완하기' : '수정'}</a>` : ''}
        ${canDelete ? '<button class="btn ghost danger" id="del">삭제</button>' : ''}
      </div>
      ${mine && idea.status === 'hold' ? '<div class="notice">보류된 아이디어입니다. 심의 사유를 참고해 내용을 보완하면 다음 회차에 다시 올라갑니다.</div>' : ''}
    </article>

    ${history.length ? `
    <section class="card">
      <h3>심의 이력과 결정 사유</h3>
      <ul class="timeline">${history.map((h) => `<li><b>${esc(h.label || DECISIONS[h.decision] || STATUS[h.decision] || h.decision)}</b> <small>${fmtDate(h.at)}${h.roundDate ? ` · ${fmtShort(h.roundDate)} 심의` : ''}${h.avg != null ? ` · 평균 ${h.avg}점` : ''}</small>${h.reason ? `<p>${esc(h.reason)}</p>` : ''}</li>`).join('')}</ul>
    </section>` : ''}

    ${isOperator() ? operatorPanel(idea, ownerUid) : ''}

    <section class="card">
      <h3>댓글 ${comments.length}</h3>
      <div id="comments">${roots.map(commentHtml).join('') || '<p class="muted">첫 의견을 남겨 주세요.</p>'}</div>
      <form class="comment-form" id="cf">
        <textarea name="text" required maxlength="500" rows="2" placeholder="${mine ? '제안자로 답하거나 내용을 보완해 주세요' : '의견이나 경험을 나눠 주세요'}"></textarea>
        <button class="btn primary">등록</button>
      </form>
    </section>`;

  const addComment = async (text, parentId) => {
    const anonProposer = mine && idea.anonymous;
    const cid = store.newId();
    await store.batch([
      { op: 'set', path: `ideas/${id}/comments`, id: cid, data: {
        authorUid: anonProposer ? null : user.uid,
        authorName: anonProposer ? '익명 제안자' : user.name,
        byProposer: mine, text, parentId: parentId || null, createdAt: Date.now(),
      } },
      { op: 'update', path: 'ideas', id, data: { commentCount: store.inc(1) } },
    ]);
    render();
  };

  $('#cf').onsubmit = (e) => {
    e.preventDefault();
    const text = e.target.text.value.trim();
    if (text) busy(e.submitter, () => addComment(text, null));
  };
  $$('.reply-btn').forEach((b) => b.onclick = () => {
    const slot = $('#reply-' + b.dataset.cid);
    if (slot.innerHTML) { slot.innerHTML = ''; return; }
    slot.innerHTML = '<form class="comment-form"><textarea name="text" required maxlength="500" rows="2" placeholder="답글"></textarea><button class="btn primary sm">답글 등록</button></form>';
    const f = $('form', slot);
    f.text.focus();
    f.onsubmit = (e) => { e.preventDefault(); const t = f.text.value.trim(); if (t) busy(e.submitter, () => addComment(t, b.dataset.cid)); };
  });

  $('#like').onclick = (e) => busy(e.currentTarget, async () => {
    const path = `ideas/${id}/likes`;
    await store.batch(liked
      ? [{ op: 'delete', path, id: user.uid }, { op: 'update', path: 'ideas', id, data: { likeCount: store.inc(-1) } }]
      : [{ op: 'set', path, id: user.uid, data: { uid: user.uid, createdAt: Date.now() } }, { op: 'update', path: 'ideas', id, data: { likeCount: store.inc(1) } }]);
    liked = !liked;
    idea.likeCount = (idea.likeCount || 0) + (liked ? 1 : -1);
    $('#like').classList.toggle('on', liked);
    $('#like-n').textContent = idea.likeCount;
  });

  $('#del')?.addEventListener('click', (e) => {
    if (!confirm('이 아이디어를 삭제할까요? 좋아요와 댓글도 함께 사라집니다.')) return;
    busy(e.target, async () => {
      const [likes, cmts] = await Promise.all([store.list(`ideas/${id}/likes`), store.list(`ideas/${id}/comments`)]);
      await store.batch([
        ...likes.map((l) => ({ op: 'delete', path: `ideas/${id}/likes`, id: l.id })),
        ...cmts.map((c) => ({ op: 'delete', path: `ideas/${id}/comments`, id: c.id })),
        { op: 'delete', path: 'ideas', id },
        { op: 'delete', path: 'ideaOwners', id },
      ]);
      toast('삭제했습니다');
      location.hash = '#/';
    });
  });

  if (isOperator()) bindOperatorPanel(idea, ownerUid);
}

// 운영자 전용: 내용 확인(→심의 대기, 포인트 지급), 숨김, 병합, 상태 변경
function operatorPanel(idea, ownerUid) {
  const days = Math.floor((Date.now() - idea.createdAt) / DAY);
  return `
    <section class="card op">
      <h3>운영자 도구</h3>
      <p class="muted">실제 제안자: <b id="owner-name">${ownerUid ? '확인 중…' : '알 수 없음'}</b> · 등록 ${days}일째</p>
      <div class="actions wrap">
        ${idea.status === 'collecting' ? `<button class="btn primary" id="op-confirm">내용 확인 → 심의 대기${idea.pointsAwarded ? '' : ` (+${CONFIG.pointsPerIdea}P 지급)`}</button>` : ''}
        <button class="btn ghost" id="op-hide">${idea.hidden ? '숨김 해제' : '부적절 글 숨김'}</button>
      </div>
      ${idea.status !== 'merged' ? `
      <details><summary>비슷한 아이디어와 병합</summary>
        <div class="row"><select id="merge-target"><option value="">합칠 대상 선택…</option></select><button class="btn ghost" id="op-merge">병합</button></div>
        <small class="muted">좋아요·댓글이 선택한 아이디어로 옮겨지고, 이 글은 '병합' 상태로 목록에 남습니다.</small>
      </details>` : ''}
      <details><summary>상태 직접 변경</summary>
        <div class="row"><select id="op-status">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${k === idea.status ? 'selected' : ''}>${v}</option>`).join('')}</select><button class="btn ghost" id="op-status-save">변경</button></div>
      </details>
    </section>`;
}

async function bindOperatorPanel(idea, ownerUid) {
  const id = idea.id;
  if (ownerUid) store.get('users', ownerUid).then((u) => { $('#owner-name').textContent = u ? `${u.name} (${u.dept})` : ownerUid; }).catch(() => {});

  $('#op-confirm')?.addEventListener('click', (e) => {
    if (Date.now() - idea.createdAt < CONFIG.cutoffDays * DAY && !confirm(`등록 후 ${CONFIG.cutoffDays}일이 지나지 않았습니다. 그래도 심의 대기로 넘길까요?`)) return;
    busy(e.target, async () => { await confirmIdea(idea, ownerUid); toast('심의 대기로 넘겼습니다'); render(); });
  });
  $('#op-hide').onclick = (e) => busy(e.target, async () => { await store.update('ideas', id, { hidden: !idea.hidden }); render(); });

  const sel = $('#merge-target');
  if (sel) {
    const all = await store.list('ideas');
    const candidates = all.filter((i) => i.id !== id && i.status !== 'merged')
      .map((i) => ({ i, s: similarity(`${idea.title} ${idea.tobe}`, `${i.title} ${i.tobe}`) }))
      .sort((a, b) => b.s - a.s);
    sel.innerHTML += candidates.map(({ i, s }) => `<option value="${esc(i.id)}">${s > 0.15 ? '★ ' : ''}${esc(i.title)}</option>`).join('');
    $('#op-merge').onclick = (e) => {
      if (!sel.value) return alert('합칠 대상을 고르세요.');
      if (!confirm('병합하면 되돌리기 어렵습니다. 진행할까요?')) return;
      busy(e.target, async () => { await mergeIdea(idea, sel.value); toast('병합했습니다'); location.hash = '#/idea/' + sel.value; });
    };
  }
  $('#op-status-save').onclick = (e) => busy(e.target, async () => {
    const s = $('#op-status').value;
    if (s === idea.status) return;
    await store.update('ideas', id, { status: s, history: [...(idea.history || []), { decision: s, label: `상태 변경: ${STATUS[s]}`, at: Date.now(), by: user.name }] });
    render();
  });
}

async function confirmIdea(idea, ownerUid) {
  const ops = [{ op: 'update', path: 'ideas', id: idea.id, data: { status: 'pending', confirmedAt: Date.now(), pointsAwarded: true } }];
  if (!idea.pointsAwarded && ownerUid) {
    ops.push(
      { op: 'update', path: 'users', id: ownerUid, data: { points: store.inc(CONFIG.pointsPerIdea) } },
      { op: 'set', path: 'rewards', id: store.newId(), data: { uid: ownerUid, ideaId: idea.id, ideaTitle: idea.title, kind: 'point', amount: CONFIG.pointsPerIdea, createdAt: Date.now() } },
    );
  }
  await store.batch(ops);
}

async function mergeIdea(src, targetId) {
  const target = await store.get('ideas', targetId);
  const [srcLikes, tgtLikes, srcComments] = await Promise.all([
    store.list(`ideas/${src.id}/likes`), store.list(`ideas/${targetId}/likes`), store.list(`ideas/${src.id}/comments`),
  ]);
  const have = new Set(tgtLikes.map((l) => l.id));
  const ops = [];
  let moved = 0;
  for (const l of srcLikes) {
    if (!have.has(l.id)) { const { id: lid, ...d } = l; ops.push({ op: 'set', path: `ideas/${targetId}/likes`, id: lid, data: d }); moved++; }
  }
  const idMap = Object.fromEntries(srcComments.map((c) => [c.id, store.newId()]));
  for (const c of srcComments) {
    const { id: cid, ...d } = c;
    ops.push({ op: 'set', path: `ideas/${targetId}/comments`, id: idMap[cid], data: { ...d, parentId: c.parentId ? idMap[c.parentId] || null : null, byProposer: false, mergedFrom: src.id } });
  }
  ops.push({ op: 'update', path: 'ideas', id: targetId, data: {
    likeCount: store.inc(moved), commentCount: store.inc(srcComments.length),
    mergedFrom: [...(target.mergedFrom || []), src.id],
  } });
  ops.push({ op: 'update', path: 'ideas', id: src.id, data: {
    status: 'merged', mergedInto: targetId,
    history: [...(src.history || []), { decision: 'merged', label: '병합', reason: `「${target.title}」에 병합되었습니다.`, at: Date.now() }],
  } });
  await store.batch(ops);
}

// ───────────── 등록 · 수정 ─────────────

const DRAFT_KEY = 'wos-idea-draft';

async function formPage(editId) {
  let idea = null;
  let wasHold = false;
  if (editId) {
    idea = await store.get('ideas', editId);
    const owner = await ownerOf(editId);
    const allowed = idea && ((owner === user.uid && ['collecting', 'hold'].includes(idea.status)) || isOperator());
    if (!allowed) { main.innerHTML = '<div class="card">수정할 수 없는 아이디어입니다. (심의가 시작되면 수정할 수 없어요)</div>'; return; }
    wasHold = idea.status === 'hold' && owner === user.uid;
  }
  let draft = null;
  if (!editId) { try { draft = JSON.parse(localStorage.getItem(DRAFT_KEY)); } catch { draft = null; } }
  const v = idea || draft || {};
  const [allIdeas, users] = await Promise.all([store.list('ideas'), store.list('users').catch(() => [])]);
  const others = visibleIdeas(allIdeas).filter((i) => i.id !== editId && i.status !== 'merged');

  main.innerHTML = `
    <a href="${editId ? `#/idea/${esc(editId)}` : '#/'}" class="back">← 돌아가기</a>
    <div class="card">
      <h1>${editId ? (wasHold ? '아이디어 보완하기' : '아이디어 수정') : '아이디어 등록'}</h1>
      ${draft && !editId ? '<div class="notice">임시 저장된 내용을 불러왔습니다. <button type="button" class="link" id="clear-draft">새로 쓰기</button></div>' : ''}
      ${wasHold ? '<div class="notice">보완해서 저장하면 다음 회차 심의에 다시 올라갑니다.</div>' : ''}
      <form id="idea-form" class="form" novalidate>
        <p class="muted">⭐ 표시 5개 항목만 쓰면 등록됩니다. 1분이면 충분해요.</p>
        <label>⭐ 제목 <small class="count" data-for="title"></small>
          <input name="title" maxlength="40" required placeholder="예: 휴강·복학 문의 자동 응답" value="${esc(v.title)}">
        </label>
        <div id="similar"></div>
        <label>⭐ 지금 어떻게 하고 있나요? <small>(3줄 이내)</small>
          <textarea name="asis" rows="3" maxlength="300" required placeholder="예: 학기마다 조교가 같은 문의에 일일이 답함">${esc(v.asis)}</textarea>
        </label>
        <label>⭐ 바꾸고 싶은 모습 <small>(3줄 이내)</small>
          <textarea name="tobe" rows="3" maxlength="300" required placeholder="예: FAQ는 자동 답변, 나머지만 담당자 연결">${esc(v.tobe)}</textarea>
        </label>
        <label>⭐ 분야
          <select name="category" required><option value="">선택하세요</option>${CONFIG.categories.map((c) => `<option ${v.category === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
        </label>
        <div class="auto-field">⭐ 제안자 소속 <b>${esc(idea ? (idea.authorDept || '익명') : `${user.dept}, ${user.type}`)}</b> <small class="muted">(로그인 정보에서 자동 입력)</small></div>
        <fieldset><legend>⭐ 공개 방식</legend>
          <label class="inline"><input type="radio" name="anonymous" value="no" ${v.anonymous ? '' : 'checked'} ${idea ? 'disabled' : ''}> 실명</label>
          <label class="inline"><input type="radio" name="anonymous" value="yes" ${v.anonymous ? 'checked' : ''} ${idea ? 'disabled' : ''}> 익명</label>
          <small class="muted block">익명이면 화면에 '익명 제안자'로 보이고, 실제 제안자는 운영자만 확인합니다. 포인트는 익명이어도 본인에게 쌓입니다.${idea ? ' (등록 후에는 바꿀 수 없어요)' : ''}</small>
        </fieldset>

        <details class="optional" ${idea || draft ? 'open' : ''}>
          <summary>선택 항목 (심의에 도움이 됩니다)</summary>
          <label>샘플 사이트 주소 <small>(한 줄에 하나, 심의 가산점)</small>
            <textarea name="samples" rows="2" placeholder="https://...">${esc((v.samples || []).join('\n'))}</textarea>
          </label>
          <fieldset><legend>대상 사용자</legend>
            ${CONFIG.targetUsers.map((t) => `<label class="inline"><input type="checkbox" name="targets" value="${esc(t)}" ${(v.targets || []).includes(t) ? 'checked' : ''}> ${esc(t)}</label>`).join('')}
          </fieldset>
          <fieldset><legend>반복 빈도와 소요시간</legend>
            <div class="row freq">
              <select name="freqUnit">${Object.entries(FREQ_UNITS).map(([k, l]) => `<option value="${k}" ${(v.freqUnit || 'week') === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
              <input name="freqCount" type="number" min="0" step="1" placeholder="건수" value="${esc(v.freqCount ?? '')}"><span>건 ×</span>
              <input name="minutes" type="number" min="0" step="1" placeholder="분" value="${esc(v.minutes ?? '')}"><span>분</span>
            </div>
            <div id="savings" class="savings"></div>
          </fieldset>
          <fieldset><legend>다른 학과에도 쓸 수 있나요?</legend>
            ${['예', '아니오', '모름'].map((r) => `<label class="inline"><input type="radio" name="reusable" value="${r}" ${(v.reusable || '모름') === r ? 'checked' : ''}> ${r}</label>`).join('')}
          </fieldset>
          <label>첨부 <small>(이미지·PDF, 파일당 5MB 이하)</small>
            <input name="files" type="file" accept="image/*,application/pdf" multiple>
          </label>
          ${idea?.attachments?.length ? `<ul class="files" id="old-files">${idea.attachments.map((a, n) => `<li><label class="inline"><input type="checkbox" name="keepFile" value="${n}" checked> ${esc(a.name)}</label></li>`).join('')}</ul>` : ''}
          <label>함께할 사람 <small>(이름, 쉼표로 구분)</small>
            <input name="coProposers" list="user-names" placeholder="예: 홍길동, 김철수" value="${esc((v.coProposers || []).join(', '))}">
            <datalist id="user-names">${users.map((u) => `<option value="${esc(u.name)}">${esc(u.dept || '')}</option>`).join('')}</datalist>
          </label>
        </details>

        <div id="form-error" class="form-error" hidden></div>
        <button class="btn primary lg">${editId ? '저장' : '등록하기'}</button>
      </form>
    </div>`;

  const form = $('#idea-form');
  const read = () => {
    const f = new FormData(form);
    return {
      title: (f.get('title') || '').trim(),
      asis: (f.get('asis') || '').trim(),
      tobe: (f.get('tobe') || '').trim(),
      category: f.get('category') || '',
      anonymous: f.get('anonymous') === 'yes',
      samples: (f.get('samples') || '').split('\n').map((s) => s.trim()).filter(Boolean),
      targets: f.getAll('targets'),
      freqUnit: f.get('freqUnit'),
      freqCount: Number(f.get('freqCount')) || null,
      minutes: Number(f.get('minutes')) || null,
      reusable: f.get('reusable') || '모름',
      coProposers: (f.get('coProposers') || '').split(',').map((s) => s.trim()).filter(Boolean),
    };
  };
  const update = () => {
    const d = read();
    $('.count[data-for=title]').textContent = `${d.title.length}/40`;
    const h = annualHours(d);
    $('#savings').innerHTML = h ? `연간 약 <b>${h.toLocaleString()}시간</b> 절감 예상 <small class="muted">(심의·예산 요청 근거로 쓰입니다)</small>` : '';
    const text = `${d.title} ${d.tobe}`;
    const sims = d.title.length >= 2 ? others.map((i) => ({ i, s: similarity(text, `${i.title} ${i.tobe}`) })).filter((x) => x.s > 0.12).sort((a, b) => b.s - a.s).slice(0, 3) : [];
    $('#similar').innerHTML = sims.length ? `<div class="similar"><b>비슷한 아이디어가 있어요.</b> 같은 내용이면 새로 올리기보다 좋아요·댓글로 힘을 보태 주세요.${sims.map(({ i }) => `<a href="#/idea/${esc(i.id)}" target="_blank">${esc(i.title)} <small>❤️ ${i.likeCount || 0}</small></a>`).join('')}</div>` : '';
    if (!editId) { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(d)); } catch { /* 임시 저장 실패는 무시 */ } }
  };
  form.oninput = update;
  form.onchange = update;
  update();
  $('#clear-draft')?.addEventListener('click', () => { localStorage.removeItem(DRAFT_KEY); render(); });

  form.onsubmit = (e) => {
    e.preventDefault();
    const d = read();
    const errs = [];
    if (!d.title) errs.push('제목을 써 주세요.');
    if (d.title.length > 40) errs.push('제목은 40자 이내로 써 주세요.');
    if (!d.asis) errs.push('지금 어떻게 하고 있는지 써 주세요.');
    if (!d.tobe) errs.push('바꾸고 싶은 모습을 써 주세요.');
    if (d.asis.split('\n').length > 3 || d.tobe.split('\n').length > 3) errs.push('현재 방식과 바꾸고 싶은 모습은 각각 3줄 이내로 써 주세요.');
    if (!d.category) errs.push('분야를 골라 주세요.');
    const badUrl = d.samples.find((u) => !safeUrl(u));
    if (badUrl) errs.push(`샘플 주소가 올바르지 않습니다: ${badUrl}`);
    const files = [...form.files.files];
    for (const f of files) {
      if (f.size > 5 * 1024 * 1024) errs.push(`${f.name}: 5MB를 넘습니다.`);
      if (!(f.type.startsWith('image/') || f.type === 'application/pdf')) errs.push(`${f.name}: 이미지나 PDF만 올릴 수 있습니다.`);
    }
    const errBox = $('#form-error');
    if (errs.length) { errBox.innerHTML = errs.map(esc).join('<br>'); errBox.hidden = false; errBox.scrollIntoView({ block: 'center' }); return; }
    errBox.hidden = true;

    busy(e.submitter, async () => {
      const id = editId || store.newId();
      const uploaded = [];
      for (const f of files) uploaded.push(await store.uploadFile(f, `ideas/${id}`));
      const keep = idea ? $$('input[name=keepFile]:checked', form).map((x) => idea.attachments[Number(x.value)]) : [];
      const fields = {
        title: d.title, asis: d.asis, tobe: d.tobe, category: d.category, samples: d.samples, targets: d.targets,
        freqUnit: d.freqUnit, freqCount: d.freqCount, minutes: d.minutes, reusable: d.reusable,
        coProposers: d.coProposers, attachments: [...keep, ...uploaded], updatedAt: Date.now(),
      };
      if (editId) {
        if (wasHold) Object.assign(fields, { status: 'pending', resubmitted: true });
        await store.update('ideas', editId, fields);
        toast(wasHold ? '보완했습니다. 다음 회차에 다시 심의합니다' : '저장했습니다');
      } else {
        await store.batch([
          { op: 'set', path: 'ideaOwners', id, data: { uid: user.uid, createdAt: Date.now() } },
          { op: 'set', path: 'ideas', id, data: {
            ...fields,
            anonymous: d.anonymous,
            ownerUid: d.anonymous ? null : user.uid,
            authorName: d.anonymous ? '익명 제안자' : user.name,
            authorDept: d.anonymous ? '' : `${user.dept}, ${user.type}`,
            status: 'collecting', likeCount: 0, commentCount: 0, hidden: false, history: [], createdAt: Date.now(),
          } },
        ]);
        localStorage.removeItem(DRAFT_KEY);
        toast('등록했습니다! 7일 동안 의견을 받습니다');
      }
      location.hash = '#/idea/' + id;
    });
  };
}

// ───────────── 정규 WOS 리스트 ─────────────

async function wosPage() {
  const list = (await store.list('wos')).sort((a, b) => a.number.localeCompare(b.number));
  main.innerHTML = `
    <h1 class="page-title">정규 WOS 리스트</h1>
    <p class="muted">추진위원회가 등재한 아이디어입니다. 번호를 받은 뒤 실행계획서 단계로 넘어갑니다.</p>
    ${list.length ? `<div class="wos-list">${list.map((w) => `
      <div class="card wos-item">
        <div class="wos-head"><span class="wos-no">${esc(w.number)}</span><span class="chip stage">${esc(w.stage)}</span></div>
        <h3><a href="#/idea/${esc(w.ideaId)}">${esc(w.title)}</a></h3>
        <div class="meta"><span>담당: ${esc(w.org || '미정')}</span><span>${fmtDate(w.createdAt)} 등재</span></div>
        ${isOperator() ? `
        <form class="row wos-edit" data-id="${esc(w.id)}">
          <input name="org" placeholder="담당 조직" value="${esc(w.org || '')}">
          <select name="stage">${CONFIG.wosStages.map((s) => `<option ${s === w.stage ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select>
          <button class="btn ghost sm">저장</button>
        </form>` : ''}
      </div>`).join('')}</div>` : '<div class="empty">아직 등재된 WOS가 없습니다. 첫 심의는 ' + fmtShort(parseDate(CONFIG.reviewDates[0])) + '입니다.</div>'}`;
  $$('.wos-edit').forEach((f) => f.onsubmit = (e) => {
    e.preventDefault();
    busy(e.submitter, async () => { await store.update('wos', f.dataset.id, { org: f.org.value.trim(), stage: f.stage.value }); toast('저장했습니다'); });
  });
}

// ───────────── 내 활동 ─────────────

async function mePage() {
  user = (await store.refreshUser()) || user;
  const owned = await store.list('ideaOwners', [['uid', '==', user.uid]]);
  const myIdeas = (await Promise.all(owned.map((o) => store.get('ideas', o.id)))).filter(Boolean).sort((a, b) => b.createdAt - a.createdAt);
  const rewards = (await store.list('rewards', [['uid', '==', user.uid]])).sort((a, b) => b.createdAt - a.createdAt);
  // 내 좋아요·댓글 (Firebase에서는 컬렉션 그룹 색인이 필요할 수 있음)
  const [myLikes, myComments] = await Promise.all([
    store.listGroup('likes', [['uid', '==', user.uid]]).catch((e) => { console.warn(e); return null; }),
    store.listGroup('comments', [['authorUid', '==', user.uid]]).catch((e) => { console.warn(e); return null; }),
  ]);
  const ideaIds = [...new Set([...(myLikes || []), ...(myComments || [])].map((x) => x.ideaId))];
  const titles = Object.fromEntries((await Promise.all(ideaIds.map((id) => store.get('ideas', id).catch(() => null)))).filter(Boolean).map((i) => [i.id, i.title]));

  const alerts = myIdeas.flatMap((i) => (i.history || []).map((h) => ({ i, h }))).sort((a, b) => b.h.at - a.h.at);

  main.innerHTML = `
    <section class="card profile">
      <div>
        <h2>${esc(user.name)}</h2>
        <p class="muted">${esc(user.dept)} · ${esc(user.type)} · ${esc(ROLES[user.role])}</p>
        <button class="link" id="edit-profile">내 정보 수정</button>
      </div>
      <div class="points"><span>누적 챌린지 포인트</span><b>${(user.points || 0).toLocaleString()}P</b></div>
    </section>

    <section class="card">
      <h3>🔔 심의 결과 알림</h3>
      ${alerts.length ? `<ul class="timeline">${alerts.map(({ i, h }) => `<li><a href="#/idea/${esc(i.id)}">${esc(i.title)}</a> → <b>${esc(h.label || DECISIONS[h.decision] || h.decision)}</b> <small>${fmtDate(h.at)}</small>${h.reason ? `<p>${esc(h.reason)}</p>` : ''}</li>`).join('')}</ul>` : '<p class="muted">아직 심의 결과가 없습니다.</p>'}
    </section>

    <section class="card">
      <h3>내가 올린 아이디어 ${myIdeas.length}</h3>
      ${myIdeas.length ? `<ul class="mylist">${myIdeas.map((i) => `<li><a href="#/idea/${esc(i.id)}">${esc(i.title)}</a>${statusChip(i.status)}${i.anonymous ? '<span class="chip">익명</span>' : ''}<small>❤️ ${i.likeCount || 0} · 💬 ${i.commentCount || 0}</small></li>`).join('')}</ul>` : '<p class="muted">아직 없습니다. <a href="#/new">아이디어 올리기 →</a></p>'}
    </section>

    <section class="card">
      <h3>보상 내역</h3>
      ${rewards.length ? `<table class="tbl"><thead><tr><th>날짜</th><th>종류</th><th>아이디어</th><th>내용</th></tr></thead><tbody>${rewards.map((r) => `<tr><td>${fmtDate(r.createdAt)}</td><td>${esc(REWARD_KINDS[r.kind] || r.kind)}</td><td>${esc(r.ideaTitle)}</td><td>${r.kind === 'point' ? `+${r.amount}P` : r.amount ? `${Number(r.amount).toLocaleString()}원` : esc(r.note || '금액 미정')}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">아이디어를 올리고 운영자 확인을 받으면 포인트가 쌓입니다.</p>'}
    </section>

    <section class="card">
      <h3>내 좋아요 · 댓글</h3>
      ${myLikes === null ? '<p class="muted">좋아요 내역을 불러오지 못했습니다.</p>' : ''}
      <ul class="mylist">
        ${(myLikes || []).map((l) => `<li>❤️ <a href="#/idea/${esc(l.ideaId)}">${esc(titles[l.ideaId] || '(삭제된 아이디어)')}</a><small>${ago(l.createdAt)}</small></li>`).join('')}
        ${(myComments || []).map((c) => `<li>💬 <a href="#/idea/${esc(c.ideaId)}">${esc(titles[c.ideaId] || '(삭제된 아이디어)')}</a> <span class="muted">${esc(c.text.slice(0, 40))}</span><small>${ago(c.createdAt)}</small></li>`).join('')}
      </ul>
      ${!(myLikes || []).length && !(myComments || []).length ? '<p class="muted">아직 없습니다.</p>' : ''}
    </section>`;
  $('#edit-profile').onclick = () => profilePage(false);
}

// ───────────── 심의 화면 ─────────────

let selectedRoundId = null;

async function reviewPage() {
  if (!isStaff()) { main.innerHTML = '<div class="card">운영자·추진위원만 볼 수 있습니다.</div>'; return; }
  const rounds = reviewRounds();
  const nr = nextRound();
  const nrIdx = rounds.findIndex((r) => r.id === nr.id);
  const shown = rounds.slice(Math.max(0, nrIdx - 4), nrIdx + 4);
  const round = rounds.find((r) => r.id === selectedRoundId) || nr;
  selectedRoundId = round.id;
  const cutoff = cutoffFor(round);

  const [ideas, review] = await Promise.all([store.list('ideas'), store.get('reviews', round.id)]);
  const byId = Object.fromEntries(ideas.map((i) => [i.id, i]));
  const agenda = (review?.agenda || []).map((id) => byId[id]).filter(Boolean);
  const scores = review?.scores || {};
  const decisions = review?.decisions || {};
  const eligible = ideas.filter((i) => i.status === 'pending' && !i.hidden && i.createdAt < cutoff && !(review?.agenda || []).includes(i.id));
  const toConfirm = ideas.filter((i) => i.status === 'collecting' && !i.hidden && Date.now() - i.createdAt >= CONFIG.cutoffDays * DAY);
  const tooNew = ideas.filter((i) => i.status === 'pending' && i.createdAt >= cutoff);

  const totalOf = (s) => CRITERIA.reduce((n, c) => n + (Number(s?.[c.key]) || 0), 0);
  const avgOf = (ideaId) => {
    const list = Object.values(scores[ideaId] || {});
    if (!list.length) return null;
    return Math.round((list.reduce((n, s) => n + totalOf(s), 0) / list.length) * 10) / 10;
  };

  main.innerHTML = `
    <h1 class="page-title">심의</h1>
    <div class="rounds">${shown.map((r) => `<button class="round ${r.id === round.id ? 'on' : ''}" data-id="${r.id}">${r.no}회차<br><b>${fmtShort(r.date)}</b>${r.id === nr.id ? '<small>다음 심의</small>' : ''}</button>`).join('')}</div>
    <p class="muted">${fmtShort(cutoff - DAY)}까지 등록되고 운영자 확인을 마친 아이디어(심의 대기)가 안건 대상입니다. 안건 목록은 심의 3일 전(${fmtShort(round.date - 3 * DAY)})에 위원에게 보냅니다.</p>

    ${isOperator() ? `
    <section class="card op">
      <h3>운영자: 안건 정리</h3>
      ${toConfirm.length ? `<h4>내용 확인이 필요한 아이디어 ${toConfirm.length}건 <small class="muted">(의견 수렴 ${CONFIG.cutoffDays}일 경과)</small></h4>
        <ul class="mylist">${toConfirm.map((i) => `<li><a href="#/idea/${esc(i.id)}">${esc(i.title)}</a><small>❤️ ${i.likeCount || 0} · ${fmtDate(i.createdAt)}</small><button class="btn ghost sm confirm" data-id="${esc(i.id)}">확인 → 심의 대기</button></li>`).join('')}</ul>` : ''}
      <h4>안건에 넣을 수 있는 아이디어 ${eligible.length}건</h4>
      ${eligible.length ? `<ul class="mylist">${eligible.map((i) => `<li><label class="inline"><input type="checkbox" class="pick" value="${esc(i.id)}" checked> ${esc(i.title)}</label>${i.resubmitted ? '<span class="chip">재상정</span>' : ''}<small>❤️ ${i.likeCount || 0} · 💬 ${i.commentCount || 0}</small></li>`).join('')}</ul>
        <button class="btn primary" id="add-agenda">선택한 아이디어로 안건 묶음 만들기</button>` : '<p class="muted">추가할 아이디어가 없습니다.</p>'}
      ${tooNew.length ? `<p class="muted">※ 심의 대기지만 등록일이 늦어 다음 회차로 넘어가는 아이디어 ${tooNew.length}건</p>` : ''}
    </section>` : ''}

    <section>
      <h2 class="sec">${round.no}회차 안건 ${agenda.length}건 ${agenda.length ? '<button class="btn ghost sm" id="export">회의록 내보내기(CSV)</button>' : ''}</h2>
      ${agenda.length ? agenda.map((i, n) => {
        const my = scores[i.id]?.[user.uid] || {};
        const dec = decisions[i.id];
        const avg = avgOf(i.id);
        const cnt = Object.keys(scores[i.id] || {}).length;
        const h = annualHours(i);
        return `
        <article class="card agenda" data-id="${esc(i.id)}">
          <div class="idea-top"><span class="agenda-no">안건 ${n + 1}</span>${statusChip(i.status)}<span class="chip cat">${esc(i.category)}</span>${i.samples?.length ? '<span class="chip sample">샘플 있음 (가산)</span>' : ''}</div>
          <h3><a href="#/idea/${esc(i.id)}" target="_blank">${esc(i.title)}</a></h3>
          <p class="muted">${esc(i.asis)} → ${esc(i.tobe)}</p>
          <div class="meta"><span>❤️ ${i.likeCount || 0}</span><span>💬 ${i.commentCount || 0}</span>${h ? `<span>연간 약 ${h.toLocaleString()}시간 절감</span>` : ''}<span>확산: ${esc(i.reusable || '모름')}</span></div>
          <form class="score-form">
            <div class="scores">${CRITERIA.map((c) => `<label title="${esc(c.hint)}">${esc(c.label)} <small>/${c.max}</small><input type="number" name="${c.key}" min="0" max="${c.max}" step="1" value="${esc(my[c.key] ?? '')}" ${dec ? 'disabled' : ''}></label>`).join('')}</div>
            <div class="score-foot"><span>내 점수 <b class="my-total">${totalOf(my)}</b>/100</span><span>위원 평균 <b>${avg ?? '-'}</b> (${cnt}명)</span>${dec ? '' : '<button class="btn ghost sm">내 점수 저장</button>'}</div>
          </form>
          ${dec ? `<div class="decision done">결정: <b>${esc(DECISIONS[dec.decision])}</b>${dec.wosNumber ? ` (${esc(dec.wosNumber)})` : ''} — ${esc(dec.reason)}</div>` : isOperator() ? `
          <form class="decision-form">
            <div class="row">${Object.entries(DECISIONS).map(([k, l]) => `<label class="inline"><input type="radio" name="decision" value="${k}" required> ${l}</label>`).join('')}</div>
            <textarea name="reason" rows="2" required placeholder="결정 사유 (사이트에 공개됩니다)"></textarea>
            <button class="btn primary sm">결정 저장</button>
          </form>` : '<p class="muted">결정은 회의 후 운영자가 기록합니다.</p>'}
        </article>`;
      }).join('') : '<div class="empty">아직 이 회차 안건이 없습니다.</div>'}
    </section>`;

  $$('.round').forEach((b) => b.onclick = () => { selectedRoundId = b.dataset.id; reviewPage(); });

  $$('.confirm').forEach((b) => b.onclick = () => busy(b, async () => {
    const i = byId[b.dataset.id];
    await confirmIdea(i, await ownerOf(i.id));
    toast(i.pointsAwarded ? '심의 대기로 넘겼습니다' : `심의 대기로 넘기고 ${CONFIG.pointsPerIdea}P를 지급했습니다`);
    reviewPage();
  }));

  $('#add-agenda')?.addEventListener('click', (e) => busy(e.target, async () => {
    const picked = $$('.pick:checked').map((x) => x.value);
    if (!picked.length) return;
    const agendaIds = [...(review?.agenda || []), ...picked];
    if (review) await store.update('reviews', round.id, { agenda: agendaIds, updatedAt: Date.now() });
    else await store.set('reviews', round.id, { roundNo: round.no, date: round.date, agenda: agendaIds, scores: {}, decisions: {}, createdAt: Date.now() });
    notifyN8n({ type: 'agenda', round: round.id, date: isoDate(round.date), ideas: agendaIds.map((id) => ({ id, title: byId[id]?.title })) });
    toast('안건 묶음을 만들었습니다');
    reviewPage();
  }));

  $$('.agenda').forEach((card) => {
    const ideaId = card.dataset.id;
    const sf = $('.score-form', card);
    sf.oninput = () => {
      const s = Object.fromEntries(CRITERIA.map((c) => [c.key, Number(sf[c.key].value) || 0]));
      $('.my-total', card).textContent = totalOf(s);
    };
    sf.onsubmit = (e) => {
      e.preventDefault();
      const s = {};
      for (const c of CRITERIA) {
        const n = Number(sf[c.key].value);
        if (sf[c.key].value === '' || !(n >= 0 && n <= c.max)) return alert(`${c.label}: 0~${c.max}점 사이로 입력해 주세요.`);
        s[c.key] = n;
      }
      busy(e.submitter, async () => {
        await store.update('reviews', round.id, { [`scores.${ideaId}.${user.uid}`]: { ...s, name: user.name, at: Date.now() } });
        toast('점수를 저장했습니다');
        reviewPage();
      });
    };
    const df = $('.decision-form', card);
    if (df) df.onsubmit = (e) => {
      e.preventDefault();
      const decision = df.decision.value;
      const reason = df.reason.value.trim();
      if (!decision || !reason) return alert('결정과 사유를 모두 입력해 주세요.');
      if (!confirm(`「${byId[ideaId].title}」을(를) '${DECISIONS[decision]}'(으)로 결정할까요? 결과와 사유가 공개됩니다.`)) return;
      busy(e.submitter, async () => {
        await saveDecision(round, byId[ideaId], decision, reason, avgOf(ideaId));
        toast('결정을 저장했습니다');
        reviewPage();
      });
    };
  });

  $('#export')?.addEventListener('click', () => {
    const rows = [['회차', '심의일', '안건', '제목', '분야', '제안자', '좋아요', '댓글', '연간 절감시간', '평균 점수', '평가 위원 수', ...CRITERIA.map((c) => `${c.label} 평균`), '결정', 'WOS 번호', '사유']];
    agenda.forEach((i, n) => {
      const list = Object.values(scores[i.id] || {});
      const critAvg = CRITERIA.map((c) => (list.length ? Math.round((list.reduce((s, x) => s + (Number(x[c.key]) || 0), 0) / list.length) * 10) / 10 : ''));
      const dec = decisions[i.id];
      rows.push([round.no, isoDate(round.date), n + 1, i.title, i.category, i.authorName, i.likeCount || 0, i.commentCount || 0, annualHours(i) ?? '', avgOf(i.id) ?? '', list.length, ...critAvg, dec ? DECISIONS[dec.decision] : '', dec?.wosNumber || '', dec?.reason || '']);
    });
    downloadCsv(`WOS심의_${round.no}회차_${isoDate(round.date)}.csv`, rows);
  });
}

async function saveDecision(round, idea, decision, reason, avg) {
  const now = Date.now();
  const ops = [];
  const entry = { decision, reason, at: now, round: round.id, roundDate: round.date, avg, by: user.name };
  const ideaPatch = { status: decision, decidedAt: now, resubmitted: false };
  const ownerUid = await ownerOf(idea.id);

  if (decision === 'listed' && !idea.wosNumber) {
    const counter = await store.get('meta', 'counters');
    const next = counter?.wosNext || CONFIG.wosStartNumber;
    const number = `WOS-${String(next).padStart(3, '0')}`;
    entry.wosNumber = number;
    ideaPatch.wosNumber = number;
    ops.push(
      { op: 'set', path: 'meta', id: 'counters', data: { ...(counter || {}), wosNext: next + 1 } },
      { op: 'set', path: 'wos', id: number, data: { number, ideaId: idea.id, title: idea.title, org: '', stage: CONFIG.wosStages[0], createdAt: now } },
    );
    if (ownerUid) {
      ops.push({ op: 'set', path: 'rewards', id: store.newId(), data: {
        uid: ownerUid, ideaId: idea.id, ideaTitle: idea.title, kind: 'prize', amount: CONFIG.prizeAmount,
        note: CONFIG.prizeAmount ? '' : '금액 미정', coProposers: idea.coProposers || [], createdAt: now,
      } });
    }
  }
  ideaPatch.history = [...(idea.history || []), entry];
  const { round: _r, ...decisionRecord } = entry;
  ops.push(
    { op: 'update', path: 'ideas', id: idea.id, data: ideaPatch },
    { op: 'update', path: 'reviews', id: round.id, data: { [`decisions.${idea.id}`]: decisionRecord } },
  );
  await store.batch(ops);
  notifyN8n({ type: 'decision', round: round.id, ideaId: idea.id, title: idea.title, decision, reason, wosNumber: entry.wosNumber || null, ownerUid });
}

// ───────────── 관리 ─────────────

async function adminPage() {
  if (user.role !== 'admin') { main.innerHTML = '<div class="card">관리자만 볼 수 있습니다.</div>'; return; }
  const users = (await store.list('users')).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  main.innerHTML = `
    <h1 class="page-title">관리</h1>
    <section class="card">
      <h3>역할 부여</h3>
      <input id="user-q" type="search" placeholder="이름·소속·이메일 검색">
      <table class="tbl" id="users"><thead><tr><th>이름</th><th>소속</th><th>포인트</th><th>역할</th></tr></thead><tbody>
      ${users.map((u) => `<tr data-s="${esc(`${u.name} ${u.dept} ${u.email}`.toLowerCase())}"><td>${esc(u.name)}<br><small class="muted">${esc(u.email)}</small></td><td>${esc(u.dept)} ${esc(u.type)}</td><td>${u.points || 0}P</td>
        <td><select class="role" data-uid="${esc(u.id)}" ${u.id === user.uid ? 'disabled title="본인 역할은 바꿀 수 없습니다"' : ''}>${Object.entries(ROLES).map(([k, v]) => `<option value="${k}" ${u.role === k ? 'selected' : ''}>${v}</option>`).join('')}</select></td></tr>`).join('')}
      </tbody></table>
    </section>
    <section class="card">
      <h3>분야·일정·보상 설정</h3>
      <p class="muted">분야 목록, 심의 일정, 포인트·포상금 금액은 <code>config.js</code> 파일에서 바꿉니다.</p>
      <ul class="mylist"><li>분야: ${CONFIG.categories.map(esc).join(', ')}</li><li>심의일: ${CONFIG.reviewDates.map((d) => fmtShort(parseDate(d))).join(', ')} 이후 격주</li><li>제안 포인트: ${CONFIG.pointsPerIdea}P · 채택 포상금: ${CONFIG.prizeAmount ? CONFIG.prizeAmount.toLocaleString() + '원' : '미정'}</li></ul>
    </section>`;
  $('#user-q').oninput = (e) => { const q = e.target.value.toLowerCase(); $$('#users tbody tr').forEach((tr) => { tr.hidden = !tr.dataset.s.includes(q); }); };
  $$('.role').forEach((s) => s.onchange = () => busy(s, async () => { await store.update('users', s.dataset.uid, { role: s.value }); toast('역할을 바꿨습니다'); }));
}

// ───────────── 시작 ─────────────

(async function start() {
  store = await createStore();
  document.addEventListener('click', (e) => {
    if (e.target.id === 'logout') store.signOut();
  });
  window.addEventListener('hashchange', render);
  store.onAuth((u) => { user = u; render(); });
})();
