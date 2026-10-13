// 체험 모드 저장소: 모든 데이터를 이 브라우저(localStorage)에만 저장합니다.
// Firebase를 연결하기 전에 화면과 흐름을 시험해 보는 용도입니다.

import { t } from './i18n.js';

const DB_KEY = 'wos-demo-db-v1';
const UID_KEY = 'wos-demo-uid';
const DAY = 86400000;

class Inc { constructor(n) { this.n = n; } }

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

function applyPatch(obj, patch, dotted) {
  for (const [key, val] of Object.entries(patch)) {
    const parts = dotted ? key.split('.') : [key];
    let o = obj;
    for (const p of parts.slice(0, -1)) {
      if (typeof o[p] !== 'object' || o[p] === null) o[p] = {};
      o = o[p];
    }
    const last = parts[parts.length - 1];
    if (val instanceof Inc) o[last] = (Number(o[last]) || 0) + val.n;
    else o[last] = clone(val);
  }
}

function matches(doc, where) {
  return (where || []).every(([field, op, val]) => {
    const v = doc[field];
    if (op === '==') return v === val;
    if (op === 'in') return val.includes(v);
    if (op === 'array-contains') return Array.isArray(v) && v.includes(val);
    throw new Error('지원하지 않는 조건: ' + op);
  });
}

function seed() {
  const now = Date.now();
  const users = {
    u1: { name: '김교원', email: 'prof.kim@wsu.ac.kr', dept: 'AI경영학과', type: '교원', role: 'member', points: 10 },
    u2: { name: '이직원', email: 'staff.lee@wsu.ac.kr', dept: '학사지원팀', type: '직원', role: 'member', points: 0 },
    u3: { name: '박운영', email: 'op.park@wsu.ac.kr', dept: 'AI혁신센터', type: '직원', role: 'operator', points: 0 },
    u4: { name: '최위원', email: 'cm.choi@wsu.ac.kr', dept: '경영학부', type: '교원', role: 'committee', points: 0 },
    u5: { name: '정관리', email: 'admin.jung@wsu.ac.kr', dept: 'AI혁신센터', type: '직원', role: 'admin', points: 0 },
  };
  const base = { samples: [], targets: [], attachments: [], coProposers: [], history: [], hidden: false, reusable: '모름' };
  const ideas = {
    i1: { ...base, title: '휴강·복학 문의 자동 응답', asis: '학기마다 조교가 같은 문의에 일일이 답함', tobe: 'FAQ는 자동 답변, 나머지만 담당자 연결',
      category: '학사', anonymous: false, ownerUid: 'u1', authorName: '김교원', authorDept: 'AI경영학과',
      samples: ['https://example.com/faq-bot'], targets: ['학생', '조교'], freqCount: 20, freqUnit: 'week', minutes: 10, reusable: '예',
      status: 'pending', pointsAwarded: true, likeCount: 3, commentCount: 2, createdAt: now - 12 * DAY },
    i2: { ...base, title: '출장 정산 서류 자동 작성', asis: '영수증을 보고 엑셀 양식에 손으로 옮겨 적음', tobe: '영수증 사진을 올리면 정산서 초안이 만들어짐',
      category: '행정', anonymous: true, ownerUid: null, authorName: '익명 제안자', authorDept: '',
      targets: ['교원', '직원'], freqCount: 15, freqUnit: 'month', minutes: 30, reusable: '예',
      status: 'collecting', likeCount: 2, commentCount: 1, createdAt: now - 9 * DAY },
    i3: { ...base, title: '강의계획서 형식 검토 도우미', asis: '학과 사무실에서 강의계획서 누락 항목을 하나씩 확인', tobe: '업로드하면 빠진 항목과 형식 오류를 표시',
      category: '수업', anonymous: false, ownerUid: 'u2', authorName: '이직원', authorDept: '학사지원팀',
      targets: ['교원', '직원'], freqCount: 2, freqUnit: 'week', minutes: 60, reusable: '모름',
      status: 'collecting', likeCount: 1, commentCount: 0, createdAt: now - 2 * DAY },
  };
  const ideaOwners = { i1: { uid: 'u1' }, i2: { uid: 'u2' }, i3: { uid: 'u2' } };
  return {
    users, ideas, ideaOwners,
    'ideas/i1/likes': { u2: { uid: 'u2', createdAt: now - 10 * DAY }, u3: { uid: 'u3', createdAt: now - 9 * DAY }, u4: { uid: 'u4', createdAt: now - 8 * DAY } },
    'ideas/i2/likes': { u1: { uid: 'u1', createdAt: now - 8 * DAY }, u4: { uid: 'u4', createdAt: now - 7 * DAY } },
    'ideas/i3/likes': { u1: { uid: 'u1', createdAt: now - DAY } },
    'ideas/i1/comments': {
      c1: { authorUid: 'u2', authorName: '이직원', text: '학사지원팀도 매 학기 같은 문의를 받습니다. 꼭 필요해요!', parentId: null, createdAt: now - 10 * DAY },
      c2: { authorUid: 'u1', authorName: '김교원', byProposer: true, text: '감사합니다. 학사지원팀 FAQ도 함께 넣어 보겠습니다.', parentId: 'c1', createdAt: now - 9 * DAY },
    },
    'ideas/i2/comments': {
      c3: { authorUid: 'u1', authorName: '김교원', text: '법인카드 내역과도 연결되면 좋겠습니다.', parentId: null, createdAt: now - 8 * DAY },
    },
    rewards: { r1: { uid: 'u1', ideaId: 'i1', ideaTitle: '휴강·복학 문의 자동 응답', kind: 'point', amount: 10, createdAt: now - 5 * DAY } },
  };
}

export function create() {
  let db;
  try { db = JSON.parse(localStorage.getItem(DB_KEY)); } catch { db = null; }
  if (!db) db = seed();
  const save = () => { try { localStorage.setItem(DB_KEY, JSON.stringify(db)); } catch (e) { alert(t('브라우저 저장 공간이 가득 찼습니다. 첨부 파일을 줄여 주세요.')); throw e; } };
  save();

  let authCb = () => {};
  const currentUser = () => {
    let uid = null;
    try { uid = localStorage.getItem(UID_KEY); } catch { /* 저장소 사용 불가 */ }
    const u = uid && db.users[uid];
    return u ? { uid, ...clone(u) } : null;
  };
  const coll = (path) => (db[path] ||= {});

  function applyOp({ op, path, id, data }) {
    const c = coll(path);
    if (op === 'set') { c[id] = {}; applyPatch(c[id], data, false); }
    else if (op === 'update') {
      if (!c[id]) throw new Error(`문서가 없습니다: ${path}/${id}`);
      applyPatch(c[id], data, true);
    } else if (op === 'delete') delete c[id];
  }

  return {
    mode: 'demo',
    demoUsers: () => Object.entries(db.users).map(([uid, u]) => ({ uid, ...clone(u) })),
    resetDemo() { db = seed(); save(); },
    onAuth(cb) { authCb = cb; cb(currentUser()); },
    async signIn(uid) { localStorage.setItem(UID_KEY, uid); authCb(currentUser()); },
    async signOut() { localStorage.removeItem(UID_KEY); authCb(null); },
    async saveProfile(patch) {
      const u = currentUser();
      applyOp({ op: 'update', path: 'users', id: u.uid, data: patch }); save();
      return currentUser();
    },
    async refreshUser() { return currentUser(); },
    async list(path, where) {
      return Object.entries(coll(path)).map(([id, d]) => ({ id, ...clone(d) })).filter((d) => matches(d, where));
    },
    async listGroup(name, where) {
      const out = [];
      for (const path of Object.keys(db)) {
        if (!path.endsWith('/' + name)) continue;
        const ideaId = path.split('/')[1];
        for (const [id, d] of Object.entries(db[path])) out.push({ ...clone(d), id, ideaId });
      }
      return out.filter((d) => matches(d, where));
    },
    async get(path, id) { const d = coll(path)[id]; return d ? { id, ...clone(d) } : null; },
    async set(path, id, data) { applyOp({ op: 'set', path, id, data }); save(); },
    async update(path, id, data) { applyOp({ op: 'update', path, id, data }); save(); },
    async batch(ops) {
      const backup = clone(db);
      try { ops.forEach(applyOp); save(); } catch (e) { db = backup; throw e; }
    },
    newId: () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36),
    inc: (n) => new Inc(n),
    async uploadFile(file) {
      // 체험 모드는 저장 공간이 작아 1MB 이하 파일만 내용까지 보관합니다.
      if (file.size > 1024 * 1024) return { name: file.name, size: file.size, type: file.type, url: null };
      const url = await new Promise((res, rej) => {
        const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file);
      });
      return { name: file.name, size: file.size, type: file.type, url };
    },
  };
}
