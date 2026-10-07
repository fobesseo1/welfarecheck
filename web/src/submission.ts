// Apps Script의 불투명 POST 응답 대신 개인정보 없는 접수 ID로 저장 결과를 확인한다.
export interface Receipt { ok: boolean; request_id: string; pending?: boolean }
export const requestId = () => crypto.randomUUID();

export function readReceipt(endpoint: string, id: string): Promise<Receipt> {
  return new Promise((resolve, reject) => {
    const name = `mosimReceipt_${id.replace(/-/g, '')}`;
    const callbacks = window as unknown as Record<string, unknown>;
    const script = document.createElement('script');
    const cleanup = () => { clearTimeout(timer); script.remove(); delete callbacks[name]; };
    const timer = setTimeout(() => { cleanup(); reject(new Error('receipt-timeout')); }, 15000);
    callbacks[name] = (value: Receipt) => { cleanup(); resolve(value); };
    script.onerror = () => { cleanup(); reject(new Error('receipt-unavailable')); };
    const url = new URL(endpoint);
    url.searchParams.set('request_id', id);
    url.searchParams.set('callback', name);
    script.src = url.href;
    document.head.appendChild(script);
  });
}

export async function sendWithReceipt(endpoint: string, payload: object, id: string, getReceipt = readReceipt, fetcher: typeof fetch = fetch): Promise<void> {
  // 재시도 시 저장 여부를 먼저 확인해 중복 요청을 피한다.
  try { const existing = await getReceipt(endpoint, id); if (existing.ok && existing.request_id === id) return; } catch { /* 최초 전송은 진행 */ }
  await fetcher(endpoint, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ ...payload, request_id: id }) });
  for (let attempt = 0; attempt < 3; attempt++) {
    const receipt = await getReceipt(endpoint, id);
    if (receipt.request_id !== id) throw new Error('receipt-mismatch');
    if (receipt.ok) return;
    if (!receipt.pending) throw new Error('receipt-rejected');
    if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 600));
  }
  throw new Error('receipt-unconfirmed');
}
