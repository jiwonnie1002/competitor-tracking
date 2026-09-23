console.log('RIDI NEW LABEL VERSION: 2026-07-07-v9-daily-csv-header-fix');
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const CATEGORY_CONFIGS = [
  {
    key: 'webtoon',
    label: '웹툰',
    listUrl: 'https://ridibooks.com/bestsellers/webtoon?order=daily&page=1'
  },
  {
    key: 'bl_webtoon',
    label: 'BL웹툰',
    listUrl: 'https://ridibooks.com/bestsellers/bl-webtoon?order=daily&page=1'
  }
];

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

function cleanText(value) {
  return String(value ?? '').replace(/\u200b/g, '').replace(/\s+/g, ' ').trim();
}

function normalizeOutputTitle(raw) {
  return cleanText(raw)
    .replace(/\s*-\s*리디에만 있는 독점 작품!?$/i, '')
    .replace(/\s*리디에만 있는 독점 작품!?$/i, '')
    .replace(/\s*-\s*RIDI ONLY!?$/i, '')
    .replace(/\s*RIDI ONLY!?$/i, '')
    .replace(/\s*[-–—]?\s*절찬리\s*연재\s*중!?$/i, '')
    .replace(/\s*[-–—]?\s*절찬리\s*연재중!?$/i, '')
    .replace(/\s*신고\s*차단\s*및.*$/i, '')
    .trim();
}

function isBadRidiTitle(title) {
  const t = cleanText(title);

  if (!t || t.length < 2 || t.length > 120) return true;
  if (/^\d{4}[.\-/]\d{1,2}[.\-/]\d{1,2}/.test(t)) return true;
  if (/신고\s*차단|차단\s*및|고객센터|업데이트|파일\s*정보|ISBN|UCI|출간\s*정보|듣기\s*기능|지원\s*환경/i.test(t)) return true;
  if (/^(리디|RIDI|웹툰|BL웹툰|만화|성인|연재|완결|업데이트|출간|관심|별점|전체)$/i.test(t)) return true;

  return false;
}

function splitLines(value) {
  return String(value ?? '').split('\n').map(cleanText).filter(Boolean);
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
  const d = new Date(new Date().getTime() + 9 * 60 * 60 * 1000);
  d.setUTCDate(d.getUTCDate() - 1);

  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');

  return `${yyyy}-${mm}-${dd}`;
}

function stripMetaTailNode(text) {
  return cleanText(text).replace(/\s+\(([^()]*)\)\s*$/, '').trim();
}

function canonicalTitleNode(text) {
  return stripMetaTailNode(text)
    .toLowerCase()
    .replace(/[\s"'`~!@#$%^&*()\-_=+\[\]{}|\\;:,.<>\/?·ㆍ•]/g, '');
}

function makeSearchQueries(title) {
  const base = cleanText(title);
  const variants = new Set();

  if (base) variants.add(base);

  const noBracket = cleanText(base.replace(/\s+\[[^\]]+\]\s*$/g, ''));
  if (noBracket) variants.add(noBracket);

  const noParen = cleanText(base.replace(/\s+\([^)]*\)\s*$/g, ''));
  if (noParen) variants.add(noParen);

  const noBoth = cleanText(
    base
      .replace(/\s+\[[^\]]+\]\s*$/g, '')
      .replace(/\s+\([^)]*\)\s*$/g, '')
  );
  if (noBoth) variants.add(noBoth);

  return Array.from(variants).filter(Boolean);
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

function extractRidiPublishDateFromText(rawText, baseDateText) {
  const text = cleanText(rawText).replace(/\s+/g, ' ');
  if (!text) return '';

  const labelRe = /(출간\s*정보|출간일|발행일|발행\s*정보)/gi;
  let m;

  while ((m = labelRe.exec(text)) !== null) {
    const afterOnly = text.slice(m.index, Math.min(text.length, m.index + 140));
    const date = findLaunchDateCandidateInText(afterOnly, baseDateText);
    if (date) return date;
  }

  return '';
}

function extractLaunchDateFromText(rawText, baseDateText) {
  const text = cleanText(rawText).replace(/\s+/g, ' ');
  if (!text) return '';

  const publishDate = extractRidiPublishDateFromText(text, baseDateText);
  if (publishDate) return publishDate;

  const publishKeywordRe = /(출간일|출간|발행일|발행|등록일|게시일)/gi;
  let pm;

  while ((pm = publishKeywordRe.exec(text)) !== null) {
    const afterOnly = text.slice(pm.index, Math.min(text.length, pm.index + 140));
    const date = findLaunchDateCandidateInText(afterOnly, baseDateText);
    if (date) return date;
  }

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
  if (/BL|보이즈러브|비엘/.test(text)) return 'BL';
  if (/GL|백합/.test(text)) return 'GL';
  if (/로맨스|순정|연애|로판/.test(text)) return '로맨스';
  if (/판타지|현대판타지|게임판타지|SF|초능력|이세계|회귀|귀환|환생|빙의|헌터|던전|마법|용사|마왕|괴수|레벨업|시스템|아포칼립스|전생|이능력/.test(text)) return '판타지';
  if (/액션|스포츠|히어로|범죄|느와르|누아르|첩보|격투|전쟁|검술/.test(text)) return '액션';
  if (/일상|에피소드|힐링|먹방|요리|반려|육아|브이로그|직장생활|학교생활/.test(text)) return '일상';
  if (/스릴러|공포|미스터리|호러|서스펜스|추리|심리|데스게임|재난|서바이벌/.test(text)) return '스릴러';
  if (/개그|코미디|병맛|블랙코미디/.test(text)) return '개그';
  if (/무협|선협|사극|강호|협객|검협/.test(text)) return '무협';
  if (/드라마|학원|성장|감성|복수|오피스|가족|청춘|휴먼|캠퍼스/.test(text)) return '드라마';

  return '기타';
}

function toFullWeekday(text) {
  const t = cleanText(text);
  const m = t.match(/^([월화수목금토일])(?:요일)?$/);
  if (!m) return t;
  return `${m[1]}요일`;
}

function formatMonthlyDays(daysRaw) {
  const nums = cleanText(daysRaw)
    .split(',')
    .map(v => cleanText(v).replace(/일/g, ''))
    .filter(Boolean);

  if (!nums.length) return '미확인';

  return `매월 ${nums.map(v => `${v}일`).join(', ')}`;
}

function normalizeSerialInfo(raw) {
  const text = cleanText(raw)
    .replace(/^#/, '')
    .replace(/^\[|\]$/g, '')
    .replace(/^연재정보\s*[:：]?\s*/i, '')
    .replace(/^업데이트\s*[:：]?\s*/i, '')
    .replace(/^연재\s*[:：]?\s*/i, '')
    .trim();

  if (!text || text === '미확인') return '-';
  if (/총\s*\d+화\s*완결/.test(text) || /^완결$/.test(text)) return '완결';
  if (/^연재중$|^연재 중$|^#연재중$|^#연재 중$/.test(text)) return '-';

  let m = text.match(/매주\s*([월화수목금토일])(?:요일)?\s*(?:업데이트|연재)\s*및\s*(\d+주)\s*연재\s*(\d+주)\s*휴재(?:\s*진행)?/);
  if (m) return `매주 ${toFullWeekday(m[1])} (${m[2]} 연재 + ${m[3]} 휴재)`;

  m = text.match(/매주\s*([월화수목금토일]요일)\s*(?:업데이트|연재)\s*및\s*(\d+주)\s*연재\s*(\d+주)\s*휴재(?:\s*진행)?/);
  if (m) return `매주 ${m[1]} (${m[2]} 연재 + ${m[3]} 휴재)`;

  m = text.match(/매주\s*([월화수목금토일](?:요일)?(?:\s*[,/]\s*[월화수목금토일](?:요일)?)*)\s*(?:업데이트|연재)/);
  if (m) {
    const days = m[1]
      .split(/[,\/]/)
      .map(v => toFullWeekday(cleanText(v)))
      .filter(Boolean)
      .join(', ');

    return `매주 ${days}`;
  }

  m = text.match(/([월화수목금토일](?:요일)?(?:\s*[,/]\s*[월화수목금토일](?:요일)?)*)\s*(?:업데이트|연재)/);
  if (m) {
    const days = m[1]
      .split(/[,\/]/)
      .map(v => toFullWeekday(cleanText(v)))
      .filter(Boolean)
      .join(', ');

    return `매주 ${days}`;
  }

  m = text.match(/격주\s*([월화수목금토일])(?:요일)?/);
  if (m) return `격주 ${toFullWeekday(m[1])}`;

  m = text.match(/격주\s*([월화수목금토일]요일)/);
  if (m) return `격주 ${m[1]}`;

  if (/매일\s*(업데이트|연재)?/.test(text)) return '매일';

  m = text.match(/매월\s*([\d,\s]+)일?\s*(?:업데이트|연재)?/);
  if (m) return formatMonthlyDays(m[1]);

  m = text.match(/(\d+)\s*일\s*주기\s*\(?\s*([\d,\s]+)일?\s*\)?\s*(?:업데이트|연재)?/);
  if (m) {
    const nums = cleanText(m[2])
      .split(',')
      .map(v => cleanText(v).replace(/일/g, ''))
      .filter(Boolean);

    if (nums.length) return `${m[1]}일 주기(${nums.map(v => `${v}일`).join(',')})`;
    return `${m[1]}일 주기`;
  }

  if (/휴재/.test(text)) return '휴재 중';
  if (/비정기/.test(text)) return '비정기';
  if (/총\s*\d+화/.test(text) && /완결/.test(text)) return '완결';

  return '-';
}

function getHistoryFilePath(historyDir, categoryKey, dateText) {
  return path.join(historyDir, `ridi_${categoryKey}_top20_${dateText}.json`);
}

function readLatestPreviousHistory(historyDir, categoryKey, currentDateText) {
  if (!fs.existsSync(historyDir)) return null;

  const files = fs
    .readdirSync(historyDir, { withFileTypes: true })
    .filter(d => d.isFile())
    .map(d => d.name);

  const candidates = files
    .map(name => {
      const m = name.match(new RegExp(`^ridi_${categoryKey}_top20_(\\d{4}-\\d{2}-\\d{2})\\.json$`));
      return m ? m[1] : null;
    })
    .filter(Boolean)
    .filter(date => date < currentDateText)
    .sort();

  if (!candidates.length) return null;

  try {
    return JSON.parse(
      fs.readFileSync(
        getHistoryFilePath(historyDir, categoryKey, candidates[candidates.length - 1]),
        'utf8'
      )
    );
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

function migrateRidiMasterCsvHeaderIfNeeded(masterCsvPath, targetHeader) {
  if (!fs.existsSync(masterCsvPath)) return;

  const raw = fs.readFileSync(masterCsvPath, 'utf8').replace(/^\uFEFF/, '');
  const lines = raw.split(/\r?\n/).filter(Boolean);
  if (!lines.length) return;

  const currentHeader = parseCsvLine(lines[0]).map(cleanText);
  const currentHeaderKey = currentHeader.join('||');
  const targetHeaderKey = targetHeader.join('||');

  if (currentHeaderKey === targetHeaderKey) return;

  const hasNewColumns =
    currentHeader.includes('launch_date') &&
    currentHeader.includes('new_yn') &&
    currentHeader.includes('new_days');

  const canMigrate =
    currentHeader.includes('collect_date') &&
    currentHeader.includes('category_key') &&
    currentHeader.includes('rank') &&
    currentHeader.includes('title') &&
    currentHeader.includes('adult_yn') &&
    currentHeader.includes('bl_yn') &&
    currentHeader.includes('cover_url');

  if (!canMigrate) {
    console.log('RIDI master 헤더 자동 보정 스킵: 예상 컬럼 구조가 아님');
    console.log('현재 master 헤더: ' + currentHeader.join(', '));
    return;
  }

  const migratedLines = [targetHeader.join(',')];

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    if (!cols.length) continue;

    let migrated;

    // 과거 master 헤더는 15개였는데, 신작 컬럼 값 3개가 이미 붙어 18개 값으로 append된 경우 보정
    if (!hasNewColumns && cols.length >= 18) {
      const mapped = {
        collect_date: cols[0] || '',
        category_key: cols[1] || '',
        category_label: cols[2] || '',
        rank: cols[3] || '',
        title: cols[4] || '',
        writer: cols[5] || '',
        artist: cols[6] || '',
        genre_norm: cols[7] || '',
        adult_yn: cols[8] || '',
        launch_date: cols[9] || '',
        new_yn: cols[10] || 'N',
        new_days: cols[11] || '',
        bl_yn: cols[12] || '',
        rank_change: cols[13] || '',
        stay_days: cols[14] || '',
        serial_info: cols[15] || '',
        detail_url: cols[16] || '',
        cover_url: cols[17] || ''
      };

      migrated = targetHeader.map(h => mapped[h] || '');
    } else {
      const mapped = {};
      currentHeader.forEach((h, idx) => {
        mapped[h] = cols[idx] || '';
      });

      migrated = targetHeader.map(h => {
        if (h === 'launch_date') return mapped.launch_date || '';
        if (h === 'new_yn') return mapped.new_yn || 'N';
        if (h === 'new_days') return mapped.new_days || '';
        return mapped[h] || '';
      });
    }

    migratedLines.push(migrated.map(csvEscape).join(','));
  }

  writeUtf8Bom(masterCsvPath, migratedLines.join('\n') + '\n');
  console.log('RIDI master 헤더 보정 완료: launch_date/new_yn/new_days 컬럼 반영');
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
    'bl_yn',
    'rank_change',
    'stay_days',
    'serial_info',
    'detail_url',
    'cover_url'
  ];

  migrateRidiMasterCsvHeaderIfNeeded(masterCsvPath, header);

  const exists = fs.existsSync(masterCsvPath);
  const existingKeys = new Set();

  if (exists) {
    const raw = fs.readFileSync(masterCsvPath, 'utf8').replace(/^\uFEFF/, '');
    const lines = raw.split(/\r?\n/).filter(Boolean);

    for (let i = 1; i < lines.length; i++) {
      const cols = parseCsvLine(lines[i]);
      if (cols.length < 6) continue;

      existingKeys.add([
        cleanText(cols[0]),
        cleanText(cols[1]),
        cleanText(cols[3]),
        cleanText(cols[4]).toLowerCase()
      ].join('||'));
    }
  }

  const linesToAppend = [];

  for (const row of rows) {
    const key = [
      cleanText(row.collect_date),
      cleanText(row.category_key),
      cleanText(row.rank),
      cleanText(row.title).toLowerCase()
    ].join('||');

    if (existingKeys.has(key)) continue;

    existingKeys.add(key);

    linesToAppend.push([
      csvEscape(row.collect_date),
      csvEscape(row.category_key),
      csvEscape(row.category_label),
      csvEscape(row.rank),
      csvEscape(row.title),
      csvEscape(row.writer),
      csvEscape(row.artist),
      csvEscape(row.genre_norm),
      csvEscape(row.adult_yn),
      csvEscape(row.launch_date),
      csvEscape(row.new_yn),
      csvEscape(row.new_days),
      csvEscape(row.bl_yn),
      csvEscape(row.rank_change),
      csvEscape(row.stay_days),
      csvEscape(row.serial_info),
      csvEscape(row.detail_url),
      csvEscape(row.cover_url)
    ].join(','));
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

function isWeakDetailMeta(meta) {
  return (
    (!meta.writer || meta.writer === '미확인') &&
    (!meta.artist || meta.artist === '미확인') &&
    (!meta.genreRaw || meta.genreRaw === '미확인') &&
    (!meta.serialRaw || meta.serialRaw === '미확인')
  );
}

async function autoScrollForRanking(page) {
  for (let i = 0; i < 8; i++) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1200);
  }

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(1000);
}

async function extractTop20FromListPage(page) {
  return await page.evaluate(() => {
    function clean(v) {
      return String(v ?? '').replace(/\u200b/g, '').replace(/\s+/g, ' ').trim();
    }

    function isNoise(t) {
      return (
        !t ||
        t.length < 1 ||
        /^(오늘의 베스트|주간 베스트|월간 베스트|필터|성인|성인 제외|대여|완결|Image|NEW|UP|RIDI ONLY|R ONLY|이전 페이지|다음 페이지|고객센터|공지사항|서비스|회사 소개|인재채용)$/i.test(t) ||
        /^총 \d+화/.test(t) ||
        /^대여 /.test(t) ||
        /^소장 /.test(t) ||
        /^\d+원$/.test(t) ||
        /로그인|회원가입|캐시충전|알림|카트|내 서재|마이리디|제휴카드|뷰어 다운로드|CP사이트/.test(t)
      );
    }

    function isMeta(t) {
      return (
        /^\d{1,3}$/.test(t) ||
        /^\d+\.\d+$/.test(t) ||
        /^\(\d[\d,]*\)$/.test(t) ||
        /^총 \d+화/.test(t) ||
        /^대여 /.test(t) ||
        /^소장 /.test(t) ||
        /^\d+원$/.test(t) ||
        t.length > 80
      );
    }

    function extractTitleFromAuthorLine(line) {
      const t = clean(line);

      let depth = 0;
      let lastOpenIdx = -1;
      let lastCloseIdx = -1;

      for (let i = t.length - 1; i >= 0; i--) {
        if (t[i] === ')') {
          if (depth === 0) lastCloseIdx = i;
          depth++;
        } else if (t[i] === '(') {
          depth--;

          if (depth === 0) {
            lastOpenIdx = i;
            break;
          }
        }
      }

      if (lastOpenIdx < 0 || lastCloseIdx < 0) return null;

      const inside = t.slice(lastOpenIdx + 1, lastCloseIdx);
      const titlePart = clean(t.slice(0, lastOpenIdx));
      const isWorkKeyword = /^(완전판|개정판|단편선|완결판|특별판|\d+세\s*완전판|\d+세)$/.test(inside.trim());

      if (isWorkKeyword) return null;

      const hasComma = inside.includes(',');
      const isKoreanOnly = /^[가-힣㈜()\s]+$/.test(inside);

      if (!hasComma && !isKoreanOnly) return null;
      if (!titlePart || titlePart.length < 1) return null;

      return titlePart;
    }

    const rawLines = (document.body.innerText || '')
      .split('\n')
      .map(clean)
      .filter(Boolean);

    const endIdx = rawLines.findIndex(v => v === '이전 페이지' || v === '고객센터');
    const lines = endIdx >= 0 ? rawLines.slice(0, endIdx) : rawLines;

    const results = [];
    const usedRanks = new Set();
    const usedTitles = new Set();

    function addResult(rank, title) {
      const r = Number(rank);
      const t = clean(title);

      if (!r || r < 1 || r > 20 || !t || isNoise(t) || isMeta(t) || usedRanks.has(r)) return false;

      const key = t.toLowerCase();

      if (usedTitles.has(key)) return false;

      results.push({ rank: r, title: t });
      usedRanks.add(r);
      usedTitles.add(key);

      return true;
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (!/^\d{1,2}$/.test(line)) continue;

      const rank = Number(line);

      if (rank < 1 || rank > 20 || usedRanks.has(rank)) continue;

      for (let j = i + 1; j < Math.min(lines.length, i + 6); j++) {
        const candidate = clean(lines[j]);

        if (!candidate) continue;
        if (/^\d{1,2}$/.test(candidate)) break;
        if (isMeta(candidate) || isNoise(candidate)) continue;

        if (addResult(rank, candidate)) break;
      }
    }

    if (results.length < 20) {
      const capturedTitles = new Set(results.map(r => r.title.toLowerCase()));
      const extras = [];

      for (const line of lines) {
        if (!line.endsWith(')')) continue;

        const titlePart = extractTitleFromAuthorLine(line);

        if (!titlePart || isNoise(titlePart) || isMeta(titlePart) || titlePart.length < 2) continue;
        if (capturedTitles.has(titlePart.toLowerCase())) continue;

        extras.push(titlePart);
        capturedTitles.add(titlePart.toLowerCase());
      }

      let nextRank = 12;

      for (const title of extras) {
        if (nextRank > 20) break;

        while (usedRanks.has(nextRank) && nextRank <= 20) nextRank++;
        if (nextRank > 20) break;

        addResult(nextRank, title);
        nextRank++;
      }
    }

    return results.sort((a, b) => a.rank - b.rank).slice(0, 20);
  });
}

async function resolveDetailUrlOnListPage(page, rawTitle) {
  return await page.evaluate((rawTitleInner) => {
    function clean(v) {
      return String(v ?? '').replace(/\u200b/g, '').replace(/\s+/g, ' ').trim();
    }

    function splitLines(v) {
      return String(v ?? '').split('\n').map(clean).filter(Boolean);
    }

    function stripMetaTail(t) {
      return clean(t).replace(/\s*\([^)]*\)\s*$/, '').trim();
    }

    function canonical(t) {
      return stripMetaTail(t)
        .toLowerCase()
        .replace(/[\s"'`~!@#$%^&*()\-_=+\[\]{}|\\;:,.<>\/?·ㆍ•]/g, '');
    }

    function isNoiseLine(t) {
      t = clean(t);

      return (
        !t ||
        /^(오늘의 베스트|주간 베스트|월간 베스트|필터|성인|성인 제외|대여|완결|Image|NEW|UP|RIDI ONLY|R ONLY)$/i.test(t) ||
        /^총 \d+화/.test(t) ||
        /^대여 /.test(t) ||
        /^소장 /.test(t) ||
        /^\d+원$/.test(t) ||
        /로그인|회원가입|캐시충전|알림|카트|내 서재|마이리디|고객센터|서비스|제휴카드|뷰어 다운로드|CP사이트|공지사항|이전 페이지|다음 페이지|회사 소개|인재채용/.test(t)
      );
    }

    const targetRaw = stripMetaTail(rawTitleInner);
    const target = canonical(targetRaw);

    if (!target) return '';

    const candidates = [];

    Array.from(document.querySelectorAll('a[href*="/books/"]')).forEach((a, idx) => {
      const href = (a.href || '').split('?')[0];

      if (!href) return;

      const texts = new Set();

      for (const t of [a.textContent, a.innerText, a.getAttribute('aria-label'), a.getAttribute('title')]) {
        for (const line of splitLines(t || '')) {
          const v = stripMetaTail(line);
          if (v && !isNoiseLine(v)) texts.add(v);
        }
      }

      for (const img of Array.from(a.querySelectorAll('img[alt]'))) {
        const v = stripMetaTail(img.getAttribute('alt'));
        if (v && !isNoiseLine(v)) texts.add(v);
      }

      const card = a.closest('article, li, section, div');

      if (card) {
        for (const line of splitLines(card.innerText || '').slice(0, 18)) {
          const v = stripMetaTail(line);
          if (v && !isNoiseLine(v)) texts.add(v);
        }
      }

      let bestScore = 999;

      for (const txt of texts) {
        const c = canonical(txt);

        if (!c) continue;

        if (c === target) bestScore = Math.min(bestScore, 0);
        else if (c.startsWith(target) || target.startsWith(c)) bestScore = Math.min(bestScore, 1);
        else if (c.includes(target) || target.includes(c)) bestScore = Math.min(bestScore, 2);
      }

      if (bestScore < 999) {
        const rect = a.getBoundingClientRect();

        candidates.push({
          href,
          score: bestScore,
          top: rect.top + window.scrollY,
          left: rect.left + window.scrollX,
          idx
        });
      }
    });

    if (!candidates.length) return '';

    candidates.sort((a, b) => {
      if (a.score !== b.score) return a.score - b.score;

      const dy = a.top - b.top;
      if (Math.abs(dy) > 10) return dy;

      if (a.left !== b.left) return a.left - b.left;

      return a.idx - b.idx;
    });

    return candidates[0].href;
  }, rawTitle);
}

async function resolveDetailUrlBySearch(page, rawTitle) {
  const queries = makeSearchQueries(rawTitle);

  for (const query of queries) {
    const target = canonicalTitleNode(query);

    if (!target) continue;

    await page.goto(`https://ridibooks.com/search?q=${encodeURIComponent(query)}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });

    try {
      await page.waitForLoadState('networkidle', { timeout: 5000 });
    } catch (e) {}

    await page.waitForTimeout(1200);

    const resolved = await page.evaluate((targetInner) => {
      function clean(v) {
        return String(v ?? '').replace(/\u200b/g, '').replace(/\s+/g, ' ').trim();
      }

      function splitLines(v) {
        return String(v ?? '').split('\n').map(clean).filter(Boolean);
      }

      function stripMetaTail(t) {
        return clean(t).replace(/\s*\([^)]*\)\s*$/, '').trim();
      }

      function canonical(t) {
        return stripMetaTail(t)
          .toLowerCase()
          .replace(/[\s"'`~!@#$%^&*()\-_=+\[\]{}|\\;:,.<>\/?·ㆍ•]/g, '');
      }

      const candidates = [];

      Array.from(document.querySelectorAll('a[href*="/books/"]')).forEach((a, idx) => {
        const href = (a.href || '').split('?')[0];

        if (!href) return;

        const texts = new Set();

        for (const t of [a.textContent, a.innerText, a.getAttribute('aria-label'), a.getAttribute('title')]) {
          for (const line of splitLines(t || '')) {
            const v = stripMetaTail(line);
            if (v) texts.add(v);
          }
        }

        for (const img of Array.from(a.querySelectorAll('img[alt]'))) {
          const v = stripMetaTail(img.getAttribute('alt'));
          if (v) texts.add(v);
        }

        let bestScore = 999;

        for (const txt of texts) {
          const c = canonical(txt);

          if (!c) continue;

          if (c === targetInner) bestScore = Math.min(bestScore, 0);
          else if (c.startsWith(targetInner) || targetInner.startsWith(c)) bestScore = Math.min(bestScore, 1);
          else if (c.includes(targetInner) || targetInner.includes(c)) bestScore = Math.min(bestScore, 2);
        }

        if (bestScore < 999) {
          candidates.push({ href, score: bestScore, idx });
        }
      });

      if (!candidates.length) return '';

      candidates.sort((a, b) => a.score !== b.score ? a.score - b.score : a.idx - b.idx);

      return candidates[0].href;
    }, target);

    if (resolved) return resolved;
  }

  return '';
}

async function extractDetailMeta(page) {
  return await page.evaluate(() => {
    function clean(v) {
      return String(v ?? '').replace(/\u200b/g, '').replace(/\s+/g, ' ').trim();
    }

    function normalizeTitle(v) {
      return clean(v)
        .replace(/\s*-\s*리디에만 있는 독점 작품!?$/i, '')
        .replace(/\s*리디에만 있는 독점 작품!?$/i, '')
        .replace(/\s*-\s*RIDI ONLY!?$/i, '')
        .replace(/\s*RIDI ONLY!?$/i, '')
        .trim();
    }

    function splitLines(v) {
      return String(v ?? '').split('\n').map(clean).filter(Boolean);
    }

    function isVisible(el) {
      if (!el) return false;

      const s = window.getComputedStyle(el);
      const r = el.getBoundingClientRect();

      return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0;
    }

    function sanitizeAuthorName(name) {
      const v = clean(name)
        .replace(/^\d{1,4}\s+/, '')
        .replace(/,$/, '')
        .replace(/^(글|그림|원작)\s*/g, '')
        .replace(/\s*(글|그림|원작)$/g, '')
        .replace(/\s+/g, ' ')
        .trim();

      if (
        !v ||
        /웹툰|만화|로판|성인|연재|출판|관심|총 \d+화|매주|매월|별점|작가 프로필|신고\s*차단|업데이트|파일\s*정보|ISBN|UCI|출간\s*정보|듣기\s*기능|지원\s*환경/.test(v) ||
        /^\d{4}[.\-/]\d{1,2}[.\-/]\d{1,2}/.test(v) ||
        v.length > 60
      ) {
        return '';
      }

      return v;
    }

    function isPromoNoise(t) {
      t = clean(t);

      return (
        !t ||
        /^(이벤트|이벤트 더보기|추천|독점|연재|업데이트)$/.test(t) ||
        /전원 포인트|포인트|론칭|오디션|감상은|작품판|추천 작품|보러 가기|혜택 기간|더보기|즉시|할인|캐시|럽블루데이/.test(t) ||
        /202\d/.test(t)
      );
    }

    function scoreSerial(t) {
      t = clean(t);

      if (!t || isPromoNoise(t) || /^(연재정보|업데이트|연재)$/.test(t)) return 999;
      if (/총\s*\d+화\s*완결/.test(t) || /^완결$/.test(t)) return 0;
      if (/(\d+)\s*일\s*주기/.test(t)) return 1;
      if (/(매주|매월|격주|매일).*(업데이트|연재|휴재)/.test(t)) return 2;
      if (/(매주|매월|격주|매일)/.test(t)) return 3;
      if (/([월화수목금토일](?:요일)?)\s*(업데이트|연재)/.test(t)) return 4;
      if (/휴재\s*중/.test(t)) return 5;

      return 999;
    }

    function pickBestSerial(lines) {
      let best = '';
      let bestScore = 999;
      let bestLen = 0;

      for (const line of lines) {
        const t = clean(line);
        const score = scoreSerial(t);

        if (score === 999) continue;

        const len = t.length;

        if (score < bestScore || (score === bestScore && len > bestLen)) {
          best = t;
          bestScore = score;
          bestLen = len;
        }
      }

      return best;
    }

    const allLines = splitLines(document.body.innerText).slice(0, 1500);
    const topLines = allLines.slice(0, 700);
    const topText = topLines.join(' ');

    let title = '';

    const ogTitle = document.querySelector('meta[property="og:title"]')?.content;

    if (ogTitle) {
      title = normalizeTitle(ogTitle);
    }

    if (!title) {
      const titleEls = Array.from(document.querySelectorAll('h1,h2'))
        .filter(isVisible)
        .map(el => normalizeTitle(el.textContent))
        .filter(v => v && v.length <= 120 && !/별점|관심|총 \d+화|출판|연재/.test(v));

      if (titleEls.length) title = titleEls[0];
    }

    if (!title) {
      title = normalizeTitle(
        topLines.find(v =>
          v &&
          v.length <= 120 &&
          !/[>›]/.test(v) &&
          !/별점|관심|총 \d+화|출판|연재|글|그림|원작/.test(v)
        ) || ''
      );
    }

    let writer = '';
    let artist = '';
    let original = '';

    const roleRegex = /([A-Za-z0-9가-힣._&()\-·ㆍ ]{1,60}?)\s*(글,\s*그림|글|그림|원작)(?=\s|$)/g;

    for (const match of topLines.slice(0, 220).join(' ').matchAll(roleRegex)) {
      const name = sanitizeAuthorName(match[1]);
      const role = clean(match[2]);

      if (!name) continue;

      if (role.includes('글') && role.includes('그림')) {
        writer = writer || name;
        artist = artist || name;
      } else if (role === '글') {
        writer = writer || name;
      } else if (role === '그림') {
        artist = artist || name;
      } else if (role === '원작') {
        original = original || name;
      }
    }

    if (!writer || !artist) {
      for (const line of topLines.slice(0, 180)) {
        const m1 = line.match(/^(.+?)\s+글\s+(.+?)\s+그림$/);

        if (m1) {
          writer = writer || sanitizeAuthorName(m1[1]);
          artist = artist || sanitizeAuthorName(m1[2]);
        }

        const m2 = line.match(/^(.+?)\s+글,\s*그림$/);

        if (m2) {
          const s = sanitizeAuthorName(m2[1]);
          writer = writer || s;
          artist = artist || s;
        }
      }
    }

    if (!writer && !artist && original) {
      writer = original;
      artist = original;
    } else {
      if (!writer && artist) writer = artist;
      if (!artist && writer) artist = writer;
    }

    writer = writer || '미확인';
    artist = artist || '미확인';

    let genreRaw = '';

    const genreKeywords = [
      'BL',
      'GL',
      '백합',
      '로맨스',
      '로판',
      '순정',
      '판타지',
      '현대판타지',
      '게임판타지',
      'SF',
      '무협',
      '선협',
      '액션',
      '드라마',
      '일상',
      '스릴러',
      '개그',
      '공포',
      '추리',
      '스포츠',
      '학원',
      '성장',
      '힐링',
      '감성',
      '사극',
      '코미디',
      '호러',
      '서스펜스',
      'BL 웹툰'
    ];

    for (const line of topLines.slice(0, 30)) {
      if (/[>›]/.test(line)) {
        const parts = line.split(/[>›]/).map(clean).filter(Boolean);

        if (parts.length >= 2) {
          const candidate = parts[parts.length - 1];

          if (genreKeywords.some(k => candidate.includes(k))) {
            genreRaw = candidate;
            break;
          }
        }
      }
    }

    if (!genreRaw) {
      for (let i = 0; i < Math.min(topLines.length, 30); i++) {
        if (topLines[i] === '웹툰' && i + 1 < topLines.length) {
          const next = clean(topLines[i + 1]);

          if (genreKeywords.includes(next)) {
            genreRaw = next;
            break;
          }
        }
      }
    }

    if (!genreRaw) {
      for (const line of topLines.slice(0, 50)) {
        const cleaned = clean(line).replace(/^#/, '');

        if (genreKeywords.includes(cleaned)) {
          genreRaw = cleaned;
          break;
        }
      }
    }

    if (!genreRaw) {
      const gm = topText.match(/(로판|BL 웹툰|BL|GL|백합|로맨스|판타지|현대판타지|액션|일상|스릴러|개그|무협|드라마|순정|사극|SF|공포|추리)/);

      if (gm) genreRaw = clean(gm[1]);
    }

    if (!genreRaw) genreRaw = '미확인';

    const serialCandidates = [];

    for (let i = 0; i < allLines.length - 1; i++) {
      const prev = clean(allLines[i - 1] || '');
      const cur = clean(allLines[i]);
      const next = clean(allLines[i + 1]);

      if (/^(연재정보|업데이트|연재)$/.test(cur) && next && !isPromoNoise(next)) {
        serialCandidates.push(next);
      }

      if (/^연재정보\s*[:：]\s*(.+)$/.test(cur)) {
        const v = cur.replace(/^연재정보\s*[:：]\s*/i, '');

        if (!isPromoNoise(v)) serialCandidates.push(v);
      }

      if (/총\s*\d+화/.test(cur) && /^완결$/.test(next)) {
        serialCandidates.push('완결');
      }

      if (/^완결$/.test(cur) && /총\s*\d+화/.test(prev)) {
        serialCandidates.push('완결');
      }
    }

    serialCandidates.push(...topLines, ...allLines);

    let serialRaw = pickBestSerial(serialCandidates);

    if (!serialRaw) {
      const m =
        topText.match(/(총\s*\d+화\s*완결)/) ||
        topText.match(/(매주\s*[월화수목금토일](?:요일)?(?:\s*[,/]\s*[월화수목금토일](?:요일)?)?\s*(?:업데이트|연재)(?:\s*및\s*\d+주\s*연재\s*\d+주\s*휴재(?:\s*진행)?)?)/) ||
        topText.match(/(격주\s*[월화수목금토일](?:요일)?\s*(?:업데이트|연재)?)/) ||
        topText.match(/(매일\s*(?:업데이트|연재)?)/) ||
        topText.match(/(매월\s*[\d,\s]+일?\s*(?:업데이트|연재)?)/) ||
        topText.match(/(\d+\s*일\s*주기\s*\(?\s*[\d,\s]+일?\s*\)?\s*(?:업데이트|연재)?)/) ||
        topText.match(/(휴재\s*중)/) ||
        topText.match(/(완결)/);

      if (m) serialRaw = clean(m[1]);
    }

    const adultYn = /(성인|19세|19금|청소년 이용불가|청유물)/i.test(topText) ? 'Y' : 'N';

    const bodyText = allLines.join(' ');
    const publishDate = (() => {
      const m = bodyText.match(/출간\s*정보\s*[:：]?\s*((?:19|20)\d{2})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})\s*(?:일)?/);
      if (!m) return '';
      return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
    })();

    return {
      title: title || '미확인',
      writer,
      artist,
      genreRaw: genreRaw || '미확인',
      serialRaw: serialRaw || '-',
      adultYn,
      publishDate,
      bodyText
    };
  });
}

async function loadDetailMeta(page, detailUrl, fallbackTitle = '') {
  const fallbackMeta = {
    title: fallbackTitle || '미확인',
    writer: '미확인',
    artist: '미확인',
    genreRaw: '미확인',
    serialRaw: '-',
    adultYn: 'N',
    publishDate: '',
    bodyText: ''
  };

  try {
    await page.goto(detailUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 45000
    });

    try {
      await page.waitForLoadState('networkidle', { timeout: 5000 });
    } catch (e) {}

    await page.waitForTimeout(1500);

    const meta = await extractDetailMeta(page);
    return {
      title: meta.title && meta.title !== '미확인' ? meta.title : fallbackMeta.title,
      writer: meta.writer || fallbackMeta.writer,
      artist: meta.artist || fallbackMeta.artist,
      genreRaw: meta.genreRaw || fallbackMeta.genreRaw,
      serialRaw: meta.serialRaw || fallbackMeta.serialRaw,
      adultYn: meta.adultYn || fallbackMeta.adultYn,
      publishDate: meta.publishDate || fallbackMeta.publishDate,
      bodyText: meta.bodyText || fallbackMeta.bodyText
    };
  } catch (e) {
    console.warn(`상세 페이지 로드 실패 - 메타 기본값으로 진행: ${detailUrl} / ${e.message || e}`);

    try {
      await page.goto('about:blank', { timeout: 5000 });
    } catch (_) {}

    return fallbackMeta;
  }
}

async function extractDetailCoverUrl(page) {
  const MAX_DATA_URL_LENGTH = 45000;

  async function compressAndValidateDataUrl(sourceDataUrl, label) {
    return await page.evaluate(async ({ sourceDataUrl, maxLength }) => {
      function loadImage(src) {
        return new Promise((resolve) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = () => resolve(null);
          img.src = src;
        });
      }

      function isProbablyBlank(canvas) {
        const ctx = canvas.getContext('2d');
        if (!ctx) return true;

        const w = canvas.width;
        const h = canvas.height;
        const data = ctx.getImageData(0, 0, w, h).data;

        let count = 0;
        let whiteCount = 0;
        let darkCount = 0;
        let sum = 0;
        let sumSq = 0;

        const step = 4 * 6;

        for (let i = 0; i < data.length; i += step) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          const a = data[i + 3];

          if (a < 20) continue;

          const brightness = (r + g + b) / 3;

          count++;
          sum += brightness;
          sumSq += brightness * brightness;

          if (r > 238 && g > 238 && b > 238) whiteCount++;
          if (brightness < 80) darkCount++;
        }

        if (!count) return true;

        const avg = sum / count;
        const variance = sumSq / count - avg * avg;
        const whiteRatio = whiteCount / count;
        const darkRatio = darkCount / count;

        if (whiteRatio >= 0.78 && variance < 650) return true;
        if (variance < 120 && avg > 220) return true;
        if (avg > 245 && darkRatio < 0.02) return true;

        return false;
      }

      const sourceImg = await loadImage(sourceDataUrl);
      if (!sourceImg) return '';

      const naturalWidth = sourceImg.naturalWidth || sourceImg.width || 0;
      const naturalHeight = sourceImg.naturalHeight || sourceImg.height || 0;

      if (!naturalWidth || !naturalHeight) return '';

      const sizes = [
        { width: 120 },
        { width: 105 },
        { width: 90 },
        { width: 80 },
        { width: 70 },
        { width: 60 },
      ];

      const qualities = [0.62, 0.52, 0.42, 0.34, 0.26, 0.18, 0.12];

      for (const size of sizes) {
        const width = size.width;
        const height = Math.max(1, Math.round(naturalHeight * (width / naturalWidth)));

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        if (!ctx) continue;

        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(sourceImg, 0, 0, width, height);

        if (isProbablyBlank(canvas)) {
          return '__BLANK__';
        }

        for (const quality of qualities) {
          const dataUrl = canvas.toDataURL('image/jpeg', quality);

          if (dataUrl && dataUrl.length <= maxLength) {
            return dataUrl;
          }
        }
      }

      return '';
    }, {
      sourceDataUrl,
      maxLength: MAX_DATA_URL_LENGTH,
      label,
    }).catch(() => '');
  }

  async function screenshotElementToCompressedDataUrl(locator, label, pickedRect = null) {
  async function screenshotByPageClip(labelForLog) {
    try {
      let rect = await locator.evaluate((el) => {
        if (!el) return null;

        const r = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);

        return {
          x: r.x,
          y: r.y,
          width: r.width,
          height: r.height,
          display: style.display,
          visibility: style.visibility,
          opacity: style.opacity,
        };
      }).catch(() => null);

      // locator 기준 rect가 안 잡히면, 이미 선택해둔 후보 좌표를 사용
      if (
        !rect ||
        rect.width < 40 ||
        rect.height < 60 ||
        rect.display === 'none' ||
        rect.visibility === 'hidden' ||
        Number(rect.opacity) === 0
      ) {
        if (pickedRect && pickedRect.width >= 40 && pickedRect.height >= 60) {
          rect = {
            x: pickedRect.x,
            y: pickedRect.y,
            width: pickedRect.width,
            height: pickedRect.height,
          };
        } else {
          console.log(` 표지 clip 캡쳐 불가(${labelForLog}): valid rect 없음`);
          return '';
        }
      }

      const viewport = page.viewportSize() || { width: 1440, height: 900 };

      const x = Math.max(0, Math.floor(rect.x));
      const y = Math.max(0, Math.floor(rect.y));

      const clip = {
        x,
        y,
        width: Math.min(Math.ceil(rect.width), viewport.width - x),
        height: Math.min(Math.ceil(rect.height), viewport.height - y),
      };

      if (clip.width < 40 || clip.height < 60) {
        console.log(` 표지 clip 캡쳐 불가(${labelForLog}): clip size 오류`);
        return '';
      }

      for (const quality of [75, 65, 55, 45, 35, 28]) {
        const buffer = await page.screenshot({
          type: 'jpeg',
          quality,
          clip,
          timeout: 10000,
        });

        const rawDataUrl = `data:image/jpeg;base64,${buffer.toString('base64')}`;
        const compressed = await compressAndValidateDataUrl(rawDataUrl, `${labelForLog}-clip`);

        if (compressed === '__BLANK__') {
          console.log(` 표지 빈 이미지 감지(${labelForLog}-clip)`);
          return '';
        }

        if (compressed && compressed.length <= MAX_DATA_URL_LENGTH) {
          console.log(` 표지 clip 압축 완료(${labelForLog}): ${Math.round(compressed.length / 1024)}KB`);
          return compressed;
        }
      }
    } catch (e) {
      console.log(` 표지 clip 캡쳐 실패(${labelForLog}): ${e.message}`);
    }

    return '';
  }

  try {
    if (!(await locator.count().catch(() => 0))) return '';

    await locator.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(900);

    // 1차: 기존 성공 방식 유지
    for (const quality of [75, 65, 55, 45, 35, 28]) {
      try {
        const buffer = await locator.screenshot({
          type: 'jpeg',
          quality,
          timeout: 10000,
        });

        const rawDataUrl = `data:image/jpeg;base64,${buffer.toString('base64')}`;
        const compressed = await compressAndValidateDataUrl(rawDataUrl, label);

        if (compressed === '__BLANK__') {
          console.log(` 표지 빈 이미지 감지(${label})`);
          return '';
        }

        if (compressed && compressed.length <= MAX_DATA_URL_LENGTH) {
          console.log(` 표지 압축 완료(${label}): ${Math.round(compressed.length / 1024)}KB`);
          return compressed;
        }
      } catch (e) {
        console.log(` 표지 element 캡쳐 실패(${label}): ${e.message}`);
        break;
      }
    }

    // 2차: element 캡쳐 실패 시, 이미 선택된 같은 좌표를 화면 캡쳐
    const clipped = await screenshotByPageClip(label);
    if (clipped) return clipped;

  } catch (e) {
    console.log(` 표지 캡쳐 실패(${label}): ${e.message}`);
  }

  return '';
}

  await page.evaluate(() => {
    document.querySelectorAll('[data-ridi-real-cover]').forEach(el => {
      el.removeAttribute('data-ridi-real-cover');
    });
  }).catch(() => {});

  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
  await page.waitForTimeout(1500).catch(() => {});

  // 표지 후보 영역에 "실제로 로드된" 이미지가 뜰 때까지 최대 8초 대기.
  // (기존에는 고정 3초만 기다린 뒤 바로 캡쳐해서, 진짜 표지가 아직 로딩되기 전인 경우
  //  같은 자리에 있는 신작 뱃지/로딩 아이콘 같은 걸 대신 잘못 집어서, 책마다 달라야 할
  //  표지가 매번 똑같은 이미지로 저장되는 문제가 있었다.)
  await page.waitForFunction(() => {
    const imgs = Array.from(document.querySelectorAll('img'));
    return imgs.some(img => {
      const rect = img.getBoundingClientRect();
      const ratio = rect.width / Math.max(rect.height, 1);
      return (
        rect.left >= 0 && rect.left <= 360 &&
        rect.top >= 0 && rect.top <= 850 &&
        ratio >= 0.45 && ratio <= 0.85 &&
        img.complete &&
        img.naturalWidth >= 150 &&
        img.naturalHeight >= 190
      );
    });
  }, { timeout: 8000 }).catch(() => {
    console.log(' 표지 로딩 대기 타임아웃(8초) - 현재 상태로 진행');
  });

  const picked = await page.evaluate(() => {
    function clean(v) {
      return String(v ?? '')
        .replace(/\u200b/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    }

    function isVisible(el) {
      if (!el) return false;

      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();

      return (
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        rect.width >= 90 &&
        rect.height >= 120
      );
    }

    function isBadImage(img) {
      const src = String(
        img.currentSrc ||
        img.src ||
        img.getAttribute('src') ||
        img.getAttribute('data-src') ||
        ''
      );

      const className = String(img.className || '');
      const alt = clean(img.getAttribute('alt') || '');
      const parentText = clean(img.closest('a, div, section, article')?.innerText || '');

      // 이벤트/배너/추천/혜택 이미지는 제외
      if (/event|banner|promotion|recommend|benefit|ad/i.test(src + ' ' + className)) return true;
      if (/이벤트|혜택|추천|포인트|할인|론칭|배너/.test(alt + ' ' + parentText)) return true;

      return false;
    }

    // 아직 로딩 전이거나(placeholder), 신작/뱃지 같은 작은 아이콘은 실제 표지가 아니므로 제외.
    // CSS로는 커버처럼 크게 보이게 만들 수 있어도, 실제 로드된 원본 이미지 해상도(naturalWidth/Height)는
    // 작은 아이콘/뱃지가 훨씬 작기 때문에 이 값으로 걸러내는 게 훨씬 신뢰도가 높다.
    function isLoadedRealCoverCandidate(img) {
      return (
        img.complete === true &&
        img.naturalWidth >= 150 &&
        img.naturalHeight >= 190
      );
    }

    const title = clean(
      document.querySelector('h1')?.innerText ||
      document.querySelector('meta[property="og:title"]')?.content ||
      ''
    );

    const imgs = Array.from(document.querySelectorAll('img'));

    // 중요: 아래에서 filter를 먼저 걸고 나서 map((img, idx) => ...)로 idx를 매기면,
    // 그 idx는 "필터링된 배열 안에서의 순번"이 되어버려서, 나중에 imgs[first.idx]로
    // 되짚어갈 때 원본 imgs 배열의 엉뚱한(대부분 상단 헤더/아이콘류) 이미지를 가리키게 된다.
    // (이게 바로 표지가 매번 똑같은 엉뚱한 이미지로 저장되던 근본 원인이었다.)
    // 그래서 반드시 원본 인덱스를 먼저 붙여두고, 그 다음에 filter를 걸어야 한다.
    const candidates = imgs
      .map((img, idx) => ({ img, idx }))
      .filter(({ img }) => isVisible(img))
      .filter(({ img }) => !isBadImage(img))
      .filter(({ img }) => isLoadedRealCoverCandidate(img))
      .map(({ img, idx }) => {
        const rect = img.getBoundingClientRect();
        const ratio = rect.width / Math.max(rect.height, 1);
        const area = rect.width * rect.height;

        const alt = clean(img.getAttribute('alt') || '');
        const parentText = clean(img.closest('a, div, section, article')?.innerText || '');
        const src = String(
          img.currentSrc ||
          img.src ||
          img.getAttribute('src') ||
          img.getAttribute('data-src') ||
          ''
        );

        let score = 0;

        // 핵심: 상세페이지 왼쪽 상단 커버만 강하게 우선
        if (rect.left >= 0 && rect.left <= 330) score -= 1000;
        else score += 1200;

        if (rect.top >= 0 && rect.top <= 760) score -= 900;
        else score += 1200;

        // 커버는 세로형
        if (ratio >= 0.48 && ratio <= 0.82) score -= 700;
        else score += 1200;

        // 대표 커버 크기
        if (rect.width >= 120 && rect.height >= 170) score -= 300;
        if (rect.width < 90 || rect.height < 120) score += 800;

        score -= Math.min(area / 700, 350);

        if (/ridicdn|cover|book|thumbnail|jacket/i.test(src)) score -= 220;
        if (/cover|thumbnail|book|jacket|표지/i.test(String(img.className || '') + ' ' + alt)) score -= 180;

        if (title && (alt.includes(title) || parentText.includes(title))) score -= 300;

        // 우측/하단 이미지는 거의 제외
        if (rect.left > 360) score += 1500;
        if (rect.top > 900) score += 1600;

        return {
          idx,
          score,
          x: Math.round(rect.left),
          y: Math.round(rect.top),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          ratio: Number(ratio.toFixed(2)),
        };
      })
      .filter(v => v.ratio >= 0.45 && v.ratio <= 0.85)
      .filter(v => v.x <= 360)
      .filter(v => v.y <= 850)
      .sort((a, b) => {
        if (a.score !== b.score) return a.score - b.score;
        return a.idx - b.idx;
      });

    if (!candidates.length) {
      return {
        ok: false,
        reason: 'no-left-cover-candidate',
        picked: null,
      };
    }

    const first = candidates[0];
    const target = imgs[first.idx];

    if (!target) {
      return {
        ok: false,
        reason: 'target-missing',
        picked: null,
      };
    }

    target.setAttribute('data-ridi-real-cover', '1');

    return {
      ok: true,
      reason: 'picked-left-cover-only',
      picked: first,
      candidates: candidates.slice(0, 5),
    };
  }).catch(() => ({
    ok: false,
    reason: 'evaluate-error',
    picked: null,
  }));

  if (!picked.ok) {
    console.log(` 표지 후보 없음: ${picked.reason || '-'}`);
    return '';
  }

  console.log(
    ` 표지 후보 선택: x=${picked.picked.x}, y=${picked.picked.y}, ` +
    `w=${picked.picked.width}, h=${picked.picked.height}, ratio=${picked.picked.ratio}, score=${picked.picked.score}`
  );

  const target = page.locator('[data-ridi-real-cover="1"]').first();
  const result = await screenshotElementToCompressedDataUrl(target, 'left-cover-only', picked.picked);

  if (result) return result;

  console.log(' 표지 최종 실패');
  return '';
}

(async () => {
  const baseDir = __dirname;
  const outputDir = path.join(baseDir, 'output_ridi');
  const historyDir = path.join(outputDir, 'history');
  const masterDir = path.join(outputDir, 'master');
  const authFile = path.join(baseDir, '.auth', 'ridi_auth.json');
  const dateText = getTodayText();

  ensureDir(outputDir);
  ensureDir(historyDir);
  ensureDir(masterDir);

  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-web-security'
    ]
  });

  const contextOptions = {
    viewport: {
      width: 1440,
      height: 1600
    },
    locale: 'ko-KR',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    extraHTTPHeaders: {
      'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8',
      'sec-ch-ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
    }
  };

  if (fs.existsSync(authFile)) {
    contextOptions.storageState = authFile;
    console.log('리디 로그인 세션 로드됨');
  }

  const context = await browser.newContext(contextOptions);

  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3] });
    Object.defineProperty(navigator, 'languages', { get: () => ['ko-KR', 'ko'] });
    window.chrome = { runtime: {} };
  });

  try {
    for (const category of CATEGORY_CONFIGS) {
      const listPage = await context.newPage();
      const detailPage = await context.newPage();

      console.log(`\n▶ 목록 접속: ${category.label} / ${category.listUrl}`);

      await listPage.goto(category.listUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      try {
        await listPage.waitForLoadState('networkidle', { timeout: 7000 });
      } catch (e) {}

      await listPage.waitForTimeout(2500);
      await autoScrollForRanking(listPage);

      let top20 = await extractTop20FromListPage(listPage);

      if (top20.length < 20) {
        console.log(`재시도 중... (현재 ${top20.length}개)`);
        await listPage.waitForTimeout(2000);
        await autoScrollForRanking(listPage);
        top20 = await extractTop20FromListPage(listPage);
      }

      top20 = top20.slice(0, 20);

      console.log(`${category.label} 추출 순위 수: ${top20.length}`);
      top20.forEach(r => console.log(`  ${r.rank}위: ${r.title}`));

      top20 = top20.map(row => ({ ...row, coverUrl: '' }));
      console.log('표지는 상세페이지에서 대표 이미지로 추출 후 압축 base64 저장 예정');

      const previousRows = readLatestPreviousHistory(historyDir, category.key, dateText) || [];
      const hasPrevSnapshot = previousRows.length > 0;
      const prevMap = new Map(previousRows.map(row => [cleanText(row.title).toLowerCase(), row]));
      const rows = [];

      for (const item of top20) {
        let detailUrl = await resolveDetailUrlOnListPage(listPage, item.title);

        if (!detailUrl) {
          detailUrl = await resolveDetailUrlBySearch(detailPage, item.title);
        }

        console.log(`상세 조회 중: ${category.label} / ${item.rank}위 / ${item.title}`);

        let detailMeta = {
          title: item.title || '미확인',
          writer: '미확인',
          artist: '미확인',
          genreRaw: '미확인',
          serialRaw: '-',
          adultYn: 'N',
          publishDate: '',
          bodyText: ''
        };

        let detailCoverUrl = '';

        if (detailUrl) {
          detailMeta = await loadDetailMeta(detailPage, detailUrl, item.title);
          detailCoverUrl = await extractDetailCoverUrl(detailPage);

          if (isWeakDetailMeta(detailMeta)) {
            const retryUrl = await resolveDetailUrlBySearch(
              detailPage,
              detailMeta.title && detailMeta.title !== '미확인' ? detailMeta.title : item.title
            );

            if (retryUrl && retryUrl !== detailUrl) {
              detailUrl = retryUrl;
              detailMeta = await loadDetailMeta(detailPage, detailUrl, detailMeta.title && detailMeta.title !== '미확인' ? detailMeta.title : item.title);
              detailCoverUrl = await extractDetailCoverUrl(detailPage);
            }
          }
        }

        console.log(` 표지 확인: ${item.rank}위 / ${item.title} / ${detailCoverUrl ? '성공' : '실패'}`);

        let finalTitle = normalizeOutputTitle(detailMeta.title || item.title || '미확인');
        if (isBadRidiTitle(finalTitle)) {
          finalTitle = normalizeOutputTitle(item.title || '미확인');
        }
        const titleKey = cleanText(finalTitle).toLowerCase();
        const prevRow = prevMap.get(titleKey);
        const prevRank = prevRow ? Number(prevRow.rank) : null;

        let rankChange = '기준없음';

        if (hasPrevSnapshot) {
          if (prevRank !== null && !Number.isNaN(prevRank)) {
            const diff = prevRank - Number(item.rank);

            if (diff > 0) rankChange = `▲${diff}`;
            else if (diff < 0) rankChange = `▼${Math.abs(diff)}`;
            else rankChange = '-';
          } else {
            rankChange = 'NEW';
          }
        }

        const stayDays = prevRow ? Number(prevRow.stay_days || 0) + 1 : 1;
        const launchDate = detailMeta.publishDate || extractLaunchDateFromText(detailMeta.bodyText || '', dateText);
        const newInfo = getNewInfo(dateText, launchDate);

        if (launchDate) {
          console.log(` 출간일 기준 런칭일 추정: ${item.rank}위 / ${finalTitle} / ${launchDate} / 신작=${newInfo.new_yn}`);
        } else {
          console.log(` 런칭일 미확인: ${item.rank}위 / ${finalTitle}`);
        }

        rows.push({
          collect_date: dateText,
          category_key: category.key,
          category_label: category.label,
          rank: item.rank,
          title: finalTitle,
          writer: detailMeta.writer,
          artist: detailMeta.artist,
          genre_norm: category.key === 'bl_webtoon' ? 'BL' : normalizeGenre(detailMeta.genreRaw),
          adult_yn: detailMeta.adultYn,
          launch_date: newInfo.launch_date,
          new_yn: newInfo.new_yn,
          new_days: newInfo.new_days,
          bl_yn: category.key === 'bl_webtoon' ? 'Y' : 'N',
          rank_change: rankChange,
          stay_days: stayDays,
          serial_info: normalizeSerialInfo(detailMeta.serialRaw),
          detail_url: detailUrl || '',
          cover_url: detailCoverUrl || ''
        });
      }

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
        'bl_yn',
        'rank_change',
        'stay_days',
        'serial_info',
        'detail_url',
        'cover_url'
      ];

      console.log('RIDI CSV 헤더 확인: ' + csvHeader.join(', '));

      const csvLines = [csvHeader.join(',')];

      for (const row of rows) {
        csvLines.push([
          csvEscape(row.collect_date),
          csvEscape(row.category_key),
          csvEscape(row.category_label),
          csvEscape(row.rank),
          csvEscape(row.title),
          csvEscape(row.writer),
          csvEscape(row.artist),
          csvEscape(row.genre_norm),
          csvEscape(row.adult_yn),
          csvEscape(row.launch_date),
          csvEscape(row.new_yn),
          csvEscape(row.new_days),
          csvEscape(row.bl_yn),
          csvEscape(row.rank_change),
          csvEscape(row.stay_days),
          csvEscape(row.serial_info),
          csvEscape(row.detail_url),
          csvEscape(row.cover_url)
        ].join(','));
      }

      const csvPath = path.join(outputDir, `ridi_${category.key}_top20_${dateText}.csv`);
      writeUtf8Bom(csvPath, csvLines.join('\n'));

      const previewLines = rows.map(r =>
        `${r.rank}. ${r.title} / 글 ${r.writer} / 그림 ${r.artist} / ${r.genre_norm} / 성인 ${r.adult_yn} / 런칭 ${r.launch_date || '-'} / 신작 ${r.new_yn} / BL ${r.bl_yn} / 변화 ${r.rank_change} / 체류 ${r.stay_days}일 / ${r.serial_info}`
      );

      const previewPath = path.join(outputDir, `ridi_${category.key}_top20_preview_${dateText}.txt`);
      writeUtf8Bom(previewPath, previewLines.join('\n'));

      writeJson(getHistoryFilePath(historyDir, category.key, dateText), rows);

      const masterCsvPath = path.join(masterDir, 'ridi_top20_master.csv');
      const appendedCount = appendRowsToMaster(masterCsvPath, rows);

      console.log(`\n✅ 완료: ${category.label}`);
      console.log(`CSV 저장: ${csvPath}`);
      console.log(`미리보기 저장: ${previewPath}`);
      console.log(`히스토리 저장: ${getHistoryFilePath(historyDir, category.key, dateText)}`);
      console.log(`누적 CSV 저장: ${masterCsvPath}`);
      console.log(`이번 실행 누적 추가 건수: ${appendedCount}`);

      await listPage.close();
      await detailPage.close();
    }
  } catch (error) {
    console.error('오류 발생:', error);
  } finally {
    await browser.close();
  }
})();