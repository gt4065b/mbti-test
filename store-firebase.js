// Firebase 저장소: 학교 구글 계정 로그인 + Firestore + Storage

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut as fbSignOut,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  getFirestore, collection, collectionGroup, doc, getDoc, getDocs, setDoc, updateDoc,
  writeBatch, query, where as fbWhere, increment,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js';

export function create(config) {
  const app = initializeApp(config.firebase);
  const auth = getAuth(app);
  const db = getFirestore(app);
  const storage = getStorage(app);
  const domainOk = (email) => typeof email === 'string' && email.toLowerCase().endsWith('@' + config.allowedDomain);

  const q = (base, where) => (where && where.length ? query(base, ...where.map(([f, op, v]) => fbWhere(f, op, v))) : base);
  const toList = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  // 컬렉션 그룹 조회는 상위 아이디어 번호(ideaId)를 함께 돌려줌
  const toGroupList = (snap) => snap.docs.map((d) => ({ ...d.data(), id: d.id, ideaId: d.ref.parent.parent?.id }));

  async function loadUser(fbUser) {
    const r = doc(db, 'users', fbUser.uid);
    let s = await getDoc(r);
    if (!s.exists()) {
      await setDoc(r, {
        name: fbUser.displayName || fbUser.email.split('@')[0], email: fbUser.email,
        dept: '', type: '', role: 'member', points: 0, createdAt: Date.now(),
      });
      s = await getDoc(r);
    }
    return { uid: fbUser.uid, ...s.data() };
  }

  return {
    mode: 'firebase',
    onAuth(cb) {
      onAuthStateChanged(auth, async (fbUser) => {
        if (!fbUser) return cb(null);
        if (!domainOk(fbUser.email)) {
          await fbSignOut(auth);
          alert(`@${config.allowedDomain} 학교 계정으로만 로그인할 수 있습니다.`);
          return cb(null);
        }
        try { cb(await loadUser(fbUser)); } catch (e) { console.error(e); alert('사용자 정보를 불러오지 못했습니다: ' + e.message); cb(null); }
      });
    },
    async signIn() {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ hd: config.allowedDomain, prompt: 'select_account' });
      await signInWithPopup(auth, provider);
    },
    signOut: () => fbSignOut(auth),
    async saveProfile(patch) {
      const uid = auth.currentUser.uid;
      await updateDoc(doc(db, 'users', uid), { ...patch, updatedAt: Date.now() });
      return loadUser(auth.currentUser);
    },
    refreshUser: () => (auth.currentUser ? loadUser(auth.currentUser) : null),
    async list(path, where) { return toList(await getDocs(q(collection(db, path), where))); },
    async listGroup(name, where) { return toGroupList(await getDocs(q(collectionGroup(db, name), where))); },
    async get(path, id) {
      const s = await getDoc(doc(db, path, id));
      return s.exists() ? { id: s.id, ...s.data() } : null;
    },
    set: (path, id, data) => setDoc(doc(db, path, id), data),
    update: (path, id, data) => updateDoc(doc(db, path, id), data),
    async batch(ops) {
      const b = writeBatch(db);
      for (const { op, path, id, data } of ops) {
        const r = doc(db, path, id);
        if (op === 'set') b.set(r, data);
        else if (op === 'update') b.update(r, data);
        else if (op === 'delete') b.delete(r);
      }
      await b.commit();
    },
    newId: () => doc(collection(db, '_ids')).id,
    inc: (n) => increment(n),
    async uploadFile(file, folder) {
      const path = `${folder}/${Date.now()}_${file.name.replace(/[^\w.\-가-힣]/g, '_')}`;
      const r = ref(storage, path);
      await uploadBytes(r, file, { contentType: file.type });
      return { name: file.name, size: file.size, type: file.type, url: await getDownloadURL(r), path };
    },
  };
}
