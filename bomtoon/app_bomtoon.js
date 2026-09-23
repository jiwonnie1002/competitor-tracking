console.log('BOMTOON API VERSION: 2026-09-02-v1');
const fs = require('fs');
const path = require('path');

// 로컬 개발용: 같은 폴더의 .env 파일에서 API 키를 읽어온다 (GitHub Actions에서는 Secrets를 쓰므로 .env가 없어도 무관)
require('dotenv').config({ path: path.join(__dirname, '.env') });

const PLATFORM_KEY = 'bomtoon';
const PLATFORM_LABEL = '봄툰';
const TOP_N = 20;

// 봄툰에서 공식 발급해준 랭킹 조회 API
// Spec 문서상 "도메인은 환경별로 다르며 별도 전달한다"고 되어 있어, 환경변수로 교체 가능하게 둔다.
//
// [2026-09-02 변경] 봄툰 담당자 안내에 따라 외부 호출용 주소로 교체.
//   변경 전: https://service-api.bomtoon.com/v2/external/contents/ranking
//            → 사내 회선에서는 되지만 GitHub Actions 등 외부 서버에서는 연결 자체가 차단됨
//   변경 후: https://www.bomtoon.com/api/balcony-api-v2/external/contents/ranking
const API_URL =
  process.env.BOMTOON_API_URL ||
  'https://www.bomtoon.com/api/balcony-api-v2/external/contents/ranking';

// Spec 2-2 기준 값 목록: COMIC | CARTOON | NOVEL = 웹툰 / 만화 / 소설
// → 우리가 수집하는 대상은 "웹툰"이므로 COMIC 이 맞다.
const CONTENTS_TYPE = process.env.BOMTOON_CONTENTS_TYPE || 'COMIC';

// Spec 2-1 요청 헤더에는 X-B2B-Api-Key 만 필수로 기재되어 있고 x-balcony-id는 없다.
// 메일로 함께 안내받은 값이라 유지하되, 필요 시 BOMTOON_BALCONY_ID=off 로 끌 수 있게 한다.
const BALCONY_ID = process.env.BOMTOON_BALCONY_ID || 'BOMTOON_COM';

// ============================================================
// [변경 사항 안내]
// 이 파일은 기존에 Playwright로 브라우저를 띄워 랭킹 페이지를 긁던 방식에서,
// 봄툰이 공식으로 제공하는 API를 호출하는 방식으로 완전히 교체되었습니다.
// (레진 전환 방식과 동일한 구조입니다.)
//
// - 더 이상 로그인 세션(.auth/bomtoon_auth.json)이 필요 없습니다.
// - 대신 환경변수 BOMTOON_API_KEY 에 발급받은 API 키가 들어있어야 합니다.
// - 출력 파일 경로/파일명/CSV 컬럼 구성은 기존과 100% 동일하게 맞췄습니다.
//   (output_bomtoon/bomtoon_top20_<날짜>.csv, history/, master/ 그대로 사용)
//
// 기존 Playwright 버전은 app_bomtoon_playwright_backup.js 로 보관되어 있습니다.
// ============================================================

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

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

function cleanText(value) {
  return String(value ?? '')
    .replace(/​/g, '')
    .replace(/ /g, ' ')
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

// 수집 기준일: KST 기준 전일자 (기존 로직과 동일)
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
    new_days: isNew ? String(displayDays) : '',
  };
}

// API launchDate(epoch 밀리초) -> KST 기준 YYYY-MM-DD
function getLaunchDateFromApi(launchDate) {
  if (launchDate === null || launchDate === undefined || launchDate === '') return '';
  const ms = Number(launchDate);
  if (!Number.isFinite(ms)) return '';
  const d = new Date(ms + 9 * 60 * 60 * 1000);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

// 개별 장르명 -> 기존 genre_norm 분류 (기존 normalizeGenre와 동일한 기준)
function normalizeGenreWord(raw) {
  const text = cleanText(raw).replace(/^#/, '');
  if (!text || text === '미확인') return '기타';
  if (/\bBL\b|비엘|보이즈러브|boys\s*love/i.test(text)) return 'BL';
  if (/\bGL\b|백합/i.test(text)) return 'GL';
  if (/로판|로맨스|순정|연애/.test(text)) return '로맨스';
  if (/판타지|현대판타지|게임|SF|이세계|회귀|귀환|환생|빙의|헌터|던전|마법|용사|마왕|레벨업|시스템|아포칼립스|전생/.test(text)) return '판타지';
  if (/액션|스포츠|히어로|범죄|느와르|누아르|첩보|격투|전쟁|검술/.test(text)) return '액션';
  if (/일상|에피소드|힐링|먹방|요리|반려|육아|학교/.test(text)) return '일상';
  if (/스릴러|공포|미스터리|호러|서스펜스|추리|심리/.test(text)) return '스릴러';
  if (/개그|코미디|병맛/.test(text)) return '개그';
  if (/무협|선협|사극|강호|협객|검협/.test(text)) return '무협';
  if (/드라마|학원|성장|감성|복수|오피스|가족|청춘/.test(text)) return '드라마';
  return '기타';
}

// API genres[] -> genre_norm (BL/GL을 최우선으로 판정)
function getGenreNorm(genres) {
  const list = Array.isArray(genres) ? genres : [];
  const mainNames = list.filter(g => g && g.type === 'GENRE' && g.name).map(g => cleanText(g.name));
  const allNames = list.filter(g => g && g.name).map(g => cleanText(g.name));
  const pool = mainNames.length ? mainNames : allNames;

  const joined = pool.join(' ');
  if (/\bBL\b|비엘|보이즈러브|boys\s*love/i.test(joined)) return 'BL';
  if (/\bGL\b|백합/i.test(joined)) return 'GL';

  for (const name of pool) {
    const norm = normalizeGenreWord(name);
    if (norm !== '기타') return norm;
  }
  return '기타';
}

// API artists[] -> writer(글) / artist(그림)
// Spec 3-2 role 값: AUTHOR(구분 없는 작가) / WRITER(글) / ARTIST(그림) / ORIGINAL(원작)
//                   PUBLISHER(출판사) / LABEL(레이블) / ILLUSTRATOR(일러스트레이터) / ADAPTER(각색)
// PUBLISHER, LABEL은 사람이 아니므로 작가명에서 제외한다.
const NON_AUTHOR_ROLES = ['PUBLISHER', 'LABEL'];
const WRITER_ROLES = ['WRITER', 'ORIGINAL', 'ADAPTER', 'SCRIPTER', 'STORY'];
const ARTIST_ROLES = ['ARTIST', 'ILLUSTRATOR', 'PAINTER', 'DRAWING'];

function extractAuthors(artists) {
  const list = (Array.isArray(artists) ? artists : []).filter(
    a => a && cleanText(a.name) && !NON_AUTHOR_ROLES.includes(String(a.role || '').toUpperCase())
  );

  const namesByRole = roles =>
    list
      .filter(a => roles.includes(String(a.role || '').toUpperCase()))
      .map(a => cleanText(a.name));

  const uniq = arr => [...new Set(arr.filter(Boolean))];

  // AUTHOR(구분 없는 작가)는 글·그림 양쪽에 모두 넣는다.
  const bothNames = namesByRole(['AUTHOR']);
  let writerNames = uniq([...namesByRole(WRITER_ROLES), ...bothNames]);
  let artistNames = uniq([...namesByRole(ARTIST_ROLES), ...bothNames]);

  if (!writerNames.length && !artistNames.length && list.length) {
    const allNames = uniq(list.map(a => cleanText(a.name)));
    writerNames = allNames;
    artistNames = allNames;
  }

  const writer = writerNames.length ? writerNames.join('/') : (artistNames.length ? artistNames.join('/') : '미확인');
  const artist = artistNames.length ? artistNames.join('/') : (writerNames.length ? writerNames.join('/') : '미확인');
  return { writer, artist };
}

// API serialInfo{status, dayOfWeek[]} -> 기존 serial_info 컬럼 형식
// Spec 3-2: status = SCHEDULED(연재) / COMPLETED(완결) / PAUSED(휴재)
//           dayOfWeek = MONDAY~SUNDAY + 특수값 EVERYDAY(매일) / ANYTIME(비정기) / TEN(10일 연재)
function mapSerialInfo(serialInfo) {
  if (!serialInfo || typeof serialInfo !== 'object') return '-';
  const status = String(serialInfo.status || '').toUpperCase();

  if (status === 'COMPLETED') return '완결';
  if (status === 'PAUSED' || status === 'HIATUS') return '휴재 중';

  const days = (Array.isArray(serialInfo.dayOfWeek) ? serialInfo.dayOfWeek : []).map(d => String(d).toUpperCase());

  if (days.includes('EVERYDAY')) return '매일';
  if (days.includes('ANYTIME')) return '비정기 연재';
  if (days.includes('TEN')) return '10일 주기 연재';

  const dayMap = {
    MONDAY: '월요일', TUESDAY: '화요일', WEDNESDAY: '수요일', THURSDAY: '목요일',
    FRIDAY: '금요일', SATURDAY: '토요일', SUNDAY: '일요일',
    MON: '월요일', TUE: '화요일', WED: '수요일', THU: '목요일',
    FRI: '금요일', SAT: '토요일', SUN: '일요일',
  };
  const named = days.map(d => dayMap[d]).filter(Boolean);

  if (named.length >= 7) return '매일';
  if (named.length >= 1) return `매주 ${named.join('·')}`;

  if (status === 'SCHEDULED' || status === 'ONGOING') return '연재중';
  return '-';
}

// API detailUrl(https://bomtoon.com/detail/<slug>) -> 기존과 동일한 www 형식으로 정규화
function normalizeBomtoonDetailUrl(rawUrl) {
  const raw = cleanText(rawUrl);
  if (!raw) return '';

  try {
    const url = new URL(raw, 'https://www.bomtoon.com');
    const pathname = url.pathname;

    const epMatch = pathname.match(/\/comic\/ep_list\/([^/?#]+)/i);
    if (epMatch) {
      const id = decodeURIComponent(epMatch[1] || '').trim();
      if (!id || /^\d+$/.test(id)) return '';
      return `https://www.bomtoon.com/comic/ep_list/${encodeURIComponent(id)}`;
    }

    const detailMatch = pathname.match(/\/detail\/([^/?#]+)/i);
    if (detailMatch) {
      const id = decodeURIComponent(detailMatch[1] || '').trim();
      if (!id || /^\d+$/.test(id)) return '';
      return `https://www.bomtoon.com/detail/${encodeURIComponent(id)}`;
    }
  } catch (e) {}

  return '';
}

function extractSeriesIdFromBomtoonUrl(rawUrl) {
  const url = normalizeBomtoonDetailUrl(rawUrl);
  if (!url) return '';

  let m = url.match(/\/comic\/ep_list\/([^/?#]+)/i);
  if (m) return decodeURIComponent(m[1] || '').trim();

  m = url.match(/\/detail\/([^/?#]+)/i);
  if (m) return decodeURIComponent(m[1] || '').trim();

  return '';
}

function getHistoryFilePath(historyDir, dateText) {
  return path.join(historyDir, `bomtoon_top20_${dateText}.json`);
}

function readLatestPreviousHistory(historyDir, currentDateText) {
  if (!fs.existsSync(historyDir)) return null;

  const dates = fs
    .readdirSync(historyDir, { withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => entry.name)
    .map(name => {
      const m = name.match(/^bomtoon_top20_(\d{4}-\d{2}-\d{2})\.json$/);
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
  let cur = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      result.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }

  result.push(cur);
  return result;
}

function readCsvRowsFromFile(filePath) {
  if (!fs.existsSync(filePath)) return [];

  const raw = fs.readFileSync(filePath, 'utf8').replace(/^﻿/, '');
  const lines = raw.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];

  const header = parseCsvLine(lines[0]);

  return lines.slice(1).map(line => {
    const cols = parseCsvLine(line);
    const row = {};
    header.forEach((h, i) => {
      row[h] = cols[i] ?? '';
    });
    return row;
  });
}

function appendRowsToMaster(masterCsvPath, rows) {
  const existingRows = readCsvRowsFromFile(masterCsvPath);
  const map = new Map();

  for (const row of existingRows) {
    const key = [cleanText(row.collect_date), cleanText(row.category_key), cleanText(row.rank), cleanText(row.title).toLowerCase()].join('||');
    if (key) map.set(key, row);
  }

  let changed = 0;

  for (const row of rows) {
    const key = [cleanText(row.collect_date), cleanText(row.category_key), cleanText(row.rank), cleanText(row.title).toLowerCase()].join('||');
    const old = map.get(key);

    if (!old) {
      map.set(key, row);
      changed++;
      continue;
    }

    const oldUrlMissing = !cleanText(old.detail_url);
    const oldSeriesMissing = !cleanText(old.series_id);
    const oldGenreWeak = !cleanText(old.genre_norm) || old.genre_norm === '기타';
    const oldCoverMissing = !cleanText(old.cover_url);

    const newUrlBetter = oldUrlMissing && cleanText(row.detail_url);
    const newSeriesBetter = oldSeriesMissing && cleanText(row.series_id);
    const newGenreBetter = oldGenreWeak && cleanText(row.genre_norm) && row.genre_norm !== '기타';
    const newCoverBetter = oldCoverMissing && cleanText(row.cover_url);

    if (newUrlBetter || newSeriesBetter || newGenreBetter || newCoverBetter) {
      map.set(key, { ...old, ...row });
      changed++;
    }
  }

  const allRows = Array.from(map.values()).sort((a, b) => {
    const d = String(a.collect_date || '').localeCompare(String(b.collect_date || ''));
    if (d !== 0) return d;
    const c = String(a.category_key || '').localeCompare(String(b.category_key || ''));
    if (c !== 0) return c;
    return Number(a.rank || 0) - Number(b.rank || 0);
  });

  const lines = [CSV_HEADER.join(',')];
  for (const row of allRows) {
    lines.push(CSV_HEADER.map(h => csvEscape(row[h])).join(','));
  }

  writeUtf8Bom(masterCsvPath, lines.join('\n') + '\n');
  return changed;
}

// 구글시트 셀 한도(50,000자)를 절대 넘지 않도록 하는 안전 마진
const MAX_COVER_DATA_URI_LENGTH = 45000;

// sharp(이미지 축소 라이브러리)가 설치되어 있지 않은 환경에서도 수집 자체는 성공하도록,
// 없으면 원본 이미지를 그대로 쓰는 방식으로 자동 전환한다.
let sharp = null;
try {
  sharp = require('sharp');
} catch (e) {
  console.log('안내: sharp 모듈이 없어 표지 이미지를 축소하지 않고 원본 그대로 처리합니다.');
  console.log('      (용량이 큰 표지는 빈 값이 됩니다. collect.yml의 봄툰 패키지 설치 단계에 sharp를 추가하세요.)');
}

// 봄툰 CDN 이미지를 서버(Node.js)에서 직접 받아와 작게 리사이즈·압축한 뒤 base64로 변환한다.
// (기존 Playwright 버전이 화면 캡쳐로 만들던 cover_url 값과 동일한 형식)
async function fetchImageAsDataUri(imageUrl) {
  const res = await fetch(imageUrl, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    },
  });
  if (!res.ok) {
    throw new Error(`이미지 다운로드 실패 (HTTP ${res.status})`);
  }
  const arrayBuffer = await res.arrayBuffer();
  const originalBuffer = Buffer.from(arrayBuffer);

  if (!sharp) {
    const mime = (res.headers.get('content-type') || 'image/jpeg').split(';')[0].trim();
    const dataUri = `data:${mime};base64,${originalBuffer.toString('base64')}`;
    if (dataUri.length <= MAX_COVER_DATA_URI_LENGTH) return dataUri;
    throw new Error('원본 이미지가 셀 한도(50,000자)를 초과함 (sharp 설치 시 해결됨)');
  }

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

// fetch가 응답을 받기 전에 끊겼을 때(fetch failed), 실제 원인을 사람이 읽을 수 있게 풀어준다.
function describeFetchError(error) {
  const cause = error && error.cause ? error.cause : null;
  if (!cause) return error.message || String(error);

  const parts = [
    cause.code ? `code=${cause.code}` : '',
    cause.errno ? `errno=${cause.errno}` : '',
    cause.syscall ? `syscall=${cause.syscall}` : '',
    cause.hostname ? `host=${cause.hostname}` : '',
    cause.message ? `msg=${cause.message}` : '',
  ].filter(Boolean);

  const hints = {
    ENOTFOUND: '도메인 이름을 찾지 못했습니다(DNS 문제).',
    EAI_AGAIN: '도메인 이름 조회에 실패했습니다(DNS 일시 오류).',
    ECONNREFUSED: '서버가 연결을 거부했습니다.',
    ECONNRESET: '서버가 연결을 강제로 끊었습니다. 호출 IP가 차단됐을 가능성이 높습니다.',
    ETIMEDOUT: '연결 시간이 초과됐습니다. 방화벽/IP 차단 가능성이 높습니다.',
    UND_ERR_CONNECT_TIMEOUT: '연결 시간이 초과됐습니다. 방화벽/IP 차단 가능성이 높습니다.',
    UND_ERR_HEADERS_TIMEOUT: '서버가 응답을 보내지 않았습니다.',
    CERT_HAS_EXPIRED: '서버 인증서 문제입니다.',
  };
  const hint = hints[cause.code] || '';

  return `${error.message} (${parts.join(' / ')})${hint ? ' → ' + hint : ''}`;
}

async function fetchRankingFromApi(apiKey) {
  const url = `${API_URL}?contentsType=${encodeURIComponent(CONTENTS_TYPE)}`;

  const headers = {
    'X-B2B-Api-Key': apiKey, // Spec 2-1: 유일한 필수 헤더
    // 일부 보안장비(WAF)가 User-Agent 없는 요청을 차단하므로 브라우저와 동일하게 보낸다.
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    Accept: 'application/json',
  };
  if (BALCONY_ID && BALCONY_ID.toLowerCase() !== 'off') {
    headers['x-balcony-id'] = BALCONY_ID;
  }

  const requestOptions = { method: 'GET', headers, signal: AbortSignal.timeout(30000) };

  let res;
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      res = await fetch(url, requestOptions);
      break;
    } catch (e) {
      lastError = e;
      console.log(`  봄툰 API 연결 ${attempt}회차 실패: ${describeFetchError(e)}`);
      if (attempt < 3) await new Promise(r => setTimeout(r, 3000 * attempt));
    }
  }

  if (!res) {
    throw new Error(
      `봄툰 API 연결 실패: ${describeFetchError(lastError)}\n` +
      '  → 사내 PC에서는 되는데 GitHub에서만 이 오류가 난다면, 봄툰 API가 호출 IP를 제한하고 있을 가능성이 높습니다. ' +
      '봄툰 담당자에게 "GitHub Actions 서버(고정 IP 아님)에서 호출하는데 연결이 차단된다. IP 제한이 걸려 있는지" 확인 요청이 필요합니다.'
    );
  }

  const bodyText = await res.text();

  // Spec 3-3: 실패 시 {"result":"ERROR","error":{"code":...,"message":...}}
  const readErrorMessage = () => {
    try {
      const j = JSON.parse(bodyText);
      if (j && j.error) return `${j.error.code || ''} ${j.error.message || ''}`.trim();
    } catch (e) {}
    return bodyText.slice(0, 300);
  };

  if (res.status === 401 || res.status === 403) {
    throw new Error(
      `봄툰 API가 ${res.status}를 반환했습니다: ${readErrorMessage()}\n` +
      '  → BOMTOON_API_KEY(GitHub Secret) 값을 확인해주세요.'
    );
  }
  if (res.status === 400) {
    throw new Error(
      `봄툰 API가 400을 반환했습니다: ${readErrorMessage()}\n` +
      `  → contentsType 값(현재 "${CONTENTS_TYPE}")을 확인해주세요. 허용값: COMIC | CARTOON | NOVEL`
    );
  }
  if (!res.ok) {
    throw new Error(`봄툰 API 호출 실패 (HTTP ${res.status}): ${readErrorMessage()}`);
  }

  const json = JSON.parse(bodyText);
  if (json.result && json.result !== 'SUCCESS') {
    throw new Error(`봄툰 API 응답 오류: result=${json.result}`);
  }
  const list = json && json.data && json.data.content;
  if (!Array.isArray(list)) {
    throw new Error('봄툰 API 응답에 data.content 배열이 없습니다.');
  }
  return list;
}

(async () => {
  const baseDir = __dirname;
  const outputDir = path.join(baseDir, 'output_bomtoon');
  const historyDir = path.join(outputDir, 'history');
  const masterDir = path.join(outputDir, 'master');
  const dateText = getTodayText();

  ensureDir(outputDir);
  ensureDir(historyDir);
  ensureDir(masterDir);

  const apiKey = process.env.BOMTOON_API_KEY;
  if (!apiKey) {
    console.error('오류: 환경변수 BOMTOON_API_KEY가 설정되어 있지 않습니다.');
    process.exitCode = 1;
    return;
  }

  try {
    console.log(`봄툰 API 호출 중... (contentsType=${CONTENTS_TYPE}, balcony=${BALCONY_ID})`);
    const apiData = await fetchRankingFromApi(apiKey);
    console.log(`봄툰 API 수신 건수: ${apiData.length} (이 중 상위 ${TOP_N}개 사용)`);

    const top20 = apiData
      .filter(item => Number(item.rank) >= 1 && Number(item.rank) <= TOP_N)
      .sort((a, b) => Number(a.rank) - Number(b.rank))
      .slice(0, TOP_N);

    if (top20.length === 0) {
      throw new Error('봄툰 API 응답에 랭킹 데이터가 없습니다 (data.content가 비어있음).');
    }
    if (top20.length < TOP_N) {
      console.log(`⚠️ 경고: ${TOP_N}개 중 ${top20.length}개만 수신되었습니다.`);
    }
    if (!top20.some(item => item.isAdult)) {
      console.log('⚠️ 경고: 상위 20개에 성인(19금) 작품이 하나도 없습니다. API 키 권한을 확인하세요.');
    }

    const previousRows = readLatestPreviousHistory(historyDir, dateText) || [];
    const hasPrevSnapshot = previousRows.length > 0;
    const prevMap = new Map(previousRows.map(row => [cleanText(row.title).toLowerCase(), row]));

    const rows = [];
    for (const item of top20) {
      const title = cleanText(item.title);
      const { writer, artist } = extractAuthors(item.artists);
      const genreNorm = getGenreNorm(item.genres);
      const blYn = genreNorm === 'BL' ? 'Y' : 'N';
      const adultYn = item.isAdult ? 'Y' : 'N';
      const launchDate = getLaunchDateFromApi(item.launchDate);
      const newInfo = getNewInfo(dateText, launchDate);
      const serialInfoText = mapSerialInfo(item.serialInfo);

      const detailUrl = normalizeBomtoonDetailUrl(item.detailUrl);
      const seriesId = extractSeriesIdFromBomtoonUrl(item.detailUrl) || String(item.seriesId ?? '');

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
        const curRank = Number(item.rank);
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
        `  ${item.rank}위: ${title} / 장르: ${genreNorm} / 성인: ${adultYn} / 변화: ${rankChange} / 표지: ${coverDataUri ? 'OK' : '실패'}`
      );

      rows.push({
        collect_date: dateText,
        category_key: PLATFORM_KEY,
        category_label: PLATFORM_LABEL,
        rank: item.rank,
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
        series_id: seriesId,
        detail_url: detailUrl,
        cover_url: coverDataUri,
      });
    }

    const csvLines = [CSV_HEADER.join(',')];
    for (const row of rows) {
      csvLines.push(CSV_HEADER.map(h => csvEscape(row[h])).join(','));
    }
    const csvPath = path.join(outputDir, `bomtoon_top20_${dateText}.csv`);
    writeUtf8Bom(csvPath, csvLines.join('\n'));

    const previewLines = rows.map(r => {
      const authorPart = r.writer === r.artist ? `글그림 ${r.writer}` : `글 ${r.writer} / 그림 ${r.artist}`;
      return `${r.rank}. ${r.title} / ${authorPart} / ${r.genre_norm} / BL ${r.bl_yn} / 성인 ${r.adult_yn} / 변화 ${r.rank_change} / 체류 ${r.stay_days}일 / ${r.serial_info}`;
    });
    const previewPath = path.join(outputDir, `bomtoon_top20_preview_${dateText}.txt`);
    writeUtf8Bom(previewPath, previewLines.join('\n'));

    writeJson(getHistoryFilePath(historyDir, dateText), rows);

    const masterCsvPath = path.join(masterDir, 'bomtoon_top20_master.csv');
    const appendedCount = appendRowsToMaster(masterCsvPath, rows);

    console.log(`\n완료: 봄툰 웹툰 (API 방식)`);
    console.log(`CSV 저장: ${csvPath}`);
    console.log(`미리보기 저장: ${previewPath}`);
    console.log(`히스토리 저장: ${getHistoryFilePath(historyDir, dateText)}`);
    console.log(`누적 CSV 저장: ${masterCsvPath}`);
    console.log(`이번 실행 누적 추가 건수: ${appendedCount}`);
  } catch (error) {
    console.error('오류 발생:', error.message || error);
    process.exitCode = 1;
  }
})();
