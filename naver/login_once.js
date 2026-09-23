const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function waitForEnter(message) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise(resolve => {
    rl.question(message, () => {
      rl.close();
      resolve();
    });
  });
}

(async () => {
  const authDir = path.join(__dirname, '.auth');
  const authFile = path.join(authDir, 'naver_auth.json');

  ensureDir(authDir);

  const browser = await chromium.launch({
    headless: false
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 1400 },
    locale: 'ko-KR'
  });

  const page = await context.newPage();

  try {
    console.log('네이버 로그인 페이지를 엽니다...');
    await page.goto('https://nid.naver.com/nidlogin.login', {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });

    console.log('');
    console.log('브라우저에서 직접 로그인해주세요.');
    console.log('청유물 작품까지 확인하려면, 로그인 후 성인 인증이 필요한 작품도 한 번 직접 열어주세요.');
    console.log('로그인/인증이 끝나면 터미널로 돌아와 Enter를 누르세요.');
    console.log('');

    await waitForEnter('로그인과 인증이 끝났으면 Enter를 눌러주세요: ');

    await context.storageState({ path: authFile });

    console.log('');
    console.log('로그인 상태 저장 완료');
    console.log(`저장 위치: ${authFile}`);
    console.log('이 파일은 민감하니 절대 공유하지 마세요.');
  } catch (error) {
    console.error('오류 발생:', error);
  } finally {
    await browser.close();
  }
})();