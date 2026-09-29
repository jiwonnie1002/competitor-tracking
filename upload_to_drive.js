/**
 * upload_to_drive.js
 *
 * 최종 정리본
 *
 * 원칙
 * 1) 자정 이후 크롤링 → KST 기준 전일자 CSV 생성
 * 2) Google Drive에는 Apps Script가 읽는 "정확한 latest 파일명"만 업데이트
 * 3) 이번 기준일 CSV가 없는 플랫폼은 업로드하지 않음
 * 4) 과거 CSV(예: 5/17, 7/6)를 최신 파일로 잘못 업로드하지 않음
 * 5) Drive에 같은 latest 파일명이 중복되어 있으면 전부 같은 최신 내용으로 업데이트
 * 6) Service Account quota 오류 방지를 위해 Drive 파일 새 생성은 하지 않음
 *
 * [2026-09-03 추가] 안정성 보완
 * 7) 구글 서버 일시 오류(500/502/503/504, 429, 네트워크 끊김)는 최대 3회 자동 재시도
 *    - 업로드는 PATCH 방식이라 구글 라이브러리가 기본적으로 재시도하지 않고,
 *      파일을 스트림으로 보내기 때문에 재시도하려면 스트림을 새로 만들어야 한다.
 *      → 시도할 때마다 createReadStream을 새로 호출한다.
 * 8) 한 플랫폼이 끝내 실패해도 나머지 플랫폼은 계속 진행한다.
 *    - 예전에는 카카오에서 실패하면 그 뒤 네이버·레진·봄툰이 통째로 업로드되지 않았다.
 *    - 마지막에 실패 목록을 정리해서 보여주고, 하나라도 실패했으면 종료 코드 1로 끝낸다.
 */

const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

// ---- 재시도 설정 ----
const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [5000, 15000]; // 1차 실패 후 5초, 2차 실패 후 15초
const RETRYABLE_STATUS = [429, 500, 502, 503, 504];
const RETRYABLE_CODES = [
  'ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EAI_AGAIN', 'EPIPE',
  'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_SOCKET',
];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isRetryableError(error) {
  if (!error) return false;

  const status = Number(error.status || error.code);
  if (RETRYABLE_STATUS.includes(status)) return true;

  const code = String(error.code || (error.cause && error.cause.code) || '');
  if (RETRYABLE_CODES.includes(code)) return true;

  const message = String(error.message || '');
  if (/socket hang up|network|timeout|Bad Gateway|Service Unavailable|temporary error/i.test(message)) return true;

  return false;
}

function describeError(error) {
  if (!error) return '알 수 없는 오류';
  const status = error.status || error.code;
  const message = String(error.message || error).split('\n')[0].slice(0, 200);
  return status ? `HTTP ${status} / ${message}` : message;
}

/**
 * 구글 API 호출을 재시도와 함께 실행한다.
 * @param {string} label 로그에 표시할 작업 이름
 * @param {() => Promise<any>} run 매 시도마다 새로 호출되는 함수 (스트림도 여기서 새로 만든다)
 */
async function withRetry(label, run) {
  let lastError;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await run();
    } catch (error) {
      lastError = error;

      if (!isRetryableError(error) || attempt === MAX_ATTEMPTS) {
        throw error;
      }

      const delay = RETRY_DELAYS_MS[attempt - 1] || RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1];
      console.log(`[RETRY] ${label}: ${attempt}회차 실패 (${describeError(error)}) → ${delay / 1000}초 후 재시도`);
      await sleep(delay);
    }
  }

  throw lastError;
}

async function getAuthClient() {
  const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!serviceAccountJson) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON 환경변수가 없습니다.');

  const credentials = JSON.parse(serviceAccountJson);

  return new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/drive']
  });
}

function getTargetDateText() {
  // 모든 크롤러의 파일명 기준과 동일: KST 기준 전일자
  const d = new Date(new Date().getTime() + 9 * 60 * 60 * 1000);
  d.setUTCDate(d.getUTCDate() - 1);

  return [
    d.getUTCFullYear(),
    String(d.getUTCMonth() + 1).padStart(2, '0'),
    String(d.getUTCDate()).padStart(2, '0')
  ].join('-');
}

function readCsvHeader(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8').replace(/^﻿/, '');
  return String(raw.split(/\r?\n/)[0] || '').trim();
}

function readCsvCollectDate(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8').replace(/^﻿/, '');
  const lines = raw.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return '';

  // CSV 첫 컬럼 collect_date는 따옴표가 있어도 앞쪽 날짜만 보면 충분
  return String(lines[1] || '')
    .replace(/^"/, '')
    .split(',')[0]
    .replace(/"/g, '')
    .slice(0, 10);
}

function listFilesFlat(dir) {
  if (!fs.existsSync(dir)) return [];

  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter(d => d.isFile())
    .map(d => path.join(dir, d.name));
}

function findCsvForTargetDate({ label, dir, patterns, targetDate }) {
  const files = listFilesFlat(dir);
  const candidates = [];

  for (const filePath of files) {
    const name = path.basename(filePath);

    for (const pattern of patterns) {
      const m = name.match(pattern);
      if (!m) continue;

      const fileDate = m[1];
      if (fileDate !== targetDate) continue;

      candidates.push({
        filePath,
        name,
        fileDate,
        mtimeMs: fs.statSync(filePath).mtimeMs
      });
    }
  }

  if (!candidates.length) {
    console.log(`[SKIP] ${label}: 이번 실행 기준일(${targetDate}) CSV 없음`);
    return null;
  }

  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const picked = candidates[0];

  const header = readCsvHeader(picked.filePath);
  const collectDate = readCsvCollectDate(picked.filePath);

  console.log('');
  console.log(`[SELECT] ${label}`);
  console.log(`  file: ${picked.filePath}`);
  console.log(`  fileDate: ${picked.fileDate}`);
  console.log(`  collect_date: ${collectDate || '-'}`);
  console.log(`  header: ${header}`);

  if (collectDate && collectDate !== targetDate) {
    throw new Error(`${label}: 파일명 날짜(${targetDate})와 CSV collect_date(${collectDate})가 다릅니다.`);
  }

  return picked.filePath;
}

async function findDriveFilesByName(drive, folderId, fileName) {
  const escapedName = fileName.replace(/'/g, "\\'");
  const escapedFolderId = folderId.replace(/'/g, "\\'");

  const res = await withRetry(`${fileName} 조회`, () =>
    drive.files.list({
      q: `'${escapedFolderId}' in parents and name = '${escapedName}' and trashed = false`,
      fields: 'files(id, name, modifiedTime)',
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      pageSize: 100
    })
  );

  return res.data.files || [];
}

async function updateExactLatestFile(drive, folderId, localFilePath, driveFileName) {
  const files = await findDriveFilesByName(drive, folderId, driveFileName);

  if (!files.length) {
    throw new Error(`${driveFileName}: Drive 기존 latest 파일이 없습니다. Service Account quota 오류 방지를 위해 새 파일 생성은 하지 않습니다.`);
  }

  if (files.length > 1) {
    console.log(`[WARN] ${driveFileName}: 동일 파일명 ${files.length}개 발견 → 전부 업데이트`);
  }

  for (const file of files) {
    // 재시도할 때마다 createReadStream을 새로 호출해야 한다.
    // (이미 읽은 스트림을 재사용하면 빈 파일이 올라가거나 그대로 실패한다)
    await withRetry(`${driveFileName} 업로드`, () =>
      drive.files.update({
        fileId: file.id,
        media: {
          mimeType: 'text/csv',
          body: fs.createReadStream(localFilePath)
        },
        fields: 'id, name, modifiedTime',
        supportsAllDrives: true
      })
    );

    console.log(`[UPDATE] ${driveFileName} → ${file.id}`);
  }
}

async function uploadDataset(drive, dataset, targetDate) {
  if (!dataset.folderId) {
    console.log(`[SKIP] ${dataset.label}: folderId 없음`);
    return { status: 'skipped' };
  }

  const localFilePath = findCsvForTargetDate({
    label: dataset.label,
    dir: dataset.dir,
    patterns: dataset.patterns,
    targetDate
  });

  if (!localFilePath) return { status: 'skipped' };

  await updateExactLatestFile(drive, dataset.folderId, localFilePath, dataset.driveLatestName);
  return { status: 'uploaded' };
}

async function main() {
  const targetDate = getTargetDateText();
  console.log(`[INFO] 업로드 기준일: ${targetDate}`);
  console.log('[INFO] Apps Script가 읽는 정확한 latest 파일명만 업데이트합니다.');

  const auth = await getAuthClient();
  const drive = google.drive({ version: 'v3', auth });

  const datasets = [
    {
      label: '리디 웹툰',
      dir: path.join(__dirname, 'ridi', 'output_ridi'),
      patterns: [/^ridi_webtoon_top20_(\d{4}-\d{2}-\d{2})\.csv$/],
      folderId: process.env.RIDI_FOLDER_ID,
      driveLatestName: 'ridi_webtoon_latest.csv'
    },
    {
      label: '리디 BL웹툰',
      dir: path.join(__dirname, 'ridi', 'output_ridi'),
      patterns: [/^ridi_bl_webtoon_top20_(\d{4}-\d{2}-\d{2})\.csv$/],
      folderId: process.env.RIDI_FOLDER_ID,
      driveLatestName: 'ridi_bl_webtoon_latest.csv'
    },
    {
      label: '카카오',
      dir: path.join(__dirname, 'kakao', 'output_kakao'),
      patterns: [/^kakao_webtoon_top20_(\d{4}-\d{2}-\d{2})\.csv$/],
      folderId: process.env.KAKAO_FOLDER_ID,
      driveLatestName: 'kakao_webtoon_latest.csv'
    },
    {
      label: '네이버',
      dir: path.join(__dirname, 'naver', 'output'),
      patterns: [
        /^naver_top20_(\d{4}-\d{2}-\d{2})\.csv$/,
        /^naver_top10_(\d{4}-\d{2}-\d{2})_(mon|tue|wed|thu|fri|sat|sun)\.csv$/
      ],
      folderId: process.env.NAVER_FOLDER_ID,
      driveLatestName: 'naver_webtoon_latest.csv'
    },
    {
      label: '레진',
      dir: path.join(__dirname, 'lezhin', 'output_lezhin'),
      patterns: [/^lezhin_top20_(\d{4}-\d{2}-\d{2})\.csv$/],
      folderId: process.env.LEZHIN_FOLDER_ID,
      driveLatestName: 'lezhin_webtoon_latest.csv'
    },
    {
      label: '봄툰',
      dir: path.join(__dirname, 'bomtoon', 'output_bomtoon'),
      patterns: [/^bomtoon_top20_(\d{4}-\d{2}-\d{2})\.csv$/],
      folderId: process.env.BOMTOON_FOLDER_ID,
      driveLatestName: 'bomtoon_webtoon_latest.csv'
    }
  ];

  const uploaded = [];
  const skipped = [];
  const failed = [];

  // 한 플랫폼이 실패해도 나머지는 계속 진행한다.
  for (const dataset of datasets) {
    try {
      const result = await uploadDataset(drive, dataset, targetDate);
      if (result.status === 'uploaded') uploaded.push(dataset.label);
      else skipped.push(dataset.label);
    } catch (error) {
      console.error(`[FAIL] ${dataset.label}: ${describeError(error)}`);
      failed.push({ label: dataset.label, reason: describeError(error) });
    }
  }

  console.log('');
  console.log('==================== 업로드 결과 ====================');
  console.log(`성공 ${uploaded.length}건: ${uploaded.join(', ') || '-'}`);
  console.log(`건너뜀 ${skipped.length}건: ${skipped.join(', ') || '-'}`);
  console.log(`실패 ${failed.length}건: ${failed.map(f => f.label).join(', ') || '-'}`);

  if (failed.length) {
    console.log('');
    console.log('실패 상세');
    for (const f of failed) console.log(`  - ${f.label}: ${f.reason}`);
    console.log('');
    console.log('구글 서버 일시 오류(502/503 등)라면 Actions에서 Re-run failed jobs로 다시 시도하면 됩니다.');
    process.exitCode = 1;
    return;
  }

  console.log('');
  console.log('Google Drive 업로드 완료');
}

main().catch(error => {
  console.error('Google Drive 업로드 실패:', error);
  process.exit(1);
});
