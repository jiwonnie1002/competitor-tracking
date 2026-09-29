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
  const authFile = path.join(authDir, 'lezhin_auth.json');
  ensureDir(authDir);

  const browser = await chromium.launch({
    headless: false,
    args: ['--start-maximized']
  });

  const context = await browser.newContext({
    viewport: null,
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul'
  });

  const page = await context.newPage();
  await page.goto('https://www.lezhin.com/ko/ranking?rankType=realtime&filter=all&genre=_all', {
    waitUntil: 'domcontentloaded',
    timeout: 60000
  });

  console.log('\n1) 레진에 로그인하세요.');
  console.log('2) 랭킹 화면에서 19금/성인 포함 버튼을 ON 상태로 맞추세요.');
  console.log('3) 성인 작품이 보이는 상태까지 확인하세요.');
  await waitEnter('\n완료 후 Enter를 누르면 로그인 세션을 저장합니다... ');

  await context.storageState({ path: authFile });
  console.log(`\n저장 완료: ${authFile}`);

  await browser.close();
})();
