// WOS 아이디어 뱅크 설정 파일
// 운영에 필요한 값은 대부분 이 파일만 고치면 됩니다.

export const CONFIG = {
  // Firebase 프로젝트 설정. 비워 두면(null) 브라우저에만 저장되는 "체험 모드"로 동작합니다.
  // Firebase 콘솔 → 프로젝트 설정 → 내 앱(웹)에서 복사해 붙여 넣으세요.
  // firebase: {
  //   apiKey: '...',
  //   authDomain: '...firebaseapp.com',
  //   projectId: '...',
  //   storageBucket: '...appspot.com',
  //   messagingSenderId: '...',
  //   appId: '...',
  // },
  firebase: null,

  // 로그인 허용 도메인 (학교 구글 계정)
  allowedDomain: 'wsu.ac.kr',

  // 격주 목요일 심의 일정. 마지막 날짜 이후에는 reviewIntervalDays 간격으로 자동 계산합니다.
  reviewDates: ['2026-11-05', '2026-11-19', '2026-12-03', '2026-12-17'],
  reviewIntervalDays: 14,

  // 심의일 며칠 전까지 등록한 아이디어를 안건에 올릴지 (의견 수렴 최소 기간)
  cutoffDays: 7,

  // 보상 (아직 확정 전: 결정되면 숫자만 바꾸세요)
  pointsPerIdea: 10,   // 제안 1건당 챌린지 포인트
  prizeAmount: 0,      // 정규 WOS 채택 포상금(원). 0이면 "금액 미정"으로 기록

  // 정규 WOS 번호 시작값 (WOS-006부터)
  wosStartNumber: 6,

  categories: ['학사', '수업', '학생지원', '행정', '연구', '기타'],
  targetUsers: ['학생', '조교', '교원', '직원'],
  wosStages: ['실행계획서 작성', '예산 배정', '개발', '실증', '확산', '완료'],

  // n8n 웹훅 주소 (선택). 심의 결정 시 결과를 POST로 보냅니다.
  n8nWebhook: '',
};
