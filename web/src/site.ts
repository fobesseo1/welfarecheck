// 사이트 연락처·회사 정보. 정해지면 여기만 채우면 홈페이지·상담 신청·결과 화면에 한꺼번에 반영된다.
// 빈 값('')인 항목은 화면에서 감춘다(미완성 칸이 보이지 않게).
export const SITE = {
  name: '모심듀오',
  /** 상담 신청을 받을 구글 Apps Script 웹 앱 주소 (docs/CONSULT_SHEET_SETUP.md). 비어 있으면 신청서는 '준비 중' 안내만 한다 */
  consultEndpoint: '',
  /** 카카오톡 채널 채팅 주소 (예: https://pf.kakao.com/_xxxx/chat) */
  kakaoUrl: '',
  /** 대표 전화번호 (예: 031-000-0000) */
  phone: '',
  hours: '오전 10시~오후 7시',
  promise: '운영 시간에는 보통 2~3시간 안에, 늦어도 24시간 안에 연락드려요.',
  regions: ['서울', '경기', '인천', '그 밖의 지역'],
  company: {
    name: '',
    ceo: '',
    bizNo: '',
    address: '',
  },
  /** 상담 신청 정보 보관 기간 (개인정보처리방침과 맞출 것) */
  retention: '',
};

export const telHref = (p: string) => `tel:${p.replace(/[^0-9+]/g, '')}`;
