console.log('KAKAO NEW LABEL VERSION: 2026-07-07-v2-episode-date');
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// ─── 설정 ───────────────────────────────────────────────────────────────────
const RANKING_URL = 'https://page.kakao.com/menu/10010/screen/93';
const TOP_N = 20;

// ─── 유틸 ───────────────────────────────────────────────────────────────────
function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

function cleanText(value) {
  return String(value ?? '').replace(/\u200b/g, '').replace(/\s+/g, ' ').trim();
}

function normalizeOutputTitle(raw) {
  return cleanText(raw)
    .replace(/\s*-\s*카카오페이지 독점!?$/i, '')
    .replace(/\s*카카오페이지 독점!?$/i, '')
    .trim();
}

function csvEscape(value) {
  const text = String(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
}

function writeUtf8Bom(filePath, content) {
  fs.writeFileSync(filePath, '\ufeff' + content, 'utf8');
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function getTodayText() {
  // KST = UTC + 9시간
  const d = new Date(new Date().getTime() + 9 * 60 * 60 * 1000);
  d.setUTCDate(d.getUTCDate() - 1); // KST 기준 어제
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}


function normalizeLaunchDateCandidate(yearRaw, monthRaw, dayRaw, baseDateText) {
  let year = yearRaw ? Number(String(yearRaw).replace(/\D/g, '')) : Number(String(baseDateText || '').slice(0, 4));
  const month = Number(String(monthRaw || '').replace(/\D/g, ''));
  const day = Number(String(dayRaw || '').replace(/\D/g, ''));

  if (!year || !month || !day) return '';
  if (year < 100) year += year >= 70 ? 1900 : 2000;
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return '';

  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return '';

  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function findLaunchDateCandidateInText(rawText, baseDateText) {
  const text = cleanText(rawText).replace(/\s+/g, ' ');
  if (!text) return '';

  const patterns = [
    /((?:19|20)?\d{2})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})\s*(?:일)?/,
    /((?:19|20)?\d{2})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/,
    /(\d{1,2})\s*월\s*(\d{1,2})\s*일/
  ];

  let m = text.match(patterns[0]) || text.match(patterns[1]);
  if (m) return normalizeLaunchDateCandidate(m[1], m[2], m[3], baseDateText);

  m = text.match(patterns[2]);
  if (m) return normalizeLaunchDateCandidate('', m[1], m[2], baseDateText);

  return '';
}

function collectDateCandidatesFromText(rawText, baseDateText) {
  const text = cleanText(rawText).replace(/\s+/g, ' ');
  if (!text) return [];

  const candidates = new Set();
  const baseYear = Number(String(baseDateText || '').slice(0, 4)) || new Date().getFullYear();

  const patterns = [
    /((?:19|20)\d{2})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})\s*(?:일)?/g,
    /((?:19|20)\d{2})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/g,
    /(\d{2})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,2})/g,
    /(\d{1,2})\s*월\s*(\d{1,2})\s*일/g
  ];

  let m;

  while ((m = patterns[0].exec(text)) !== null) {
    const d = normalizeLaunchDateCandidate(m[1], m[2], m[3], baseDateText);
    if (d) candidates.add(d);
  }

  while ((m = patterns[1].exec(text)) !== null) {
    const d = normalizeLaunchDateCandidate(m[1], m[2], m[3], baseDateText);
    if (d) candidates.add(d);
  }

  while ((m = patterns[2].exec(text)) !== null) {
    const yy = Number(m[1]);
    const year = yy >= 70 ? 1900 + yy : 2000 + yy;
    const d = normalizeLaunchDateCandidate(String(year), m[2], m[3], baseDateText);
    if (d) candidates.add(d);
  }

  while ((m = patterns[3].exec(text)) !== null) {
    const d = normalizeLaunchDateCandidate(String(baseYear), m[1], m[2], baseDateText);
    if (d) candidates.add(d);
  }

  const collectTime = new Date(`${baseDateText}T00:00:00+09:00`).getTime();

  return Array.from(candidates)
    .filter(d => {
      const t = new Date(`${d}T00:00:00+09:00`).getTime();
      if (Number.isNaN(t)) return false;
      if (!Number.isNaN(collectTime) && t > collectTime + 24 * 60 * 60 * 1000) return false;
      return true;
    })
    .sort();
}

function extractLaunchDateFromText(rawText, baseDateText) {
  const text = cleanText(rawText).replace(/\s+/g, ' ');
  if (!text) return '';

  const keywordRe = /(런칭일|론칭일|런칭|론칭|오픈일|오픈|공개일|첫\s*공개|최초\s*공개|연재\s*시작일|연재\s*시작|서비스\s*시작일|서비스\s*시작|출간일|출간|발행일|발행|등록일|게시일|시작일)/gi;
  const windows = [];
  let m;

  while ((m = keywordRe.exec(text)) !== null) {
    windows.push(text.slice(Math.max(0, m.index - 80), Math.min(text.length, m.index + 180)));
  }

  for (const win of windows) {
    const date = findLaunchDateCandidateInText(win, baseDateText);
    if (date) return date;
  }

  // 별도 런칭일 라벨이 없는 경우, 상세페이지/회차 목록에 노출된 날짜 중 가장 오래된 날짜를 런칭일로 사용
  const allDates = collectDateCandidatesFromText(text, baseDateText);
  if (allDates.length) return allDates[0];

  return '';
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

  // 수집 파일명은 KST 기준 전일자로 저장되지만, 플랫폼 랭킹/상세페이지는 자정 이후 당일 신작을 노출할 수 있음.
  // 이 경우 launch_date가 collect_date보다 1일 뒤로 잡히므로 D+1까지는 신작으로 인정하고 new_days는 0으로 표기.
  const isNew = rawDays >= -1 && rawDays <= 30;
  const displayDays = rawDays < 0 ? 0 : rawDays;

  return {
    launch_date: launchDate,
    new_yn: isNew ? 'Y' : 'N',
    new_days: isNew ? String(displayDays) : ''
  };
}

function normalizeGenre(raw) {
  const text = cleanText(raw).replace(/^#/, '');
  if (!text || text === '미확인') return '기타';
  if (/로판|로맨스|순정|연애|BL|GL|백합/.test(text)) return '로맨스';
  if (/판타지|현대판타지|게임|SF|이세계|회귀|귀환|환생|빙의|헌터|던전|마법|용사|마왕|레벨업|시스템|아포칼립스|전생/.test(text)) return '판타지';
  if (/액션|스포츠|히어로|범죄|느와르|첩보|격투|전쟁|검술/.test(text)) return '액션';
  if (/일상|에피소드|힐링|먹방|요리|반려|육아|학교/.test(text)) return '일상';
  if (/스릴러|공포|미스터리|호러|서스펜스|추리|심리/.test(text)) return '스릴러';
  if (/개그|코미디|병맛/.test(text)) return '개그';
  if (/무협|선협|사극|강호|협객|검협/.test(text)) return '무협';
  if (/드라마|학원|성장|감성|복수|오피스|가족|청춘/.test(text)) return '드라마';
  return '기타';
}

function normalizeSerialInfo(raw) {
  const text = cleanText(raw).trim();
  if (!text || text === '미확인') return '-';
  if (/완결/.test(text)) return '완결';
  if (/매일/.test(text)) return '매일';
  if (/격주/.test(text)) return '격주';
  if (/휴재/.test(text)) return '휴재 중';

  const map = {
    월: '월요일',
    화: '화요일',
    수: '수요일',
    목: '목요일',
    금: '금요일',
    토: '토요일',
    일: '일요일',
  };

  // "수 연재" → "매주 수요일"
  const mDay = text.match(/^([월화수목금토일])\s*연재$/);
  if (mDay) return `매주 ${map[mDay[1]] || mDay[1] + '요일'}`;

  // "매주 수요일" 형태
  const mFull = text.match(/매주\s*([월화수목금토일]요일)/);
  if (mFull) return `매주 ${mFull[1]}`;

  // "월, 수 연재" 형태
  const mMulti = text.match(/([월화수목금토일](?:\s*[,、]\s*[월화수목금토일])*)\s*연재/);
  if (mMulti) {
    const days = mMulti[1].split(/[,、]/).map(v => {
      const w = cleanText(v);
      return map[w] || w + '요일';
    }).join(', ');
    return `매주 ${days}`;
  }

  return '-';
}

// ─── 히스토리 ────────────────────────────────────────────────────────────────
function getHistoryFilePath(historyDir, dateText) {
  return path.join(historyDir, `kakao_webtoon_top20_${dateText}.json`);
}

function readLatestPreviousHistory(historyDir, currentDateText) {
  if (!fs.existsSync(historyDir)) return null;

  const files = fs.readdirSync(historyDir, { withFileTypes: true })
    .filter(d => d.isFile())
    .map(d => d.name);

  const candidates = files
    .map(name => {
      const m = name.match(/^kakao_webtoon_top20_(\d{4}-\d{2}-\d{2})\.json$/);
      return m ? m[1] : null;
    })
    .filter(Boolean)
    .filter(date => date < currentDateText)
    .sort();

  if (!candidates.length) return null;

  try {
    return JSON.parse(fs.readFileSync(getHistoryFilePath(historyDir, candidates[candidates.length - 1]), 'utf8'));
  } catch (e) {
    return null;
  }
}

// ─── CSV ─────────────────────────────────────────────────────────────────────
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

function appendRowsToMaster(masterCsvPath, rows) {
  const header = [
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
    'rank_change',
    'stay_days',
    'serial_info',
    'series_id',
    'detail_url',
    'cover_url',
  ];

  const exists = fs.existsSync(masterCsvPath);
  const existingKeys = new Set();

  if (exists) {
    const raw = fs.readFileSync(masterCsvPath, 'utf8').replace(/^\uFEFF/, '');
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

    linesToAppend.push(header.map(h => csvEscape(row[h])).join(','));
  }

  if (!exists) {
    fs.writeFileSync(
      masterCsvPath,
      '\ufeff' + header.join(',') + (linesToAppend.length ? '\n' + linesToAppend.join('\n') : '') + '\n',
      'utf8'
    );
    return linesToAppend.length;
  }

  if (linesToAppend.length) {
    fs.appendFileSync(masterCsvPath, linesToAppend.join('\n') + '\n', 'utf8');
  }

  return linesToAppend.length;
}

// ─── 랭킹 추출 ───────────────────────────────────────────────────────────────
async function extractTop20FromPage(page) {
  return await page.evaluate((topN) => {
    function clean(v) {
      return String(v ?? '').replace(/\u200b/g, '').replace(/\s+/g, ' ').trim();
    }

    const results = [];
    const usedRanks = new Set();
    const cards = Array.from(document.querySelectorAll('[aria-label*="랭킹"][aria-label*="위"]'));

    for (let cardIndex = 0; cardIndex < cards.length; cardIndex++) {
      const card = cards[cardIndex];

      const label = clean(card.getAttribute('aria-label') || '');
      if (!label) continue;

      const rankMatch = label.match(/랭킹\s*(\d+)위/);
      if (!rankMatch) continue;

      const rank = Number(rankMatch[1]);
      if (!rank || rank < 1 || rank > topN) continue;
      if (usedRanks.has(rank)) continue;

      const parts = label.split(',').map(v => clean(v));

      let title = '';
      if (parts.length >= 2 && parts[0] === '작품') {
        title = clean(parts[1]);
      }

      if (!title) continue;

      const adultYn = label.includes('19세 연령 제한') ? 'Y' : 'N';

      let rankChange = '-';

      if (label.includes('신작')) {
        rankChange = 'NEW';
      } else if (label.includes('변동 없음')) {
        rankChange = '-';
      } else {
        const upMatch = label.match(/(\d+)단계\s*상승/);
        const downMatch = label.match(/-?(\d+)단계\s*하락/);

        if (upMatch) rankChange = `▲${upMatch[1]}`;
        else if (downMatch) rankChange = `▼${downMatch[1]}`;
      }

      let seriesId = '';
      let genre = '';

      try {
        const dataObj = card.getAttribute('data-t-obj');

        if (dataObj) {
          const parsed = JSON.parse(dataObj.replace(/&quot;/g, '"'));
          seriesId = String(parsed?.eventMeta?.id || '');
          genre = clean(parsed?.eventMeta?.subcategory || '');
        }
      } catch (e) {}

      const anchor = card.querySelector('a[href]') || (card.tagName === 'A' ? card : null);

      let detailUrl = '';

      if (anchor) {
        detailUrl = anchor.href || '';
      } else if (seriesId) {
        detailUrl = `https://page.kakao.com/content/${seriesId}`;
      }

      results.push({
        rank,
        title,
        genre,
        adultYn,
        seriesId,
        detailUrl,
        cardIndex,
        coverUrl: '',
      });

      usedRanks.add(rank);
    }

    return results.sort((a, b) => a.rank - b.rank);
  }, TOP_N);
}

async function captureCoverImagesFromRankingPage(page, top20) {
  const cards = page.locator('[aria-label*="랭킹"][aria-label*="위"]');
  const cardCount = await cards.count().catch(() => 0);

  console.log(`표지 이미지 캡쳐 후보 카드 수: ${cardCount}`);

  for (const item of top20) {
    const idx = Number.isInteger(item.cardIndex) ? item.cardIndex : -1;

    if (idx < 0 || idx >= cardCount) {
      console.log(`  표지 캡쳐 스킵: ${item.rank}위 / ${item.title} - 카드 인덱스 없음`);
      continue;
    }

    try {
      const card = cards.nth(idx);

      await card.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(150);

      let target = card.locator('img').first();

      if (!(await target.count().catch(() => 0))) {
        target = card;
      }

      const buffer = await target.screenshot({
        type: 'jpeg',
        quality: 55,
        timeout: 10000,
      });

      const base64 = buffer.toString('base64');

      if (base64) {
        item.coverUrl = `data:image/jpeg;base64,${base64}`;
        console.log(`  표지 캡쳐 완료: ${item.rank}위 / ${item.title} (${Math.round(base64.length / 1024)}KB)`);
      }
    } catch (e) {
      console.log(`  표지 캡쳐 실패: ${item.rank}위 / ${item.title} - ${e.message}`);
    }
  }

  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
  await page.waitForTimeout(300).catch(() => {});
}

// ─── 상세페이지 로드 및 메타 추출 ───────────────────────────────────────────
// ① 홈 탭: 연재정보 + 장르
// ② 정보 탭(about): 글/그림 작가
async function loadDetailMeta(page, detailUrl) {
  const homeUrl = detailUrl.replace(/[?&]tab_type=[^&]*/g, '');

  // ① 홈 탭
  await page.goto(homeUrl, {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });

  try {
    await page.waitForLoadState('networkidle', { timeout: 5000 });
  } catch (e) {}

  await page.waitForTimeout(1500);

  const homeMeta = await page.evaluate(() => {
    function clean(v) {
      return String(v ?? '').replace(/\u200b/g, '').replace(/\s+/g, ' ').trim();
    }

    const allLines = document.body.innerText.split('\n').map(clean).filter(Boolean);

    let serialRaw = '';
    let genre = '';

    for (const line of allLines.slice(0, 40)) {
      if (!serialRaw && /^([월화수목금토일](?:\s*[,、]\s*[월화수목금토일])*)\s*연재$/.test(line)) {
        serialRaw = line;
      }

      if (!serialRaw && /^완결$/.test(line)) {
        serialRaw = '완결';
      }

      if (!serialRaw && /^매일\s*연재$/.test(line)) {
        serialRaw = '매일';
      }

      if (!genre && /^웹툰(로판|판타지|액션|무협|드라마|일상|스릴러|개그|BL|로맨스|SF|스포츠|공포|추리|감성)$/.test(line)) {
        genre = line.replace(/^웹툰/, '').trim();
      }
    }

    return { serialRaw, genre, bodyText: allLines.join(' ') };
  });

  // ② 정보 탭(about)
  const aboutUrl = homeUrl + '?tab_type=about';

  await page.goto(aboutUrl, {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });

  try {
    await page.waitForLoadState('networkidle', { timeout: 5000 });
  } catch (e) {}

  await page.waitForTimeout(1500);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(1000);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(800);

  return await page.evaluate((homeMeta) => {
    function clean(v) {
      return String(v ?? '').replace(/\u200b/g, '').replace(/\s+/g, ' ').trim();
    }

    const allLines = document.body.innerText.split('\n').map(clean).filter(Boolean);

    let writer = '';
    let artist = '';
    let genre = homeMeta.genre || '';
    const serialRaw = homeMeta.serialRaw || '';
    const homeBodyText = homeMeta.bodyText || '';

    // 상세정보 섹션에서 글/그림 파싱
    for (let i = 0; i < allLines.length; i++) {
      if (allLines[i] === '상세정보') {
        for (let j = i + 1; j < Math.min(allLines.length, i + 20); j++) {
          const cur = allLines[j];
          const next = clean(allLines[j + 1] || '');

          if (cur === '글') {
            writer = next;
            j++;
            continue;
          }

          if (cur === '그림') {
            artist = next;
            j++;
            continue;
          }

          if (cur === '분류' && !genre) {
            genre = next.replace(/^웹툰/, '').trim();
            j++;
            continue;
          }

          if (cur === '발행자' || cur === '연령등급') break;
        }

        break;
      }
    }

    // 글/그림 못 찾으면 홈탭 구조에서 보완
    if (!writer) {
      const GENRE_PATTERN = /^웹툰(로판|판타지|액션|무협|드라마|일상|스릴러|개그|BL|로맨스|SF|스포츠|공포|추리|감성)$/;

      for (let i = 0; i < Math.min(allLines.length, 30); i++) {
        if (GENRE_PATTERN.test(allLines[i]) && i > 0) {
          const candidate = clean(allLines[i - 1]);

          if (
            candidate &&
            candidate.length <= 60 &&
            !/^\d/.test(candidate) &&
            !/조회|별점|연재|화|완결|무료|탭/.test(candidate)
          ) {
            writer = candidate;
            artist = candidate;
          }

          break;
        }
      }
    }

    return { writer, artist, genre, serialRaw, bodyText: [homeBodyText, allLines.join(' ')].filter(Boolean).join(' ') };
  }, homeMeta);
}

// ─── 스크롤 ──────────────────────────────────────────────────────────────────
async function autoScroll(page) {
  for (let i = 0; i < 5; i++) {
    await page.evaluate(() => window.scrollBy(0, 800));
    await page.waitForTimeout(800);
  }

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(500);
}

// ─── 메인 ────────────────────────────────────────────────────────────────────
(async () => {
  const baseDir = __dirname;
  const outputDir = path.join(baseDir, 'output_kakao');
  const historyDir = path.join(outputDir, 'history');
  const masterDir = path.join(outputDir, 'master');
  const authFile = path.join(baseDir, '.auth', 'kakao_auth.json');
  const dateText = getTodayText();

  ensureDir(outputDir);
  ensureDir(historyDir);
  ensureDir(masterDir);

  const browser = await chromium.launch({
    headless: true,
  });

  const contextOptions = {
    viewport: { width: 1440, height: 900 },
    locale: 'ko-KR',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  };

  if (fs.existsSync(authFile)) {
    contextOptions.storageState = authFile;
    console.log('카카오 로그인 세션 로드됨');
  } else {
    console.log('⚠️  카카오 로그인 세션 없음 - 성인 작품은 제한될 수 있습니다');
  }

  const context = await browser.newContext(contextOptions);

  try {
    const listPage = await context.newPage();
    const detailPage = await context.newPage();

    console.log(`랭킹 페이지 접속: ${RANKING_URL}`);

    await listPage.goto(RANKING_URL, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    try {
      await listPage.waitForLoadState('networkidle', { timeout: 8000 });
    } catch (e) {}

    await listPage.waitForTimeout(2500);

    // 웹툰 탭 강제 클릭
    try {
      const webtoonTab = await listPage.$('[role="tab"]:has-text("웹툰")');

      if (webtoonTab) {
        await webtoonTab.click();
        await listPage.waitForTimeout(1500);
        console.log('웹툰 탭 클릭 완료');
      }
    } catch (e) {}

    // 실시간 랭킹 탭 강제 클릭
    try {
      const rankingTab = await listPage.$('[role="tab"]:has-text("실시간 랭킹")');

      if (rankingTab) {
        await rankingTab.click();
        await listPage.waitForTimeout(1500);
        console.log('실시간 랭킹 탭 클릭 완료');
      }
    } catch (e) {}

    await autoScroll(listPage);

    let top20 = await extractTop20FromPage(listPage);

    if (top20.length < TOP_N) {
      console.log(`재시도 중... (현재 ${top20.length}개)`);
      await listPage.waitForTimeout(2000);
      await autoScroll(listPage);
      top20 = await extractTop20FromPage(listPage);
    }

    top20 = top20
      .filter(row => row.rank >= 1 && row.rank <= TOP_N)
      .sort((a, b) => Number(a.rank) - Number(b.rank))
      .slice(0, TOP_N);

    console.log(`카카오페이지 웹툰 추출 순위 수: ${top20.length}`);
    top20.forEach(r => console.log(`  ${r.rank}위: ${r.title} (${r.rankChange || '-'})`));

    if (top20.length === 0) {
      throw new Error('카카오페이지 랭킹 목록을 찾지 못했습니다.');
    }

    await captureCoverImagesFromRankingPage(listPage, top20);

    // 히스토리 로드
    const previousRows = readLatestPreviousHistory(historyDir, dateText) || [];
    const hasPrevSnapshot = previousRows.length > 0;
    const prevMap = new Map(previousRows.map(row => [cleanText(row.title).toLowerCase(), row]));

    const rows = [];

    for (const item of top20) {
      console.log(`상세 조회 중: ${item.rank}위 / ${item.title}`);

      let writer = '';
      let artist = '';
      let genre = item.genre || '';
      let serialRaw = '';
      let detailTextForLaunch = '';

      const detailUrl = item.detailUrl || (item.seriesId ? `https://page.kakao.com/content/${item.seriesId}` : '');

      if (detailUrl) {
        try {
          const meta = await loadDetailMeta(detailPage, detailUrl);

          if (meta.writer) writer = meta.writer;
          if (meta.artist) artist = meta.artist;
          if (meta.serialRaw) serialRaw = meta.serialRaw;
          if (!genre && meta.genre) genre = meta.genre;
          if (meta.bodyText) detailTextForLaunch = meta.bodyText;
        } catch (e) {
          console.log(`  상세 조회 실패: ${e.message}`);
        }
      }

      const writerText = writer || '미확인';
      const artistText = artist || writer || '미확인';

      const titleKey = cleanText(item.title).toLowerCase();
      const prevRow = prevMap.get(titleKey);
      const stayDays = prevRow ? Number(prevRow.stay_days || 0) + 1 : 1;
      const launchDate = extractLaunchDateFromText(detailTextForLaunch, dateText);
      const newInfo = getNewInfo(dateText, launchDate);

      if (launchDate) {
        console.log(` 런칭일 추정: ${item.rank}위 / ${item.title} / ${launchDate} / 신작=${newInfo.new_yn}`);
      } else {
        console.log(` 런칭일 미확인: ${item.rank}위 / ${item.title}`);
      }

      // 순위 변화: 전일 히스토리와 비교
      let rankChange;

      if (!hasPrevSnapshot) {
        rankChange = '기준없음';
      } else if (!prevRow) {
        rankChange = 'NEW';
      } else {
        const prevRank = Number(prevRow.rank);
        const curRank = Number(item.rank);

        if (prevRank === curRank) rankChange = '-';
        else if (prevRank > curRank) rankChange = `▲${prevRank - curRank}`;
        else rankChange = `▼${curRank - prevRank}`;
      }

      rows.push({
        collect_date: dateText,
        category_key: 'webtoon',
        category_label: '웹툰',
        rank: item.rank,
        title: normalizeOutputTitle(item.title),
        writer: writerText,
        artist: artistText,
        genre_norm: normalizeGenre(genre),
        adult_yn: item.adultYn,
        launch_date: newInfo.launch_date,
        new_yn: newInfo.new_yn,
        new_days: newInfo.new_days,
        rank_change: rankChange,
        stay_days: stayDays,
        serial_info: normalizeSerialInfo(serialRaw),
        series_id: item.seriesId || '',
        detail_url: detailUrl,
        cover_url: item.coverUrl || '',
      });
    }

    // ── CSV 저장 ──
    const csvHeader = [
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
      'rank_change',
      'stay_days',
      'serial_info',
      'series_id',
      'detail_url',
      'cover_url',
    ];

    const csvLines = [csvHeader.join(',')];

    for (const row of rows) {
      csvLines.push(csvHeader.map(h => csvEscape(row[h])).join(','));
    }

    const csvPath = path.join(outputDir, `kakao_webtoon_top20_${dateText}.csv`);
    writeUtf8Bom(csvPath, csvLines.join('\n'));

    // ── 미리보기 TXT ──
    const previewLines = rows.map(r => {
      const authorPart = r.writer === r.artist
        ? `글그림 ${r.writer}`
        : `글 ${r.writer} / 그림 ${r.artist}`;

      return `${r.rank}. ${r.title} / ${authorPart} / ${r.genre_norm} / 성인 ${r.adult_yn} / 변화 ${r.rank_change} / 체류 ${r.stay_days}일 / ${r.serial_info}`;
    });

    const previewPath = path.join(outputDir, `kakao_webtoon_top20_preview_${dateText}.txt`);
    writeUtf8Bom(previewPath, previewLines.join('\n'));

    // ── 히스토리 JSON ──
    writeJson(getHistoryFilePath(historyDir, dateText), rows);

    // ── 누적 마스터 CSV ──
    const masterCsvPath = path.join(masterDir, 'kakao_top20_master.csv');
    const appendedCount = appendRowsToMaster(masterCsvPath, rows);

    console.log(`\n완료: 카카오페이지 웹툰`);
    console.log(`CSV 저장: ${csvPath}`);
    console.log(`미리보기 저장: ${previewPath}`);
    console.log(`히스토리 저장: ${getHistoryFilePath(historyDir, dateText)}`);
    console.log(`누적 CSV 저장: ${masterCsvPath}`);
    console.log(`이번 실행 누적 추가 건수: ${appendedCount}`);

    await listPage.close();
    await detailPage.close();
  } catch (error) {
    console.error('오류 발생:', error);
  } finally {
    await browser.close();
  }
})();