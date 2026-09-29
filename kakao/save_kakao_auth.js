/**
 * save_kakao_auth.js
 * 카카오페이지 로그인 세션 저장 스크립트
 *
 * 사용법:
 *   node save_kakao_auth.js
 *
 * 브라우저가 열리면 직접 카카오 계정으로 로그인하세요.
 * 로그인 완료 후 터미널에서 Enter 를 누르면 세션이 저장됩니다.
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

(async () => {
  const authDir = path.join(__dirname, '.auth');
  const authFile = path.join(authDir, 'kakao_auth.json');
  ensureDir(authDir);

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    locale: 'ko-KR'
  });

  const page = await context.newPage();
  await page.goto('https://page.kakao.com', { waitUntil: 'domcontentloaded' });

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  브라우저가 열렸습니다.');
  console.log('  카카오 계정으로 직접 로그인해 주세요.');
  console.log('  로그인 완료 후 이 창으로 돌아와서 Enter 를 누르세요.');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  await new Promise(resolve => rl.question('로그인 완료 후 Enter 키를 누르세요...', () => { rl.close(); resolve(); }));

  await context.storageState({ path: authFile });
  console.log(`\n✅ 로그인 세션 저장 완료: ${authFile}`);
  console.log('   이제 app_kakao.js 를 실행하면 로그인 상태로 크롤링됩니다.\n');

  await browser.close();
})();
