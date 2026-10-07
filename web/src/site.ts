// 사이트 연락처·회사 정보. 정해지면 여기만 채우면 홈페이지·상담 신청·결과 화면에 한꺼번에 반영된다.
// 빈 값('')인 항목은 화면에서 감춘다(미완성 칸이 보이지 않게).
export const SITE = {
  name: '모심듀오',
  /** 상담 신청을 받을 구글 Apps Script 웹 앱 주소 (docs/CONSULT_SHEET_SETUP.md). 비어 있으면 신청서는 '준비 중' 안내만 한다 */
  consultEndpoint: 'https://script.google.com/macros/s/AKfycbw36goo6zLfv-rTFQmhSQGSJZGg42QYGTZJkjJngdd1VtbF46DPVd89jiMdC2sO9KMB/exec',
  /** 이메일 자료 요청·현재 답변 저장용 Apps Script 웹 앱 */
  deliveryEndpoint: 'https://script.google.com/macros/s/AKfycbw36goo6zLfv-rTFQmhSQGSJZGg42QYGTZJkjJngdd1VtbF46DPVd89jiMdC2sO9KMB/exec',
  /** 카카오톡 채널 채팅 주소 (예: https://pf.kakao.com/_xxxx/chat) */
  kakaoUrl: '',
  /** 대표 전화번호 (예: 031-000-0000) */
  phone: '031-344-8924',
  /** 직접 상담·회신에 사용할 휴대전화 */
  consultPhone: '010-6428-8020',
  /** 운영 연락 이메일. 실제 발송에는 별도 계정 권한 연결이 필요하다. */
  email: 'ysyh17301730@gmail.com',
  hours: '오전 10시~오후 7시',
  promise: '운영 시간에는 보통 2~3시간 안에, 늦어도 24시간 안에 연락드려요.',
  company: {
    name: '모심듀오',
    ceo: '',
    bizNo: '',
    address: '',
  },
  /** 상담 신청 정보 보관 기간 (개인정보처리방침과 맞출 것) */
  retention: '상담 종료 후 6개월',
};

export const telHref = (p: string) => `tel:${p.replace(/[^0-9+]/g, '')}`;

/** 운영 주체와 보관 안내까지 준비된 경우에만 연락처를 받는다. */
export const consultReady = () => Boolean(SITE.consultEndpoint && SITE.retention && SITE.company.name);

/** 개발 미리보기는 신청 흐름만 보여 주며, 전송·저장하지 않는다. */
export const consultMode = (localPreview = import.meta.env.DEV): 'live' | 'preview' | 'closed' => consultReady() ? 'live' : localPreview ? 'preview' : 'closed';
