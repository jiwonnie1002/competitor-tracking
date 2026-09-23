console.log('NAVER NEW LABEL VERSION: 2026-07-07-v4-adult-auth-storage');
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const DAY_LABELS = {
  sun: '일요',
  mon: '월요',
  tue: '화요',
  wed: '수요',
  thu: '목요',
  fri: '금요',
  sat: '토요'
};

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function cleanText(value) {
  return String(value ?? '')
    .replace(/\u200b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitLines(value) {
  return String(value ?? '')
    .split('\n')
    .map(cleanText)
    .filter(Boolean);
}

function unique(arr) {
  return [...new Set((arr || []).map(cleanText).filter(Boolean))];
}

function stripLeadingBadges(text) {
  let result = cleanText(text);

  while (true) {
    const next = result
      .replace(/^(청유물|휴재|신작|업데이트|UP|NEW|19세|15세|12세|전체이용가)\s+/i, '')
      .trim();

    if (next === result) break;
    result = next;
  }

  return result;
}

function normalizeTitleKey(title) {
  return cleanText(stripLeadingBadges(title)).toLowerCase();
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

function getDateInfo(offsetDays = -1) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);

  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');

  return {
    date: d,
    dateText: `${yyyy}-${mm}-${dd}`,
    dayKey: DAY_KEYS[d.getDay()]
  };
}

function getYesterdayInfo() {
  // KST = UTC + 9시간
  const d = new Date(new Date().getTime() + 9 * 60 * 60 * 1000);
  d.setUTCDate(d.getUTCDate() - 1); // KST 기준 어제
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return {
    date: d,
    dateText: `${yyyy}-${mm}-${dd}`,
    dayKey: DAY_KEYS[d.getUTCDay()]
  };
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

function getPreviousWeekInfo() {
  const y = getYesterdayInfo();
  const d = new Date(y.date.getTime());
  d.setUTCDate(d.getUTCDate() - 7);

  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');

  return {
    date: d,
    dateText: `${yyyy}-${mm}-${dd}`,
    dayKey: DAY_KEYS[d.getUTCDay()]
  };
}

function isNoiseLine(text) {
  const v = cleanText(text);

  if (!v) return true;

  return (
    /^(청유물|휴재|신작|업데이트|UP|NEW|19세|15세|12세|전체이용가)$/.test(v) ||
    /^관심$/.test(v) ||
    /^관심\s*\d/.test(v) ||
    /^별점/.test(v) ||
    /^★?\s*\d+\.\d+$/.test(v) ||
    /^작가$/.test(v) ||
    /^장르$/.test(v) ||
    /^연재$/.test(v) ||
    /^첫화보기$/.test(v) ||
    /^최신화부터$/.test(v) ||
    /^1화부터$/.test(v) ||
    /^공유하기$/.test(v) ||
    /^목록$/.test(v) ||
    /광고|AD|프로모션|추천작품|추천 웹툰|추천/.test(v) ||
    /베스트도전|도전만화/.test(v)
  );
}

function pickTitleFromListItem(item) {
  const candidates = [
    item.titleAttr,
    item.imgAlt,
    ...(item.listLines || [])
  ];

  for (const raw of candidates) {
    const text = stripLeadingBadges(raw);
    if (!text) continue;
    if (isNoiseLine(text)) continue;
    if (/관심\s*\d/.test(text)) continue;
    if (text.length > 80) continue;
    // 평점(예: 9.83)을 제목으로 잘못 잡는 케이스 방지
    if (/^★?\s*\d+\.\d+$/.test(text)) continue;

    // 네이버에는 <시루/24/1km>처럼 제목 자체에 '/'가 들어가는 작품이 있으므로
    // '/' 포함 여부만으로 제목 후보를 제외하지 않는다.
    return text;
  }

  return '미확인';
}

function sanitizePersonName(name) {
  return cleanText(name)
    .replace(/작가페이지/g, '')
    .replace(/\b페이지\b/g, '')
    .replace(/\b작가\b/g, '')
    .replace(/\b새소식\b/g, '')
    .replace(/\b프로필\b/g, '')
    .replace(/\b홈\b/g, '')
    .replace(/\b본문 바로가기\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isBadPersonName(name) {
  const v = sanitizePersonName(name);

  if (!v) return true;

  return (
    v === '페이지' ||
    v === '작가페이지' ||
    v === '글' ||
    v === '그림' ||
    v === '작화' ||
    v === '원작' ||
    v === '스토리' ||
    v === '각색' ||
    /네이버|웹툰|웹소설|시리즈|검색페이지 이동|MY|홈|요일별|완결작|베스트도전|컷츠|NEW|웹툰 숏폼 출시/.test(v) ||
    /^월$|^화$|^수$|^목$|^금$|^토$|^일$|매일\+/.test(v) ||
    /일요일|월요일|화요일|수요일|목요일|금요일|토요일/.test(v) ||
    /작품 기본 정보|작품 상세 정보|별점|장르|연재|관심|첫화보기|최신화부터|1화부터|공유하기|목록/.test(v) ||
    /^★?\s*\d+\.\d+$/.test(v) ||
    /19세|15세|12세|전체이용가|청유물|청불|성인/.test(v)
  );
}

function parseNames(text) {
  return unique(
    cleanText(text)
      .split(/[\/,|·•ㆍ]/)
      .map(v => sanitizePersonName(v))
      .filter(v => !isBadPersonName(v))
  );
}

function parseAuthorsFromList(item) {
  const lines = unique(item.listLines || [])
    .map(stripLeadingBadges)
    .filter(v => !isNoiseLine(v))
    .filter(v => v !== item.title);

  let writer = '';
  let artist = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    let m = line.match(/^글\s*[:：]?\s*(.+)$/);
    if (m) {
      writer = sanitizePersonName(m[1]);
      continue;
    }

    m = line.match(/^스토리\s*[:：]?\s*(.+)$/);
    if (m && !writer) {
      writer = sanitizePersonName(m[1]);
      continue;
    }

    m = line.match(/^원작\s*[:：]?\s*(.+)$/);
    if (m && !writer) {
      writer = sanitizePersonName(m[1]);
      continue;
    }

    m = line.match(/^(그림|작화)\s*[:：]?\s*(.+)$/);
    if (m) {
      artist = sanitizePersonName(m[2]);
      continue;
    }

    if (line === '글' && lines[i + 1]) {
      writer = sanitizePersonName(lines[i + 1]);
      continue;
    }

    if ((line === '그림' || line === '작화') && lines[i + 1]) {
      artist = sanitizePersonName(lines[i + 1]);
      continue;
    }
  }

  if (!writer && !artist) {
    const joined = lines.join(' / ');
    const names = parseNames(joined);

    if (names.length === 1) {
      writer = names[0];
      artist = names[0];
    } else if (names.length >= 2) {
      writer = names[0];
      artist = names[1];
    }
  }

  if (isBadPersonName(writer)) writer = '';
  if (isBadPersonName(artist)) artist = '';

  writer = writer || '미확인';
  artist = artist || writer || '미확인';

  return { writer, artist };
}

function parseGenreFromList(item) {
  const lines = unique(item.listLines || []).map(stripLeadingBadges);

  const genrePatterns = [
    /로맨스|순정|연애|로판|BL|GL|백합/,
    /판타지|현판|현대판타지|게임판타지|SF|초능력|이세계|회귀|귀환|환생|빙의|헌터|던전|마법|아포칼립스|레벨업|시스템/,
    /액션|스포츠|히어로|범죄|느와르|누아르|첩보|격투|전쟁|학원액션/,
    /일상|에피소드|힐링|먹방|요리|반려|육아|직장생활|학교생활/,
    /스릴러|공포|미스터리|호러|서스펜스|추리|심리|데스게임|재난|서바이벌/,
    /개그|코미디|병맛|블랙코미디/,
    /무협|선협|사극|강호|협객|검협/,
    /드라마|학원|성장|감성|서사|복수|오피스|가족|청춘|휴먼|캠퍼스/
  ];

  for (const line of lines) {
    if (genrePatterns.some(p => p.test(line))) {
      return line;
    }
  }

  return '미확인';
}

function isGenreLikeTag(tag) {
  const text = cleanText(tag).replace(/^#/, '');

  return /로맨스|순정|연애|로판|BL|GL|백합|판타지|현판|현대판타지|게임판타지|SF|초능력|이세계|회귀|귀환|환생|빙의|헌터|던전|마법|아포칼립스|레벨업|시스템|액션|스포츠|히어로|범죄|느와르|누아르|첩보|격투|전쟁|일상|에피소드|힐링|먹방|요리|반려|육아|스릴러|공포|미스터리|추리|심리|호러|서스펜스|개그|코미디|병맛|무협|선협|사극|드라마|학원|성장|감성|복수|청춘|휴먼|오피스|가족/.test(text);
}

function normalizeGenre(raw) {
  const text = cleanText(raw).replace(/^#/, '');

  if (!text || text === '미확인') return '기타';

  if (/GL|백합/.test(text)) return 'GL';
  if (/BL|보이즈러브/.test(text)) return 'BL';
  if (/로맨스|순정|연애|로판/.test(text)) return '로맨스';

  if (/판타지|현판|현대판타지|게임판타지|SF|초능력|이세계|회귀|귀환|환생|빙의|헌터|던전|마법|용사|마왕|괴수|레벨업|시스템|아포칼립스|전생|이능력/.test(text)) {
    return '판타지';
  }

  if (/액션|스포츠|히어로|학원액션|범죄|느와르|누아르|첩보|격투|전쟁|검술|카타르시스|사이다/.test(text)) {
    return '액션';
  }

  if (/일상|에피소드|힐링|먹방|요리|반려|육아|브이로그|직장생활|학교생활/.test(text)) {
    return '일상';
  }

  if (/스릴러|공포|미스터리|호러|서스펜스|추리|심리|데스게임|재난|서바이벌/.test(text)) {
    return '스릴러';
  }

  if (/개그|코미디|병맛|블랙코미디/.test(text)) {
    return '개그';
  }

  if (/무협|선협|사극|강호|협객|검협/.test(text)) {
    return '무협';
  }

  if (/드라마|학원|성장|감성|서사|복수|오피스|가족|청춘|휴먼|캠퍼스|시대극/.test(text)) {
    return '드라마';
  }

  return '드라마';
}

function getRoleType(text) {
  const v = cleanText(text);

  if (/^(글|스토리|각색)$/.test(v)) return 'writer';
  if (/^(그림|작화)$/.test(v)) return 'artist';
  if (/^(원작)$/.test(v)) return 'original';

  return '';
}

function extractRoleNameFromSegment(segment, roleRegex) {
  const text = cleanText(segment);
  if (!text) return '';

  let m = text.match(new RegExp(`^(.+?)\\s*[·•ㆍ]\\s*(?:${roleRegex.source})$`));
  if (m) return sanitizePersonName(m[1]);

  m = text.match(new RegExp(`^(?:${roleRegex.source})\\s*[·•ㆍ:]?\\s*(.+)$`));
  if (m) return sanitizePersonName(m[1]);

  m = text.match(new RegExp(`^(.+?)\\s+(?:${roleRegex.source})$`));
  if (m) return sanitizePersonName(m[1]);

  return '';
}

function resolveAuthorInfo(detailMeta, fallback) {
  const sourceLines = unique([
    ...(detailMeta.authorLines || []),
    ...(detailMeta.authorCandidates || [])
  ])
    .map(v => cleanText(v))
    .filter(Boolean)
    .filter(v => !/^#/.test(v))
    .filter(v => !/^(장르|연재|관심|첫화보기|최신화부터|1화부터|목록|공유하기)$/.test(v))
    .filter(v => v.length <= 80);

  const sourceText = sourceLines.join(' / ');
  const segments = unique(
    sourceText
      .split(/[\/|]/)
      .map(v => cleanText(v))
      .filter(Boolean)
  );

  let writer = '';
  let artist = '';

  const writerRole = /(글|스토리|각색)/;
  const artistRole = /(그림|작화)/;
  const originalRole = /(원작)/;

  for (const seg of segments) {
    if (!writer) {
      const v = extractRoleNameFromSegment(seg, writerRole);
      if (v && !isBadPersonName(v)) writer = v;
    }
    if (!artist) {
      const v = extractRoleNameFromSegment(seg, artistRole);
      if (v && !isBadPersonName(v)) artist = v;
    }
  }

  if (!writer) {
    for (const seg of segments) {
      const v = extractRoleNameFromSegment(seg, originalRole);
      if (v && !isBadPersonName(v)) {
        writer = v;
        break;
      }
    }
  }

  if (!writer || !artist) {
    const tokens = [];

    for (const line of sourceLines) {
      const parts = line.split(/[\/|]/).map(v => cleanText(v)).filter(Boolean);
      for (const part of parts) {
        const miniParts = part.split(/[·•ㆍ]/).map(v => cleanText(v)).filter(Boolean);
        if (miniParts.length > 1) {
          tokens.push(...miniParts);
        } else {
          tokens.push(part);
        }
      }
    }

    for (let i = 0; i < tokens.length; i++) {
      const token = cleanText(tokens[i]);
      const roleType = getRoleType(token);

      if (!roleType) continue;

      const prev = i > 0 ? sanitizePersonName(tokens[i - 1]) : '';
      const next = i + 1 < tokens.length ? sanitizePersonName(tokens[i + 1]) : '';

      if (roleType === 'writer') {
        if (!writer && prev && !isBadPersonName(prev)) {
          writer = prev;
          continue;
        }
        if (!writer && next && !isBadPersonName(next)) {
          writer = next;
          continue;
        }
      }

      if (roleType === 'artist') {
        if (!artist && prev && !isBadPersonName(prev)) {
          artist = prev;
          continue;
        }
        if (!artist && next && !isBadPersonName(next)) {
          artist = next;
          continue;
        }
      }

      if (roleType === 'original') {
        if (!writer && prev && !isBadPersonName(prev)) {
          writer = prev;
          continue;
        }
        if (!writer && next && !isBadPersonName(next)) {
          writer = next;
          continue;
        }
      }
    }
  }

  if (!writer || !artist) {
    const names = parseNames(sourceText);

    if (names.length === 1) {
      writer = writer || names[0];
      artist = artist || names[0];
    } else if (names.length >= 2) {
      writer = writer || names[0];
      artist = artist || names[1];
    }
  }

  if (!writer) writer = fallback.writer || '미확인';
  if (!artist) artist = fallback.artist || writer || '미확인';

  if (isBadPersonName(writer)) writer = fallback.writer || '미확인';
  if (isBadPersonName(artist)) artist = fallback.artist || writer || '미확인';

  return {
    writer,
    artist,
    authorDisplay: `글 ${writer} / 그림 ${artist}`
  };
}

function resolveGenreRaw(detailMeta, fallbackGenre) {
  const hashtags = unique(detailMeta.hashtags || [])
    .map(v => cleanText(v).replace(/^#/, ''))
    .filter(Boolean);

  const genreLikeHashtag = hashtags.find(isGenreLikeTag);
  if (genreLikeHashtag) return genreLikeHashtag;

  if (hashtags[0]) return hashtags[0];

  const genreCandidates = unique([
    ...(detailMeta.genreLines || []),
    ...(detailMeta.genreCandidates || [])
  ])
    .map(v => cleanText(v).replace(/^#/, ''))
    .filter(Boolean)
    .filter(v => !/^(장르|연재|작가|관심|첫화보기|최신화부터|1화부터)$/.test(v));

  const genreLikeCandidate = genreCandidates.find(isGenreLikeTag);
  if (genreLikeCandidate) return genreLikeCandidate;

  if (genreCandidates[0]) return genreCandidates[0];
  if (fallbackGenre && fallbackGenre !== '미확인') return fallbackGenre;

  return '미확인';
}

function resolveAdultYn(listText, detailMeta) {
  const combined = [
    listText || '',
    ...(detailMeta.ratingLines || []),
    detailMeta.topText || ''
  ].join(' ');

  return /청유물|청소년\s*유해|19세|19세 이용가|청불|성인/.test(combined) ? 'Y' : 'N';
}

function getHistoryFilePath(historyDir, dateText, dayKey) {
  return path.join(historyDir, `naver_top10_${dateText}_${dayKey}.json`);
}

function readPreviousWeekHistory(historyDir, prevWeekInfo) {
  const filePath = getHistoryFilePath(historyDir, prevWeekInfo.dateText, prevWeekInfo.dayKey);

  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function buildPrevRankMap(prevRows) {
  const map = new Map();

  for (const row of prevRows || []) {
    const key = normalizeTitleKey(row.title);
    if (!key) continue;
    map.set(key, Number(row.rank));
  }

  return map;
}

function getRankChange(currentRank, prevRank, hasPrevData) {
  if (!hasPrevData) return '기준없음';
  if (!prevRank) return 'NEW';
  if (prevRank === currentRank) return '-';

  const diff = prevRank - currentRank;
  if (diff > 0) return `▲${diff}`;
  return `▼${Math.abs(diff)}`;
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

function appendRowsToMaster(masterCsvPath, rows) {
  const header = [
    'collect_date',
    'target_weekday',
    'rank',
    'title',
    'writer',
    'artist',
    'genre_raw',
    'genre_norm',
    'adult_yn',
    'launch_date',
    'new_yn',
    'new_days',
    'rank_change',
    'list_url',
    'detail_url',
    'cover_url',
    'source'
  ];

  const exists = fs.existsSync(masterCsvPath);
  const existingKeys = new Set();

  if (exists) {
    const raw = fs.readFileSync(masterCsvPath, 'utf8').replace(/^\uFEFF/, '');
    const lines = raw.split(/\r?\n/).filter(Boolean);

    for (let i = 1; i < lines.length; i++) {
      const cols = parseCsvLine(lines[i]);
      if (cols.length < 4) continue;

      const key = [
        cleanText(cols[0]),
        cleanText(cols[1]),
        cleanText(cols[2]),
        normalizeTitleKey(cols[3])
      ].join('||');

      existingKeys.add(key);
    }
  }

  const linesToAppend = [];

  for (const row of rows) {
    const key = [
      cleanText(row.collect_date),
      cleanText(row.target_weekday),
      cleanText(row.rank),
      normalizeTitleKey(row.title)
    ].join('||');

    if (existingKeys.has(key)) {
      continue;
    }

    existingKeys.add(key);

    linesToAppend.push([
      csvEscape(row.collect_date),
      csvEscape(row.target_weekday),
      csvEscape(row.rank),
      csvEscape(row.title),
      csvEscape(row.writer),
      csvEscape(row.artist),
      csvEscape(row.genre_raw),
      csvEscape(row.genre_norm),
      csvEscape(row.adult_yn),
      csvEscape(row.launch_date),
      csvEscape(row.new_yn),
      csvEscape(row.new_days),
      csvEscape(row.rank_change),
      csvEscape(row.list_url),
      csvEscape(row.detail_url),
      csvEscape(row.cover_url),
      csvEscape(row.source)
    ].join(','));
  }

  if (!exists) {
    const content =
      header.join(',') +
      (linesToAppend.length ? '\n' + linesToAppend.join('\n') : '') +
      '\n';

    fs.writeFileSync(masterCsvPath, '\ufeff' + content, 'utf8');
    return linesToAppend.length;
  }

  if (linesToAppend.length > 0) {
    fs.appendFileSync(masterCsvPath, linesToAppend.join('\n') + '\n', 'utf8');
  }

  return linesToAppend.length;
}

async function handleNaverAdultGate(page, label) {
  try {
    await page.waitForTimeout(500);

    const buttonTexts = [
      '확인',
      '동의',
      '계속',
      '성인 인증',
      '성인인증',
      '본인 인증',
      '본인인증',
      '로그인'
    ];

    for (const text of buttonTexts) {
      const locator = page.getByText(text, { exact: false }).first();
      const visible = await locator.isVisible({ timeout: 700 }).catch(() => false);

      if (visible) {
        await locator.click({ timeout: 2000 }).catch(() => {});
        await page.waitForTimeout(1200);
        console.log(`  네이버 성인/확인 버튼 처리 시도(${label}): ${text}`);
        break;
      }
    }

    const bodyText = await page.evaluate(() => String(document.body?.innerText || '')).catch(() => '');

    if (/성인\s*인증|본인\s*인증|청소년\s*이용불가|18세|로그인.*필요|접근할 수 없습니다|연령\s*확인|유해\s*매체/.test(bodyText)) {
      console.log(`  ⚠️ 네이버 18세 상세 접근 제한 문구 감지(${label})`);
      console.log('  제한 문구 일부: ' + bodyText.replace(/\s+/g, ' ').slice(0, 180));
      return false;
    }

    return true;
  } catch (e) {
    console.log(`  네이버 성인/확인 처리 중 오류(${label}): ${e.message}`);
    return false;
  }
}

async function fetchDetailMeta(page, titleId) {
  const detailUrl = `https://m.comic.naver.com/webtoon/list?titleId=${titleId}`;

  try {
    await page.goto(detailUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });

    try {
      await page.waitForLoadState('networkidle', { timeout: 4000 });
    } catch (e) {
      // ignore
    }

    await page.waitForTimeout(2000);
    await handleNaverAdultGate(page, 'detail');
    await page.waitForTimeout(800);

    const currentUrl = page.url();
    if (/nid\.naver\.com/.test(currentUrl)) {
      return {
        detailUrl: currentUrl,
        blocked: true,
        authorLines: [],
        authorCandidates: [],
        genreLines: [],
        genreCandidates: [],
        ratingLines: [],
        hashtags: [],
        topText: '',
        launchDate: ''
      };
    }

    return await page.evaluate(() => {
      function clean(value) {
        return String(value ?? '')
          .replace(/\u200b/g, '')
          .replace(/\s+/g, ' ')
          .trim();
      }

      function splitLines(value) {
        return String(value ?? '')
          .split('\n')
          .map(clean)
          .filter(Boolean);
      }

      function uniqueLocal(arr) {
        return [...new Set(arr.map(clean).filter(Boolean))];
      }

      const allLines = splitLines(document.body.innerText).slice(0, 400);

      function findIndex(labels) {
        return allLines.findIndex(line =>
          labels.some(label => line === label || line.startsWith(label))
        );
      }

      function sectionBetween(startLabels, endLabels, maxCount = 12) {
        const s = findIndex(startLabels);
        if (s < 0) return [];

        let e = -1;
        for (let i = s + 1; i < Math.min(allLines.length, s + 40); i++) {
          if (endLabels.some(label => allLines[i] === label || allLines[i].startsWith(label))) {
            e = i;
            break;
          }
        }

        return allLines.slice(s + 1, e > -1 ? e : Math.min(allLines.length, s + 1 + maxCount));
      }

      const visibleTexts = Array.from(
        document.querySelectorAll('div,span,p,a,li,strong,em')
      )
        .map(el => {
          const text = clean(el.textContent);
          const rect = el.getBoundingClientRect();
          return {
            text,
            top: rect.top,
            width: rect.width,
            height: rect.height
          };
        })
        .filter(v =>
          v.text &&
          v.width > 0 &&
          v.height > 0 &&
          v.top >= 0 &&
          v.top < 1800 &&
          v.text.length <= 120
        );

      const authorLines = sectionBetween(['작가'], ['장르', '연재'], 20);
      const genreLines = sectionBetween(['장르'], ['연재', '관심', '첫화보기', '최신화부터'], 15);
      const ratingLines = sectionBetween(['연재'], ['관심', '첫화보기', '최신화부터', '1화부터'], 15);

      const authorLabelTop = visibleTexts
        .filter(v => v.text === '작가')
        .map(v => v.top)
        .sort((a, b) => a - b)[0];

      const nextMetaTop = visibleTexts
        .filter(v => (v.text === '장르' || v.text === '연재') && typeof authorLabelTop === 'number' && v.top > authorLabelTop)
        .map(v => v.top)
        .sort((a, b) => a - b)[0];

      const authorCandidates = uniqueLocal(
        visibleTexts
          .filter(v => {
            if (typeof authorLabelTop !== 'number') return false;
            const endTop = typeof nextMetaTop === 'number' ? nextMetaTop + 15 : authorLabelTop + 220;
            return v.top >= authorLabelTop - 10 && v.top <= endTop && v.text.length <= 60;
          })
          .map(v => v.text)
          .filter(text =>
            !/네이버|웹툰|웹소설|시리즈|검색페이지 이동|MY|홈|요일별|완결작|베스트도전|컷츠|NEW|웹툰 숏폼 출시|본문 바로가기|작품 기본 정보|작품 상세 정보|별점/.test(text)
          )
      );

      const genreCandidates = uniqueLocal(
        visibleTexts
          .map(v => v.text)
          .filter(text =>
            /^#/.test(text) ||
            /로맨스|순정|연애|로판|BL|GL|백합|판타지|현판|현대판타지|게임판타지|SF|초능력|이세계|회귀|귀환|환생|빙의|헌터|던전|마법|액션|스포츠|히어로|범죄|누아르|느와르|일상|에피소드|힐링|스릴러|공포|미스터리|추리|개그|코미디|무협|선협|사극|드라마|학원|성장|감성|복수|청춘|휴먼|오피스|가족/.test(text)
          )
      );

      const hashtags = uniqueLocal(
        visibleTexts
          .map(v => v.text)
          .filter(text => /^#/.test(text) && text.length <= 30)
      );

      return {
        detailUrl: location.href,
        blocked: false,
        authorLines,
        authorCandidates,
        genreLines,
        genreCandidates,
        ratingLines,
        hashtags,
        topText: allLines.slice(0, 220).join(' ')
      };
    });
  } catch (e) {
    return {
      detailUrl,
      blocked: true,
      authorLines: [],
      authorCandidates: [],
      genreLines: [],
      genreCandidates: [],
      ratingLines: [],
      hashtags: [],
      topText: ''
    };
  }
}

async function fetchLaunchTextFromAscEpisodeList(page, titleId) {
  const urls = [
    `https://m.comic.naver.com/webtoon/list?titleId=${titleId}&sortOrder=ASC`,
    `https://comic.naver.com/webtoon/list?titleId=${titleId}&sortOrder=ASC`
  ];

  for (const url of urls) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });

      try {
        await page.waitForLoadState('networkidle', { timeout: 4000 });
      } catch (e) {
        // ignore
      }

      await page.waitForTimeout(1500);
      await handleNaverAdultGate(page, 'asc-list');
      await page.waitForTimeout(800);

      const currentUrl = page.url();
      if (/nid\.naver\.com/.test(currentUrl)) {
        console.log(`  네이버 ASC 회차 접근 제한: ${currentUrl}`);
        continue;
      }

      // 일부 회차 목록은 스크롤 후 날짜 텍스트가 붙는 경우가 있어 1회 보강
      try {
        await page.evaluate(async () => {
          window.scrollTo(0, document.body.scrollHeight);
          await new Promise(resolve => setTimeout(resolve, 900));
          window.scrollTo(0, 0);
          await new Promise(resolve => setTimeout(resolve, 300));
        });
      } catch (e) {
        // ignore
      }

      const payload = await page.evaluate(() => {
        function clean(value) {
          return String(value ?? '')
            .replace(/\u200b/g, '')
            .replace(/\s+/g, ' ')
            .trim();
        }

        const bodyText = clean(document.body?.innerText || '');
        const scriptText = Array.from(document.scripts || [])
          .map(s => String(s.textContent || ''))
          .filter(Boolean)
          .join('\n')
          .slice(0, 300000);

        return {
          url: location.href,
          bodyText,
          scriptText
        };
      });

      const combined = [payload.bodyText, payload.scriptText].filter(Boolean).join(' ');
      if (combined) return combined;
    } catch (e) {
      console.log(`  네이버 ASC 회차 조회 실패: ${url} / ${e.message}`);
    }
  }

  return '';
}


async function getPcRankedListItems(page, dayLabel) {
  return await page.evaluate((dayLabel) => {
    function clean(value) {
      return String(value ?? '')
        .replace(/\u200b/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    }

    function splitLines(value) {
      return String(value ?? '')
        .split('\n')
        .map(clean)
        .filter(Boolean);
    }

    function isVisible(el) {
      const rect = el.getBoundingClientRect();
      return rect.width > 20 && rect.height > 20;
    }

    function getTitleIdFromHref(href) {
      const m = String(href || '').match(/titleId=(\d+)/);
      return m ? m[1] : '';
    }

    function countUniqueTitleIds(el) {
      const ids = new Set();

      const anchors = Array.from(el.querySelectorAll('a[href*="titleId="]'));
      for (const a of anchors) {
        const href = a.getAttribute('href') || '';
        if (href.includes('/challenge/')) continue;
        if (href.includes('/bestChallenge/')) continue;

        const id = getTitleIdFromHref(href);
        if (id) ids.add(id);
      }

      return ids.size;
    }

    function findExactTextNode(text) {
      const nodes = Array.from(document.querySelectorAll('h1,h2,h3,h4,strong,span,div,p,a'));
      return nodes.find(el => isVisible(el) && clean(el.textContent) === text) || null;
    }

    function findSmallestAncestorWithTitleIds(node, minCount = 1, extraCheck = null) {
      if (!node) return null;

      let current = node.parentElement;
      const candidates = [];

      while (current && current !== document.body) {
        const titleCount = countUniqueTitleIds(current);
        const text = clean(current.innerText || '');

        if (titleCount >= minCount) {
          if (!extraCheck || extraCheck(current, text, titleCount)) {
            candidates.push({
              el: current,
              titleCount,
              nodeCount: current.querySelectorAll('*').length
            });
          }
        }

        current = current.parentElement;
      }

      if (!candidates.length) return null;

      candidates.sort((a, b) => {
        if (a.nodeCount !== b.nodeCount) return a.nodeCount - b.nodeCount;
        return a.titleCount - b.titleCount;
      });

      return candidates[0].el;
    }

    function isInside(el, ancestor) {
      if (!el || !ancestor) return false;
      return ancestor.contains(el);
    }

    function findCardRoot(anchor, container) {
      let current = anchor;
      let best = anchor;

      while (current && current.parentElement && current.parentElement !== container) {
        const parent = current.parentElement;
        const text = clean(parent.innerText || '');
        const titleCount = countUniqueTitleIds(parent);

        if (titleCount === 1 && text && text.length <= 450) {
          best = parent;
          current = parent;
        } else {
          break;
        }
      }

      return best;
    }

    const recommendHeading = findExactTextNode(`추천 ${dayLabel}웹툰`);
    const allHeading = findExactTextNode(`전체 ${dayLabel}웹툰`);
    const realtimeHeading = findExactTextNode('실시간 인기웹툰');

    const recommendSection = findSmallestAncestorWithTitleIds(
      recommendHeading,
      1,
      (el, text, titleCount) => /추천/.test(text) && titleCount >= 1
    );

    const realtimeSection = findSmallestAncestorWithTitleIds(
      realtimeHeading,
      1,
      (el, text, titleCount) => /실시간 인기웹툰/.test(text) && titleCount >= 1
    );

    const mainContainer = findSmallestAncestorWithTitleIds(
      allHeading,
      10,
      (el, text, titleCount) => {
        return (
          /전체/.test(text) &&
          /인기순/.test(text) &&
          /업데이트순/.test(text) &&
          /조회순/.test(text) &&
          /별점순/.test(text) &&
          titleCount >= 10
        );
      }
    ) || document.body;

    const anchors = Array.from(mainContainer.querySelectorAll('a[href*="titleId="]'));
    const items = [];
    const seen = new Set();

    for (const anchor of anchors) {
      const href = anchor.getAttribute('href') || '';
      if (!href.includes('titleId=')) continue;
      if (href.includes('/challenge/')) continue;
      if (href.includes('/bestChallenge/')) continue;

      if (recommendSection && isInside(anchor, recommendSection)) continue;
      if (realtimeSection && isInside(anchor, realtimeSection)) continue;

      const titleId = getTitleIdFromHref(href);
      if (!titleId) continue;
      if (seen.has(titleId)) continue;

      const card = findCardRoot(anchor, mainContainer);
      const listText = clean(card.innerText || anchor.innerText || '');
      const listLines = splitLines(card.innerText || anchor.innerText || '');

      if (!listText) continue;
      if (/광고|AD|프로모션|추천작품|추천 웹툰|추천/.test(listText)) continue;
      if (/베스트도전|도전만화/.test(listText)) continue;
      if (/실시간 인기웹툰/.test(listText)) continue;
      if (/추천 .*웹툰/.test(listText)) continue;

      const fullHref = new URL(href, location.origin).href;
      const titleAttr = clean(anchor.getAttribute('title') || '');
      const imgAlt = clean(
        anchor.querySelector('img')?.getAttribute('alt') ||
        card.querySelector('img')?.getAttribute('alt') ||
        Array.from(card.querySelectorAll('img[alt]')).map(img => clean(img.getAttribute('alt'))).find(Boolean) ||
        ''
      );

      items.push({
        titleId,
        href: fullHref,
        titleAttr,
        imgAlt,
        listText,
        listLines
      });

      seen.add(titleId);
    }

    return {
      containerInfo: {
        dayLabel,
        mainContainerTag: mainContainer.tagName,
        mainContainerTitleCount: countUniqueTitleIds(mainContainer),
        hasRecommendSection: !!recommendSection,
        hasRealtimeSection: !!realtimeSection
      },
      items
    };
  }, dayLabel);
}


async function captureCoverImagesFromRankingPage(page, rankedItems) {
  console.log('표지 캡쳐 시작');

  for (const item of rankedItems) {
    let coverUrl = '';

    try {
      const selector = `a[href*="titleId=${item.titleId}"]`;
      const anchors = page.locator(selector);
      const count = await anchors.count();

      for (let i = 0; i < count; i++) {
        const anchor = anchors.nth(i);

        const visible = await anchor.isVisible().catch(() => false);
        if (!visible) continue;

        const isSameTitleCard = await anchor.evaluate((el, title) => {
          function clean(value) {
            return String(value ?? '')
              .replace(/\u200b/g, '')
              .replace(/\s+/g, ' ')
              .trim();
          }

          const titleText = clean(title);
          const titleAttr = clean(el.getAttribute('title') || '');
          const altText = clean(el.querySelector('img')?.getAttribute('alt') || '');
          const ownText = clean(el.innerText || el.textContent || '');

          if (titleAttr.includes(titleText)) return true;
          if (altText.includes(titleText)) return true;
          if (ownText.includes(titleText)) return true;

          let current = el.parentElement;
          for (let depth = 0; current && depth < 7; depth++) {
            const text = clean(current.innerText || current.textContent || '');
            if (text.includes(titleText)) return true;
            current = current.parentElement;
          }

          return false;
        }, item.title).catch(() => false);

        if (!isSameTitleCard) continue;

        let target = anchor.locator('img').first();

        const hasVisibleImage =
          (await target.count().catch(() => 0)) > 0 &&
          (await target.isVisible().catch(() => false));

        if (!hasVisibleImage) {
          target = anchor;
        }

        const buffer = await target.screenshot({
          type: 'jpeg',
          quality: 45,
          timeout: 7000
        }).catch(() => null);

        if (buffer && buffer.length > 0) {
          coverUrl = `data:image/jpeg;base64,${buffer.toString('base64')}`;
          break;
        }
      }

      item.cover_url = coverUrl;
      console.log(`${item.rank}위 표지 캡쳐 ${coverUrl ? '완료' : '실패'}: ${item.title}`);
    } catch (e) {
      item.cover_url = '';
      console.log(`${item.rank}위 표지 캡쳐 실패: ${item.title}`);
    }
  }

  console.log('표지 캡쳐 종료');
}

(async () => {
  const baseDir = __dirname;
  const outputDir = path.join(baseDir, 'output');
  const historyDir = path.join(outputDir, 'history');
  const masterDir = path.join(outputDir, 'master');
  const authFile = path.join(baseDir, '.auth', 'naver_auth.json');
  const sessionStorageFile = path.join(baseDir, '.auth', 'naver_session_storage.json');
  const localStorageFile = path.join(baseDir, '.auth', 'naver_local_storage.json');

  ensureDir(outputDir);
  ensureDir(historyDir);
  ensureDir(masterDir);

  const yesterday = getYesterdayInfo();
  const prevWeek = getPreviousWeekInfo();

  const dateText = yesterday.dateText;
  const dayKey = yesterday.dayKey;
  const dayLabel = DAY_LABELS[dayKey];

  const listUrl = `https://comic.naver.com/webtoon?tab=${dayKey}`;

  const browser = await chromium.launch({
    headless: true
  });

  const contextOptions = {
    viewport: { width: 1440, height: 1400 },
    locale: 'ko-KR'
  };

  if (fs.existsSync(authFile)) {
    contextOptions.storageState = authFile;
  }

  const context = await browser.newContext(contextOptions);

  if (fs.existsSync(sessionStorageFile) || fs.existsSync(localStorageFile)) {
    const naverSessionStorage = fs.existsSync(sessionStorageFile)
      ? JSON.parse(fs.readFileSync(sessionStorageFile, 'utf8'))
      : {};

    const naverLocalStorage = fs.existsSync(localStorageFile)
      ? JSON.parse(fs.readFileSync(localStorageFile, 'utf8'))
      : {};

    await context.addInitScript(({ sessionData, localData }) => {
      if (!location.hostname.endsWith('naver.com')) return;

      for (const [key, value] of Object.entries(localData || {})) {
        try {
          localStorage.setItem(key, value);
        } catch (e) {}
      }

      for (const [key, value] of Object.entries(sessionData || {})) {
        try {
          sessionStorage.setItem(key, value);
        } catch (e) {}
      }
    }, {
      sessionData: naverSessionStorage,
      localData: naverLocalStorage
    });

    console.log('네이버 localStorage/sessionStorage 복원됨');
  } else {
    console.log('네이버 localStorage/sessionStorage 없음 - 18세 상세정보는 제한될 수 있습니다');
  }

  const listPage = await context.newPage();
  const detailPage = await context.newPage();

  try {
    console.log(`목록 페이지 접속: ${listUrl}`);
    if (fs.existsSync(authFile)) {
      console.log(`로그인 상태 파일 사용: ${authFile}`);
    } else {
      console.log('로그인 상태 파일이 없어 비로그인 상태로 실행합니다.');
    }

    if (fs.existsSync(sessionStorageFile)) {
      console.log(`성인 sessionStorage 파일 사용: ${sessionStorageFile}`);
    }

    if (fs.existsSync(localStorageFile)) {
      console.log(`성인 localStorage 파일 사용: ${localStorageFile}`);
    }

    await listPage.goto(listUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await listPage.waitForTimeout(2500);

    try {
      const popularBtn = listPage.getByText('인기순', { exact: true }).first();
      await popularBtn.click({ timeout: 3000 });
      await listPage.waitForTimeout(2000);
      console.log('인기순 클릭 완료');
    } catch (e) {
      console.log('인기순 클릭 생략');
    }

    try {
      await listPage.screenshot({
        path: path.join(outputDir, `debug_pc_${dateText}_${dayKey}.png`),
        fullPage: false
      });
    } catch (e) {
      console.log('디버그 캡처 생략');
    }

    const result = await getPcRankedListItems(listPage, dayLabel);

    writeJson(
      path.join(outputDir, `debug_container_${dateText}_${dayKey}.json`),
      result.containerInfo
    );

    writeJson(
      path.join(outputDir, `debug_list_raw_${dateText}_${dayKey}.json`),
      result.items
    );

    const rankedItems = [];
    for (const item of result.items) {
      const title = pickTitleFromListItem(item);
      if (!title || title === '미확인') continue;

      rankedItems.push({
        rank: rankedItems.length + 1,
        titleId: item.titleId,
        title,
        listText: item.listText,
        listLines: item.listLines,
        listUrl: item.href,
        cover_url: ''
      });

      if (rankedItems.length >= 20) break;
    }

    await captureCoverImagesFromRankingPage(listPage, rankedItems);

    const prevRows = readPreviousWeekHistory(historyDir, prevWeek);
    const hasPrevData = Array.isArray(prevRows) && prevRows.length > 0;
    const prevRankMap = buildPrevRankMap(prevRows || []);

    const rows = [];
    const detailDebug = [];

    for (const item of rankedItems) {
      console.log(`상세 조회 중: ${item.rank}위 / ${item.title}`);

      const detailMeta = await fetchDetailMeta(detailPage, item.titleId);
      const fallbackAuthors = parseAuthorsFromList(item);
      const fallbackGenre = parseGenreFromList(item);

      const authorInfo = resolveAuthorInfo(detailMeta, fallbackAuthors);
      const genreRaw = resolveGenreRaw(detailMeta, fallbackGenre);
      const genreNorm = normalizeGenre(genreRaw);
      const adultYn = resolveAdultYn(item.listText, detailMeta);

      const titleKey = normalizeTitleKey(item.title);
      const prevRank = prevRankMap.get(titleKey) || '';
      const rankChange = getRankChange(item.rank, prevRank, hasPrevData);
      let launchDate = extractLaunchDateFromText(detailMeta.topText || '', dateText);

      if (!launchDate) {
        const ascLaunchText = await fetchLaunchTextFromAscEpisodeList(detailPage, item.titleId);
        const ascLaunchDate = extractLaunchDateFromText(ascLaunchText, dateText);

        if (ascLaunchDate) {
          launchDate = ascLaunchDate;
          console.log(` ASC 회차목록 기준 런칭일 보정: ${item.rank}위 / ${item.title} / ${launchDate}`);
        }
      }

      const newInfo = getNewInfo(dateText, launchDate);

      if (launchDate) {
        console.log(` 런칭일 추정: ${item.rank}위 / ${item.title} / ${launchDate} / 신작=${newInfo.new_yn}`);
      } else {
        const detailDateCandidates = collectDateCandidatesFromText(detailMeta.topText || '', dateText).slice(0, 5);
        console.log(` 런칭일 미확인: ${item.rank}위 / ${item.title}`);
        console.log(`  성인여부: ${adultYn}`);
        console.log(`  상세차단: ${detailMeta.blocked ? 'Y' : 'N'}`);
        console.log(`  날짜 후보: ${detailDateCandidates.length ? detailDateCandidates.join(', ') : '없음'}`);
        if (adultYn === 'Y') {
          console.log('  참고: 18세/청유물 작품은 로그인·성인인증 상태에 따라 회차 날짜가 숨겨질 수 있음');
        }
      }

      rows.push({
        collect_date: dateText,
        target_weekday: dayKey,
        rank: item.rank,
        title: item.title,
        writer: authorInfo.writer,
        artist: authorInfo.artist,
        genre_raw: genreRaw,
        genre_norm: genreNorm,
        adult_yn: adultYn,
        launch_date: newInfo.launch_date,
        new_yn: newInfo.new_yn,
        new_days: newInfo.new_days,
        rank_change: rankChange,
        list_url: item.listUrl,
        // 네이버 성인/로그인 리다이렉트가 detail_url에 들어가면 대시보드 클릭 시 로그인/이상 페이지로 이동하므로
        // 실제 작품 목록 URL(list_url)을 상세 이동 URL로 사용합니다.
        detail_url: item.listUrl,
        cover_url: item.cover_url || '',
        source: fs.existsSync(authFile) ? 'naver_pc_login' : 'naver_pc'
      });

      detailDebug.push({
        rank: item.rank,
        title: item.title,
        titleId: item.titleId,
        detailMeta
      });
    }

    writeJson(
      path.join(outputDir, `debug_detail_${dateText}_${dayKey}.json`),
      detailDebug
    );

    const csvHeader = [
      'collect_date',
      'target_weekday',
      'rank',
      'title',
      'writer',
      'artist',
      'genre_raw',
      'genre_norm',
      'adult_yn',
      'launch_date',
      'new_yn',
      'new_days',
      'rank_change',
      'list_url',
      'detail_url',
      'cover_url',
      'source'
    ];

    const csvLines = [csvHeader.join(',')];

    for (const row of rows) {
      csvLines.push([
        csvEscape(row.collect_date),
        csvEscape(row.target_weekday),
        csvEscape(row.rank),
        csvEscape(row.title),
        csvEscape(row.writer),
        csvEscape(row.artist),
        csvEscape(row.genre_raw),
        csvEscape(row.genre_norm),
        csvEscape(row.adult_yn),
        csvEscape(row.launch_date),
        csvEscape(row.new_yn),
        csvEscape(row.new_days),
        csvEscape(row.rank_change),
        csvEscape(row.list_url),
        csvEscape(row.detail_url),
        csvEscape(row.cover_url),
        csvEscape(row.source)
      ].join(','));
    }

    const csvPath = path.join(outputDir, `naver_top10_${dateText}_${dayKey}.csv`);
    writeUtf8Bom(csvPath, csvLines.join('\n'));

    const historyPath = getHistoryFilePath(historyDir, dateText, dayKey);
    writeJson(historyPath, rows);

    const masterCsvPath = path.join(masterDir, 'naver_top10_master.csv');
    const appendedCount = appendRowsToMaster(masterCsvPath, rows);

    const previewLines = rows.map(r =>
      `${r.rank}. ${r.title} / 글 ${r.writer} / 그림 ${r.artist} / ${r.genre_norm} / ${r.adult_yn} / ${r.rank_change}`
    );

    previewLines.push('');
    previewLines.push('--- 기준/가정 요약 ---');
    previewLines.push('- 기준 화면: 네이버웹툰 PC 요일 페이지');
    previewLines.push('- 정렬 기준: 인기순');
    previewLines.push('- 수집 범위: 추천 웹툰 제외, 실시간 인기웹툰 제외, 전체 요일웹툰 메인 리스트만');
    previewLines.push('- 수집 방식: 저장된 로그인 상태 사용 가능, 메인 리스트 DOM 순서 기준, TOP 10');
    previewLines.push('- 성인 기준: 19세 / 청유물 / 청불 / 성인 표기 시 Y');
    previewLines.push('- 작가 기준: 상세페이지의 이름·역할 표기 우선');
    previewLines.push('- 장르 기준: 상세 해시태그 중 장르형 첫 번째 우선 → 상세 장르 → 목록 보조');
    previewLines.push('- 랭킹 변화: 7일 전 동일 요일·동일 기준 데이터와 비교');
    previewLines.push(`- 지난주 비교 기준일: ${prevWeek.dateText} (${prevWeek.dayKey})`);

    const previewPath = path.join(outputDir, `naver_top10_preview_${dateText}_${dayKey}.txt`);
    writeUtf8Bom(previewPath, previewLines.join('\n'));

    console.log('');
    console.log('완료');
    console.log(`CSV 저장: ${csvPath}`);
    console.log(`미리보기 저장: ${previewPath}`);
    console.log(`히스토리 저장: ${historyPath}`);
    console.log(`누적 CSV 저장: ${masterCsvPath}`);
    console.log(`이번 실행 누적 추가 건수: ${appendedCount}`);
    console.log(`총 추출 개수: ${rows.length}`);
  } catch (error) {
    console.error('오류 발생:', error);
  } finally {
    await browser.close();
  }
})();