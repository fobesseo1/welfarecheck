import { expect, test } from 'vitest';
import { kb } from '../src/data.ts';
import { currentAnswers, recommendedGuides, deliveryErrors } from '../src/engine/delivery.ts';
test('숨겨진 옛 답과 내부 계산 값은 전송하지 않는다',()=>{
 const snapshot=currentAnswers(kb,{age:'over65',disease:'dementia',dementia:'none',grade:'none',notice_date:'2026-01-01','PHY-01':'3'});
 expect(snapshot).toEqual({age:'over65',dementia:'none',grade:'none'});
});
test('판정 대기와 등급 없는 상황에 맞는 자료를 제안한다',()=>{
 expect(recommendedGuides({grade:'pending'})).toEqual(['04','07']);
 expect(recommendedGuides({age:'under65',disease:'none'})).toEqual(['07']);
 expect(recommendedGuides({grade:'none'})).toEqual(['01']);
});
test('자료만 요청해도 전화번호와 이메일·필수 동의가 필요하다',()=>{
 const form={email:'guardian@example.com',phone:'010-1234-5678',guides:['01'],privacy:true,sensitive:false,marketing:false,consult:false};
 expect(deliveryErrors(form)).toEqual([]);
 expect(deliveryErrors({...form,phone:''})).toContain('휴대전화 번호를 확인해 주세요.');
 expect(deliveryErrors({...form,email:'a@example.com,b@example.com'})).not.toEqual([]);
 expect(deliveryErrors({...form,privacy:false})).not.toEqual([]);
 expect(deliveryErrors({...form,guides:['01','02','03']})).not.toEqual([]);
});
