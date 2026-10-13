// 저장소 선택: Firebase 설정이 있으면 Firebase, 없으면 체험 모드(브라우저 저장)
//
// 두 저장소는 같은 함수를 제공합니다.
//   onAuth(cb), signIn(uid?), signOut(), saveProfile(patch)
//   list(path, where?), listGroup(name, where?), get(path, id)
//   set(path, id, data), update(path, id, patch), batch(ops), newId()
//   inc(n), uploadFile(file, folder)
// batch ops: { op: 'set' | 'update' | 'delete', path, id, data }

import { CONFIG } from './config.js';

export async function createStore() {
  if (CONFIG.firebase && CONFIG.firebase.apiKey) {
    const m = await import('./store-firebase.js');
    return m.create(CONFIG);
  }
  const m = await import('./store-local.js');
  return m.create(CONFIG);
}
