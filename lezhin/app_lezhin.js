console.log('LEZHIN NEW LABEL VERSION: 2026-07-31-v7-cover-resize');
const fs = require('fs');
const path = require('path');

// 로컬 개발용: 같은 폴더의 .env 파일에서 API 키를 읽어온다 (GitHub Actions에서는 Secrets를 쓰므로 .env가 없어도 무관)
require('dotenv').config({ path: path.join(__dirname, '.env') });

const PLATFORM_KEY = 'lezhin';
const PLATFORM_LABEL = '레진코믹스';
const TOP_N = 20;

// 레진코믹스에서 공식 발급해준 랭킹 조회 API
const API_URL = 'https://www.lezhin.com/lz-api/b2b/ranking';

// ============================================================
// [변경 사항 안내]
// 이 파일은 기존에 Playwright로 브라우저를 띄워 랭킹 페이지를 긁던 방식에서,
// 레진코믹스가 공식으로 제공하는 API를 호출하는 방식으로 완전히 교체되었습니다.
//
// - 더 이상 로그인 세션(.auth/lezhin_auth.json)이 필요 없습니다.
// - 대신 환경변수 LEZHIN_API_KEY 에 발급받은 API 키가 들어있어야 합니다.
// - 출력 파일 경로/파일명/CSV 컬럼 구성은 기존과 100% 동일하게 맞췄습니다.
//   (output_lezhin/lezhin_top20_<날짜>.csv, history/, master/ 그대로 사용)
// ============================================================

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

function cleanText(value) {
  return String(value ?? '')
    .replace(/​/g, '')
    .replace(/ /g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function csvEscape(value) {
  const text = String(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
}

function writeUtf8Bom(filePath, content) {
  fs.writeFileSync(filePath, '﻿' + content, 'utf8');
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

// 기존 크롤러와 동일한 규칙: 자정 이후 실행되므로 "KST 기준 어제 날짜"를 collect_date로 사용
function getTodayText() {
  const d = new Date(new Date().getTime() + 9 * 60 * 60 * 1000);
  d.setUTCDate(d.getUTCDate() - 1);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function getNewInfo(collectDateText, launchDate) {
  if (!launchDate) {
    return { launch_date: '', new_yn: 'N', new_days: '' };
  }
  const collect = new Date(`${collectDateText}T00:00:00+09:00`);
  const launch = new Date(`${launchDate}T00:00:00+09:00`);
  if (Number.isNaN(collect.getTime()) || Number.isNaN(launch.getTime())) {
    return { launch_date: launchDate, new_yn: 'N', new_days: '' };
  }
  const rawDays = Math.floor((collect.getTime() - launch.getTime()) / (24 * 60 * 60 * 1000));
  const isNew = rawDays >= -1 && rawDays <= 30;
  const displayDays = rawDays < 0 ? 0 : rawDays;
  return {
    launch_date: launchDate,
    new_yn: isNew ? 'Y' : 'N',
    new_days: isNew ? String(displayDays) : ''
  };
}

// API의 publishedAt("yyyy-MM-dd HH:mm:ss", KST)에서 날짜 부분만 추출
function getLaunchDateFromApi(publishedAt) {
  const text = cleanText(publishedAt);
  const m = text.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : '';
}

// API genres[] 코드 -> 기존 파이프라인에서 쓰던 한글 genre_norm 값으로 매핑
// (문서에 명시된 8개 코드: romance, bl, drama, fantasy, action, mystery, gag, day)
// [2026-09-14 수정] 레진 API의 8개 장르 코드를, 다른 사이트(네이버/리디/봄툰/카카오)와
// 동일한 11개 장르 기준(로맨스/BL/GL/판타지/액션/무협/드라마/일상/스릴러/개그/기타)에 맞춰
// 재매핑. 'mystery'는 이 11개 기준에서 '스릴러'에 해당하는 값이라 이름을 맞춰줌.
// (레진 API 자체에 GL/무협 코드가 없어 그 두 값은 레진 데이터에는 나타나지 않음 - 정상)
function mapGenreCode(code) {
  const map = {
    romance: '로맨스',
    bl: 'BL',
    drama: '드라마',
    fantasy: '판타지',
    action: '액션',
    mystery: '스릴러',
    gag: '개그',
    day: '일상',
  };
  return map[String(code || '').toLowerCase()] || null;
}

function getGenreNorm(genres) {
  const list = Array.isArray(genres) ? genres : [];
  for (const g of list) {
    const mapped = mapGenreCode(g);
    if (mapped) return mapped;
  }
  if (list.length) {
    console.log(`  ⚠️ 인식 못한 장르 코드: ${JSON.stringify(list)} → '기타'로 처리`);
  }
  return '기타';
}

function isBlGenre(genres) {
  const list = Array.isArray(genres) ? genres : [];
  return list.some(g => String(g || '').toLowerCase() === 'bl') ? 'Y' : 'N';
}

// artists[] (role: writer/scripter/painter/original/model/illustrator/translator)에서
// 글/그림 작가명 추출. 기존 CSV의 writer/artist 컬럼과 동일한 의미로 채운다.
function extractAuthors(artists) {
  const list = Array.isArray(artists) ? artists : [];
  const namesByRole = role => list.filter(a => a && a.role === role).map(a => cleanText(a.name)).filter(Boolean);

  let writerNames = [...namesByRole('writer'), ...namesByRole('scripter'), ...namesByRole('original')];
  let artistNames = [...namesByRole('painter'), ...namesByRole('illustrator'), ...namesByRole('model')];

  if (!writerNames.length && !artistNames.length && list.length) {
    // 역할 구분이 없는 경우: 글그림 동일 작가로 취급 (기존 로직과 동일한 fallback)
    const allNames = list.map(a => cleanText(a.name)).filter(Boolean);
    writerNames = allNames;
    artistNames = allNames;
  }

  const writer = writerNames.length ? writerNames.join('/') : (artistNames.length ? artistNames.join('/') : '미확인');
  const artist = artistNames.length ? artistNames.join('/') : (writerNames.length ? writerNames.join('/') : '미확인');
  return { writer, artist };
}

// API serialInfo{status, dayOfWeek[], releaseCycle} -> 기존 serial_info 컬럼과 같은 형식의 문자열로 변환
function mapSerialInfo(serialInfo) {
  if (!serialInfo || typeof serialInfo !== 'object') return '-';
  const { status, dayOfWeek, releaseCycle } = serialInfo;
  if (status === 'COMPLETED') return '완결';
  if (status === 'HIATUS') return '휴재 중';

  const dayMap = { MON: '월요일', TUE: '화요일', WED: '수요일', THU: '목요일', FRI: '금요일', SAT: '토요일', SUN: '일요일' };
  const days = Array.isArray(dayOfWeek) ? dayOfWeek : [];

  if (releaseCycle === 'DAY_10') return '10일 주기 연재';
  if (days.length >= 7) return '매일';
  if (days.length >= 1) return `매주 ${days.map(d => dayMap[d] || d).join('·')}`;
  return '-';
}

function getHistoryFilePath(historyDir, dateText) {
  return path.join(historyDir, `lezhin_top20_${dateText}.json`);
}

function readLatestPreviousHistory(historyDir, currentDateText) {
  if (!fs.existsSync(historyDir)) return null;
  const dates = fs.readdirSync(historyDir, { withFileTypes: true })
    .filter(d => d.isFile())
    .map(d => {
      const m = d.name.match(/^lezhin_top20_(\d{4}-\d{2}-\d{2})\.json$/);
      return m ? m[1] : null;
    })
    .filter(Boolean)
    .filter(date => date < currentDateText)
    .sort();
  if (!dates.length) return null;
  try {
    return JSON.parse(fs.readFileSync(getHistoryFilePath(historyDir, dates[dates.length - 1]), 'utf8'));
  } catch (e) {
    return null;
  }
}

function parseCsvLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  result.push(current);
  return result;
}

const CSV_HEADER = [
  'collect_date',
  'category_key',
  'category_label',
  'rank',
  'title',
  'writer',
  'artist',
  'genre_norm',
  'adult_yn',
  'launch_date',
  'new_yn',
  'new_days',
  'bl_yn',
  'rank_change',
  'stay_days',
  'serial_info',
  'series_id',
  'detail_url',
  'cover_url',
];

function appendRowsToMaster(masterCsvPath, rows) {
  const exists = fs.existsSync(masterCsvPath);
  const existingKeys = new Set();
  if (exists) {
    const raw = fs.readFileSync(masterCsvPath, 'utf8').replace(/^﻿/, '');
    const lines = raw.split(/\r?\n/).filter(Boolean);
    for (let i = 1; i < lines.length; i++) {
      const cols = parseCsvLine(lines[i]);
      if (cols.length < 5) continue;
      existingKeys.add([
        cleanText(cols[0]),
        cleanText(cols[3]),
        cleanText(cols[4]).toLowerCase(),
      ].join('||'));
    }
  }
  const linesToAppend = [];
  for (const row of rows) {
    const key = [
      cleanText(row.collect_date),
      cleanText(row.rank),
      cleanText(row.title).toLowerCase(),
    ].join('||');
    if (existingKeys.has(key)) continue;
    existingKeys.add(key);
    linesToAppend.push(CSV_HEADER.map(h => csvEscape(row[h])).join(','));
  }
  if (!exists) {
    fs.writeFileSync(
      masterCsvPath,
      '﻿' + CSV_HEADER.join(',') + (linesToAppend.length ? '\n' + linesToAppend.join('\n') : '') + '\n',
      'utf8'
    );
    return linesToAppend.length;
  }
  if (linesToAppend.length) {
    fs.appendFileSync(masterCsvPath, linesToAppend.join('\n') + '\n', 'utf8');
  }
  return linesToAppend.length;
}

const sharp = require('sharp');

// 구글시트 셀 한도(50,000자)를 절대 넘지 않도록 하는 안전 마진
const MAX_COVER_DATA_URI_LENGTH = 45000;

// 레진 CDN의 이미지를 서버(Node.js)에서 직접 받아와, 작게 리사이즈·압축한 뒤
// base64로 변환한다.
// - 브라우저에서 <img>로 직접 불러오면 레진 CDN의 핫링크(Referer) 차단에
//   걸릴 수 있지만, 서버 간 요청은 보통 Referer를 안 보내므로 통과하는 경우가 많다.
// - 원본 이미지를 그대로 base64로 바꾸면 구글시트 셀 한도(50,000자)를 넘길 수 있어서,
//   sharp로 가로 100px 정도로 줄이고 JPEG 품질을 낮춰 항상 셀 한도 안에 들어오게 한다.
async function fetchImageAsDataUri(imageUrl) {
  const res = await fetch(imageUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    },
  });
  if (!res.ok) {
    throw new Error(`이미지 다운로드 실패 (HTTP ${res.status})`);
  }
  const arrayBuffer = await res.arrayBuffer();
  const originalBuffer = Buffer.from(arrayBuffer);

  // 품질을 단계적으로 낮춰가며 50,000자 한도 안에 들어올 때까지 재압축 시도
  const qualitySteps = [60, 45, 30, 20];
  for (const quality of qualitySteps) {
    const resizedBuffer = await sharp(originalBuffer)
      .resize({ width: 100, height: 140, fit: 'cover' })
      .jpeg({ quality })
      .toBuffer();
    const base64 = resizedBuffer.toString('base64');
    const dataUri = `data:image/jpeg;base64,${base64}`;
    if (dataUri.length <= MAX_COVER_DATA_URI_LENGTH) {
      return dataUri;
    }
  }

  throw new Error('최저 품질로 압축해도 셀 한도(50,000자)를 초과함');
}

async function fetchRankingFromApi(apiKey) {
  const res = await fetch(API_URL, {
    method: 'GET',
    headers: {
      'X-B2B-Api-Key': apiKey,
    },
  });

  if (res.status === 401) {
    throw new Error(
      '레진 API가 401 Unauthorized를 반환했습니다. LEZHIN_API_KEY가 없거나 잘못된 값입니다. ' +
      'GitHub Secret(LEZHIN_API_KEY) 값을 확인해주세요.'
    );
  }
  if (!res.ok) {
    throw new Error(`레진 API 호출 실패 (HTTP ${res.status})`);
  }

  const json = await res.json();
  if (json.code !== 0) {
    throw new Error(`레진 API 응답 오류: code=${json.code}, description=${json.description}`);
  }
  if (!Array.isArray(json.data)) {
    throw new Error('레진 API 응답에 data 배열이 없습니다.');
  }
  return json.data;
}

(async () => {
  const baseDir = __dirname;
  const outputDir = path.join(baseDir, 'output_lezhin');
  const historyDir = path.join(outputDir, 'history');
  const masterDir = path.join(outputDir, 'master');
  const dateText = getTodayText();

  ensureDir(outputDir);
  ensureDir(historyDir);
  ensureDir(masterDir);

  const apiKey = process.env.LEZHIN_API_KEY;
  if (!apiKey) {
    console.error('오류: 환경변수 LEZHIN_API_KEY가 설정되어 있지 않습니다.');
    process.exitCode = 1;
    return;
  }

  try {
    console.log('레진 API 호출 중...');
    const apiData = await fetchRankingFromApi(apiKey);

    const top20 = apiData
      .filter(item => Number(item.currentRank) >= 1 && Number(item.currentRank) <= TOP_N)
      .sort((a, b) => Number(a.currentRank) - Number(b.currentRank))
      .slice(0, TOP_N);

    console.log(`레진코믹스 웹툰 수신 건수: ${top20.length}`);
    if (top20.length === 0) {
      throw new Error('레진 API 응답에 랭킹 데이터가 없습니다 (data 배열이 비어있음).');
    }

    const previousRows = readLatestPreviousHistory(historyDir, dateText) || [];
    const hasPrevSnapshot = previousRows.length > 0;
    const prevMap = new Map(previousRows.map(row => [cleanText(row.title).toLowerCase(), row]));

    const rows = [];
    for (const item of top20) {
      const title = cleanText(item.title);
      const { writer, artist } = extractAuthors(item.artists);
      const genreNorm = getGenreNorm(item.genres);
      const blYn = isBlGenre(item.genres);
      const adultYn = item.isAdult ? 'Y' : 'N';
      const launchDate = getLaunchDateFromApi(item.publishedAt);
      const newInfo = getNewInfo(dateText, launchDate);
      const serialInfoText = mapSerialInfo(item.serialInfo);

      const titleKey = title.toLowerCase();
      const prevRow = prevMap.get(titleKey);
      const stayDays = prevRow ? Number(prevRow.stay_days || 0) + 1 : 1;

      let rankChange;
      if (!hasPrevSnapshot) {
        rankChange = '기준없음';
      } else if (!prevRow) {
        rankChange = 'NEW';
      } else {
        const prevRank = Number(prevRow.rank);
        const curRank = Number(item.currentRank);
        if (prevRank === curRank) rankChange = '-';
        else if (prevRank > curRank) rankChange = `▲${prevRank - curRank}`;
        else rankChange = `▼${curRank - prevRank}`;
      }

      let coverDataUri = '';
      if (item.coverUrl) {
        try {
          coverDataUri = await fetchImageAsDataUri(item.coverUrl);
        } catch (e) {
          console.log(`  ⚠️ 표지 이미지 변환 실패: ${title} - ${e.message}`);
        }
      }

      console.log(
        `  ${item.currentRank}위: ${title} / 장르: ${genreNorm} / 성인: ${adultYn} / 변화: ${rankChange} / 표지: ${coverDataUri ? 'OK' : '실패'}`
      );

      rows.push({
        collect_date: dateText,
        category_key: PLATFORM_KEY,
        category_label: PLATFORM_LABEL,
        rank: item.currentRank,
        title,
        writer,
        artist,
        genre_norm: genreNorm,
        adult_yn: adultYn,
        launch_date: newInfo.launch_date,
        new_yn: newInfo.new_yn,
        new_days: newInfo.new_days,
        bl_yn: blYn,
        rank_change: rankChange,
        stay_days: stayDays,
        serial_info: serialInfoText,
        series_id: String(item.id ?? ''),
        detail_url: item.detailUrl || '',
        // 레진 CDN 핫링크 차단을 피하기 위해, API가 준 이미지 URL을
        // 서버(Node.js)에서 직접 받아와 base64로 변환한 값을 사용한다.
        // (실패 시 빈 값 - 대시보드 쪽에서 표지 영역을 자동으로 숨김)
        cover_url: coverDataUri,
      });
    }

    const csvLines = [CSV_HEADER.join(',')];
    for (const row of rows) {
      csvLines.push(CSV_HEADER.map(h => csvEscape(row[h])).join(','));
    }
    const csvPath = path.join(outputDir, `lezhin_top20_${dateText}.csv`);
    writeUtf8Bom(csvPath, csvLines.join('\n'));

    const previewLines = rows.map(r => {
      const authorPart = r.writer === r.artist
        ? `글그림 ${r.writer}`
        : `글 ${r.writer} / 그림 ${r.artist}`;
      return `${r.rank}. ${r.title} / ${authorPart} / ${r.genre_norm} / BL ${r.bl_yn} / 성인 ${r.adult_yn} / 변화 ${r.rank_change} / 체류 ${r.stay_days}일 / ${r.serial_info}`;
    });
    const previewPath = path.join(outputDir, `lezhin_top20_preview_${dateText}.txt`);
    writeUtf8Bom(previewPath, previewLines.join('\n'));

    writeJson(getHistoryFilePath(historyDir, dateText), rows);

    const masterCsvPath = path.join(masterDir, 'lezhin_top20_master.csv');
    const appendedCount = appendRowsToMaster(masterCsvPath, rows);

    console.log(`\n완료: 레진코믹스 웹툰 (API 방식)`);
    console.log(`CSV 저장: ${csvPath}`);
    console.log(`미리보기 저장: ${previewPath}`);
    console.log(`히스토리 저장: ${getHistoryFilePath(historyDir, dateText)}`);
    console.log(`누적 CSV 저장: ${masterCsvPath}`);
    console.log(`이번 실행 누적 추가 건수: ${appendedCount}`);
  } catch (error) {
    console.error('오류 발생:', error.message || error);
    // 실패 시 종료 코드 1 → GitHub Actions에서 실패(❌)로 표시되게 함
    process.exitCode = 1;
  }
})();