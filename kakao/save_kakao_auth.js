/**
 * save_kakao_auth.js
 * 카카오페이지 로그인 세션을 저장하는 스크립트 (리디·네이버와 동일한 방식)
 * 실행: node save_kakao_auth.js
 *
 * app_kakao.js는 .auth/kakao_auth.json 하나만 읽습니다(storageState).
 * 예전 버전이 함께 저장하던 kakao_session_storage.json은 크롤러도,
 * GitHub Actions(collect.yml)도 실제로 읽지 않는 파일이라 이번에 정리했습니다.
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

function waitEnter(message) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(message, () => {
      rl.close();
      resolve();
    });
  });
}

(async () => {
  const authDir = path.join(__dirname, '.auth');
  const authFile = path.join(authDir, 'kakao_auth.json');
  ensureDir(authDir);

  const browser = await chromium.launch({
    headless: false,
    args: ['--start-maximized']
  });

  const context = await browser.newContext({
    viewport: null,
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  });

  const page = await context.newPage();

  console.log('카카오페이지 랭킹 화면을 엽니다...');
  await page.goto('https://page.kakao.com/menu/10010/screen/93', {
    waitUntil: 'domcontentloaded',
    timeout: 60000
  });

  console.log('');
  console.log('1) 카카오페이지에 로그인하세요.');
  console.log('2) 19세 완전판 작품 상세페이지에 직접 들어가세요.');
  console.log('3) 성인 인증/확인/동의 버튼이 나오면 모두 완료하세요.');
  console.log('4) 상세페이지에서 작품 제목/작가/정보가 정상적으로(로그인 요구 없이) 보이는지 확인하세요.');
  console.log('');

  await waitEnter('모두 확인되면 Enter를 눌러 로그인 세션을 저장합니다... ');

  await context.storageState({ path: authFile });
  console.log(`\n저장 완료: ${authFile}`);
  console.log('');
  console.log('다음 단계: 이 폴더에서 아래 명령을 실행하세요.');
  console.log('  node encode_kakao_auth_for_secret.js');
  console.log('그러면 kakao_auth_secret.txt 파일이 생성됩니다.');
  console.log('그 파일 안의 텍스트 전체를 복사해서, GitHub 저장소 > Settings >');
  console.log('Secrets and variables > Actions 에서 KAKAO_AUTH_GZIP_B64 시크릿 값에');
  console.log('붙여넣어 업데이트하세요.');

  await browser.close();
})();
