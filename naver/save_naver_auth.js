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
  const authFile = path.join(authDir, 'naver_auth.json');
  ensureDir(authDir);

  const browser = await chromium.launch({
    headless: false,
    args: ['--start-maximized']
  });

  const context = await browser.newContext({
    viewport: null,
    locale: 'ko-KR'
  });

  const page = await context.newPage();

  // 네이버 로그인 자체는 comic.naver.com이 아니라 nid.naver.com에서 처리되므로,
  // 로그인 페이지에서 시작해서 로그인 후 comic 페이지로 넘어가는 흐름으로 진행합니다.
  await page.goto('https://nid.naver.com/nidlogin.login', {
    waitUntil: 'domcontentloaded',
    timeout: 60000
  });

  console.log('\n1) 네이버 계정으로 로그인하세요.');
  console.log('2) 로그인 후 주소창에 https://comic.naver.com/webtoon?tab=mon 을 입력해서 이동하세요.');
  console.log('3) 아무 성인(19세/청유물) 작품 하나를 클릭해서 상세페이지가 로그인 요구 없이 정상적으로 보이는지 확인하세요.');
  console.log('   (연령 확인/로그인 요구 화면이 뜬다면, 그 화면에서 나오는 절차까지 다 완료해주세요.)');
  console.log('4) 그 작품의 회차 목록(정렬 변경 등)도 로그인 요구 없이 보이는지 확인하세요.');

  await waitEnter('\n모두 확인되면 Enter를 눌러 로그인 세션을 저장합니다... ');

  await context.storageState({ path: authFile });
  console.log(`\n저장 완료: ${authFile}`);
  console.log('이제 encode_naver_auth_plain.js를 실행해서 GitHub Secret용 텍스트를 만드세요.');

  await browser.close();
})();