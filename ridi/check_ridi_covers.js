// 리디 크롤링 결과(CSV)에서 표지 이미지(cover_url)를 눈으로 바로 확인할 수 있는 HTML을 만들어줍니다.
// 사용법: ridi 폴더에서  node check_ridi_covers.js
// output_ridi 폴더에서 가장 최근 날짜의 웹툰/BL웹툰 CSV를 찾아서,
// 같은 폴더에 check_ridi_covers_결과.html 파일을 만듭니다. 이 파일을 더블클릭해서 브라우저로 열면 됩니다.

const fs = require('fs');
const path = require('path');

const outputDir = path.join(__dirname, 'output_ridi');

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

function parseCsvFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8').replace(/^﻿/, '');
  const lines = raw.split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const header = parseCsvLine(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    if (!cols.length) continue;
    const row = {};
    header.forEach((h, idx) => { row[h] = cols[idx] || ''; });
    rows.push(row);
  }
  return rows;
}

function findLatestCsv(prefix) {
  if (!fs.existsSync(outputDir)) return null;
  const files = fs.readdirSync(outputDir)
    .filter(name => name.startsWith(prefix) && name.endsWith('.csv'));
  if (!files.length) return null;
  files.sort(); // 파일명에 날짜(YYYY-MM-DD)가 붙어있어서 문자열 정렬 = 날짜순 정렬
  return path.join(outputDir, files[files.length - 1]);
}

function escapeHtml(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderSection(title, csvPath) {
  if (!csvPath) {
    return `<h2>${escapeHtml(title)}</h2><p>CSV 파일을 찾지 못했습니다. 먼저 크롤링을 실행해주세요.</p>`;
  }
  const rows = parseCsvFile(csvPath);
  const coverKeys = rows.map(r => (r.cover_url || '').slice(0, 200));
  const distinctCovers = new Set(coverKeys.filter(Boolean));
  const warning = rows.length > 1 && distinctCovers.size <= 1
    ? `<p style="color:#c22b78;font-weight:800;">⚠ 표지 이미지가 ${rows.length}개 작품 전부 동일합니다. 아직 문제가 남아있을 수 있습니다.</p>`
    : `<p style="color:#2c6b0f;font-weight:800;">✓ 표지 이미지가 작품마다 서로 다릅니다. (distinct: ${distinctCovers.size} / 전체: ${rows.length})</p>`;

  const cards = rows.map(r => {
    const cover = r.cover_url && r.cover_url.startsWith('data:image')
      ? `<img src="${r.cover_url}" alt="cover">`
      : `<div class="no-cover">표지 없음</div>`;
    return `
      <div class="card">
        ${cover}
        <div class="rank">${escapeHtml(r.rank)}위</div>
        <div class="title">${escapeHtml(r.title)}</div>
        <div class="meta">${escapeHtml(r.adult_yn === 'Y' ? '성인' : '전체')} · ${escapeHtml(r.genre_norm || '-')}</div>
      </div>
    `;
  }).join('');

  return `
    <h2>${escapeHtml(title)} <span class="src">(${escapeHtml(path.basename(csvPath))})</span></h2>
    ${warning}
    <div class="grid">${cards}</div>
  `;
}

const webtoonCsv = findLatestCsv('ridi_webtoon_top20_');
const blCsv = findLatestCsv('ridi_bl_webtoon_top20_');

const html = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<title>리디 표지 확인</title>
<style>
  body { font-family: -apple-system, 'Malgun Gothic', sans-serif; background:#f6f8f1; color:#1f2a1b; padding:24px; }
  h1 { font-size:20px; }
  h2 { margin-top:32px; }
  .src { font-weight:400; font-size:13px; color:#8b9880; }
  .grid { display:grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap:14px; margin-top:14px; }
  .card { background:#fff; border:1px solid #e3e8da; border-radius:10px; padding:8px; text-align:center; }
  .card img { width:100%; height:150px; object-fit:cover; border-radius:6px; background:#eee; }
  .no-cover { width:100%; height:150px; display:flex; align-items:center; justify-content:center; background:#eee; border-radius:6px; color:#999; font-size:12px; }
  .rank { font-weight:800; margin-top:6px; font-size:12px; color:#3f8f17; }
  .title { font-size:12px; margin-top:2px; line-height:1.3; }
  .meta { font-size:11px; color:#8b9880; margin-top:2px; }
</style>
</head>
<body>
  <h1>리디 표지 확인 (로컬 테스트)</h1>
  <p>생성 시각: ${new Date().toLocaleString('ko-KR')}</p>
  ${renderSection('웹툰', webtoonCsv)}
  ${renderSection('BL웹툰', blCsv)}
</body>
</html>`;

const outPath = path.join(outputDir, 'check_ridi_covers_결과.html');
fs.writeFileSync(outPath, html, 'utf8');
console.log('완료: ' + outPath);
console.log('이 파일을 더블클릭해서 브라우저로 열어보세요.');
