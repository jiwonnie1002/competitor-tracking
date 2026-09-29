/**
 * send_dashboard_capture.js
 * 메인 대시보드의 그래프 영역을 캡쳐해서
 * 메일버전 Apps Script doPost로 전달
 *
 * 실행:
 * node send_dashboard_capture.js
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

/**
 * 설정값
 */

// 그래프가 있는 최종 메인 대시보드 링크
const MAIN_DASHBOARD_URL = 'https://script.google.com/macros/s/AKfycbwlvzx4b2AfxoIDflr8tRYQYnY6M7xvcY4g2vAUlIjyipnCsCz-PARfsco5aXeN5TZtHQ/exec';

// 이메일용 대시보드 / 메일 발송용 Apps Script 최종 웹앱 링크
const EMAIL_POST_URL = 'https://script.google.com/macros/s/AKfycbwz0qLgGPp8k_iTPVHUUN-5UijThdCc1VQySdogJix55ldHT-FUDW0TQmphK1-tn4_kxw/exec';

// Apps Script의 UPLOAD_TOKEN과 동일
const UPLOAD_TOKEN = 'email_dashboard_graph_20260610';

const OUTPUT_DIR = path.join(__dirname, 'dashboard_mail_capture');

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function getTodayKstString() {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

async function main() {
  ensureDir(OUTPUT_DIR);

  const today = getTodayKstString();
  const filename = `dashboard_graph_${today}.png`;
  const imagePath = path.join(OUTPUT_DIR, filename);
  const debugPath = path.join(OUTPUT_DIR, `debug_fullpage_${today}.png`);

  console.log('[1/5] 브라우저 실행 중...');

  const browser = await chromium.launch({
    headless: true
  });

  const page = await browser.newPage({
    viewport: {
      width: 1440,
      height: 1000
    },
    deviceScaleFactor: 1
  });

  page.setDefaultTimeout(180000);
  page.setDefaultNavigationTimeout(180000);

  console.log('[2/5] 메인 대시보드 접속 중...');

  await page.goto(MAIN_DASHBOARD_URL, {
    waitUntil: 'domcontentloaded',
    timeout: 180000
  });

  console.log('[3/5] 대시보드 렌더링 대기 중...');

  // 원래 방식: 완료 여부 체크하지 않고 고정 시간 대기
  await page.waitForTimeout(90000);

  // 확인용 전체 캡쳐 저장
  await page.screenshot({
    path: debugPath,
    fullPage: true
  });

  console.log('[4/5] 그래프 영역 좌표 캡쳐 중...');

  const screenshotBuffer = await page.screenshot({
    path: imagePath,
    clip: {
      x: 50,
      y: 440,
      width: 1335,
      height: 420
    }
  });

  await browser.close();

  console.log('[5/5] 메일버전 Apps Script로 이미지 전송 중...');
  console.log('전송 토큰:', UPLOAD_TOKEN);
  console.log('전송 URL:', EMAIL_POST_URL);

  const payload = {
    token: UPLOAD_TOKEN,
    filename,
    imageBase64: screenshotBuffer.toString('base64')
  };

  const response = await fetch(EMAIL_POST_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload),
    redirect: 'follow'
  });

  const resultText = await response.text();
  console.log('Apps Script 응답:', resultText);

  if (!response.ok) {
    throw new Error(`Apps Script 전송 실패: ${response.status} ${resultText}`);
  }

  let resultJson;
  try {
    resultJson = JSON.parse(resultText);
  } catch (e) {
    throw new Error(
      'Apps Script 응답이 JSON이 아닙니다. 웹앱 URL 또는 배포 설정을 확인하세요.\n' +
      resultText.slice(0, 500)
    );
  }

  if (!resultJson.ok) {
    throw new Error('Apps Script 처리 실패: ' + (resultJson.message || resultText));
  }

  console.log('완료:', imagePath);
  console.log('확인용 전체 캡쳐:', debugPath);
}

main().catch(err => {
  console.error('실패:', err);
  process.exit(1);
});
