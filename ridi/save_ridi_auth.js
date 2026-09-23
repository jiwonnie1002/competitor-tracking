/**
 * save_ridi_auth.js
 * 리디북스 로그인 세션을 저장하는 스크립트
 * 실행: node save_ridi_auth.js
 */

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

(async () => {
  const authDir = path.join(__dirname, '.auth');
  if (!fs.existsSync(authDir)) fs.mkdirSync(authDir, { recursive: true });

  const authFile = path.join(authDir, 'ridi_auth.json');

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'ko-KR',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
  });

  const page = await context.newPage();

  console.log('리디북스 로그인 페이지를 엽니다...');
  await page.goto('https://ridibooks.com/account/login', { waitUntil: 'domcontentloaded' });

  console.log('');
  console.log('브라우저에서 리디북스에 로그인해주세요.');
  console.log('로그인 완료 후 이 터미널에서 Enter를 누르세요.');
  console.log('');

  // 사용자 입력 대기
  await new Promise(resolve => {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.once('data', () => {
      process.stdin.setRawMode(false);
      resolve();
    });
  });

  // 세션 저장
  await context.storageState({ path: authFile });
  console.log(`✅ 로그인 세션 저장 완료: ${authFile}`);
  console.log('');
  console.log('다음 단계: 이 폴더에서 아래 명령을 실행하세요.');
  console.log('  node encode_ridi_auth_for_secret.js');
  console.log('그러면 ridi_auth_secret.txt 파일이 생성됩니다.');
  console.log('그 파일 안의 텍스트 전체를 복사해서, GitHub 저장소 > Settings >');
  console.log('Secrets and variables > Actions 에서 RIDI_AUTH_GZIP_B64 시크릿 값에');
  console.log('붙여넣어 업데이트하세요. (RIDI_AUTH_JSON이 아닙니다.)');

  await browser.close();
})();
