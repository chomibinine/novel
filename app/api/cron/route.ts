import { NextResponse } from 'next/server';
import crypto from 'crypto';

// 쿠팡 API용 시간 포맷팅 함수 (YYMMDDTHHMMSSZ 형식)
function getCoupangDate() {
  const now = new Date();
  const pad = (n: number) => (n < 10 ? '0' + n : n);
  const yy = String(now.getUTCFullYear()).slice(-2);
  const mm = pad(now.getUTCMonth() + 1);
  const dd = pad(now.getUTCDate());
  const hh = pad(now.getUTCHours());
  const min = pad(now.getUTCMinutes());
  const ss = pad(now.getUTCSeconds());
  return `${yy}${mm}${dd}T${hh}${min}${ss}Z`;
}

export async function GET(request: Request) {
  // 1. 보안 설정: Vercel Cron 요청 확인
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  try {
    // 2. 환경변수 불러오기
    const ACCESS_KEY = process.env.COUPANG_ACCESS_KEY || '';
    const SECRET_KEY = process.env.COUPANG_SECRET_KEY || '';
    const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
    const CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';

    if (!ACCESS_KEY || !SECRET_KEY || !TELEGRAM_TOKEN || !CHAT_ID) {
      throw new Error('필수 환경변수가 누락되었습니다.');
    }

    // 3. 쿠팡 API 설정 (검색어 '노트북', 3개만 추출)
    const DOMAIN = "https://api-gateway.coupang.com";
    const METHOD = "GET";
    const keyword = encodeURIComponent("노트북");
    const urlPath = `/v2/providers/affiliate_open_api/apis/openapi/products/search?keyword=${keyword}&limit=3`;

    // 4. HMAC 서명(Signature) 생성 로직
    const datetime = getCoupangDate();
    const message = datetime + METHOD + urlPath;
    const signature = crypto.createHmac('sha256', SECRET_KEY).update(message).digest('hex');
    const authorization = `CEA algorithm=HmacSHA256, access-key=${ACCESS_KEY}, signed-date=${datetime}, signature=${signature}`;

    // 5. 쿠팡 데이터 Fetch
    const coupangRes = await fetch(DOMAIN + urlPath, {
      method: METHOD,
      headers: {
        "Authorization": authorization,
        "Content-Type": "application/json"
      }
    });

    if (!coupangRes.ok) {
      const errorData = await coupangRes.text();
      throw new Error(`쿠팡 API 에러: ${coupangRes.status} ${errorData}`);
    }

    const coupangData = await coupangRes.json();
    const products = coupangData.data.productData || [];

    // 6. 텔레그램 메시지 포맷팅 (Markdown 에러 방지를 위해 HTML 모드 사용 권장)
    let messageText = "🚀 <b>[쿠팡 인기상품 알림]</b>\n\n";
    products.forEach((item: any, index: number) => {
      // 상품명에 들어있는 <, >, & 등을 치환하여 HTML 파싱 에러 방지
      const safeName = item.productName
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

      // item.productUrl은 파트너스 코드가 포함된 수익화 링크
      messageText += `${index + 1}. <a href="${item.productUrl}">${safeName}</a>\n`;
      messageText += `💰 가격: ${item.productPrice.toLocaleString()}원\n\n`;
    });

    // 7. 텔레그램 전송
    const telegramUrl = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
    const tgRes = await fetch(telegramUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        text: messageText,
        parse_mode: 'HTML', // Markdown 대신 HTML 사용
        disable_web_page_preview: false // 썸네일 노출 여부
      })
    });

    if (!tgRes.ok) {
      const tgError = await tgRes.text();
      throw new Error(`텔레그램 전송 에러: ${tgError}`);
    }

    return NextResponse.json({ success: true, message: '알림 전송 완료' });
  } catch (error: any) {
    console.error('크론 작업 중 오류 발생:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}