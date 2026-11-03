import { describe, expect, it } from 'vitest';
// @ts-expect-error 의존성 없는 수집 스크립트(.mjs)라 타입 선언이 없다
import { parseXml, serviceOf, primaryKind, isDementiaUnit, phoneOf, utmkToWgs84, coordQuery } from '../../tools/facilities/lib.mjs';

// 응답 예시는 docs/api-specs/guide_nhis_ltc_detail.txt (공단 활용가이드) 그대로
const ACCEPT_XML = `<response><header><resultCode>00</resultCode><resultMsg>NORMAL SERVICE.</resultMsg></header>
<body><item><adminPttnCd>A03</adminPttnCd><fmNowPer>102</fmNowPer><fmRsvPer>96</fmRsvPer>
<longTermAdminSym>11156000023</longTermAdminSym><maNowPer>16</maNowPer><maRsvPer>99</maRsvPer><totPer>118</totPer></item></body></response>`;

const GATEWAY_ERROR = `<OpenAPI_ServiceResponse><cmmMsgHeader><errMsg>SERVICE ERROR</errMsg>
<returnAuthMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</returnAuthMsg><returnReasonCode>30</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>`;

describe('기관 수집 공통 함수', () => {
  it('공단 응답 XML 의 item 을 읽는다', () => {
    const r = parseXml(ACCEPT_XML);
    expect(r.code).toBe('00');
    expect(r.items).toEqual([{ adminPttnCd: 'A03', fmNowPer: '102', fmRsvPer: '96', longTermAdminSym: '11156000023', maNowPer: '16', maRsvPer: '99', totPer: '118' }]);
  });

  it('게이트웨이 인증 오류 코드를 읽는다', () => {
    const r = parseXml(GATEWAY_ERROR);
    expect(r.code).toBe('30');
    expect(r.msg).toBe('SERVICE_KEY_IS_NOT_REGISTERED_ERROR');
    expect(r.items).toEqual([]);
  });

  it('기관유형코드를 서비스 종류로 바꾼다', () => {
    expect(serviceOf('A03')).toBe('nursing_home');
    expect(serviceOf('A04')).toBe('nursing_home');
    expect(serviceOf('B03')).toBe('day_care');
    expect(serviceOf('C01')).toBe('home_care');
    expect(serviceOf('C04')).toBe('short_stay');
    expect(serviceOf('C06')).toBe('welfare_tool');
    expect(serviceOf('G31')).toBeNull();
    expect(isDementiaUnit('G31')).toBe(true);
    expect(isDementiaUnit('H40')).toBe(true);
    expect(isDementiaUnit('A03')).toBe(false);
  });

  it('여러 서비스를 하는 기관은 입소시설 > 주야간 > 방문 순으로 대표 종류를 고른다', () => {
    expect(primaryKind(['home_care', 'day_care'])).toBe('day_care');
    expect(primaryKind(['home_care', 'nursing_home'])).toBe('nursing_home');
    expect(primaryKind([])).toBeNull();
  });

  it('UTM-K 좌표를 위경도로 바꾼다 (원점·서울시청)', () => {
    const o = utmkToWgs84(1000000, 2000000);
    expect(o.lat).toBeCloseTo(38, 6);
    expect(o.lng).toBeCloseTo(127.5, 6);
    const c = utmkToWgs84(953897, 1952034);
    expect(c.lat).toBeCloseTo(37.5665, 3);
    expect(c.lng).toBeCloseTo(126.978, 3);
  });

  it('공단 일반현황으로 좌표 API 요청값을 만든다', () => {
    const g = { siDoCd: '11', siGunGuCd: '290', BDongCd: '104', riCd: '00', roadNmCd: '113504130419', gunmulMlno: '31', gunmulSlno: '0' };
    expect(coordQuery(g)).toEqual({ admCd: '1129010400', rnMgtSn: '113504130419', udrtYn: '0', buldMnnm: '31', buldSlno: '0' });
    expect(coordQuery({ ...g, roadNmCd: undefined })).toBeNull();
    expect(coordQuery(undefined)).toBeNull();
  });

  it('나뉜 전화번호를 합친다', () => {
    expect(phoneOf({ locTelNo_1: '02', locTelNo_2: '980', locTelNo_3: '3004' })).toBe('02-980-3004');
    expect(phoneOf({})).toBeNull();
  });
});
