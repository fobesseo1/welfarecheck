/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 네이버 지도 Client ID (브라우저 노출 가능, 등록 도메인에서만 작동) */
  readonly NEXT_PUBLIC_NAVER_MAP_CLIENT_ID?: string;
}
