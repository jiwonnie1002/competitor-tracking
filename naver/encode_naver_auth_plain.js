// .auth/naver_auth.json 을 "순수 base64"로만 인코딩합니다 (gzip 압축 없음).
// 워크플로의 기존 NAVER_AUTH_JSON 복원 로직과 정확히 짝이 맞는 방식입니다:
//   printf '%s' "$NAVER_AUTH_JSON" | base64 -d > naver/.auth/naver_auth.json
// gzip을 쓰지 않아서 인코딩/디코딩이 어긋날 여지 자체가 없는, 가장 단순하고 안전한 방식입니다.
const fs = require('fs');
const path = require('path');

const baseDir = __dirname;
const authFile = path.join(baseDir, '.auth', 'naver_auth.json');
const outFile = path.join(baseDir, 'naver_auth_secret.txt');

if (!fs.existsSync(authFile)) {
  console.error(`파일을 찾을 수 없습니다: ${authFile}`);
  console.error('먼저 save_naver_auth.js를 실행해서 세션을 저장해주세요.');
  process.exitCode = 1;
} else {
  const json = fs.readFileSync(authFile);
  const b64 = json.toString('base64');
  fs.writeFileSync(outFile, b64, 'utf8');
  console.log(`완료: ${outFile}`);
  console.log('이 파일 안의 텍스트 전체를 복사해서,');
  console.log('GitHub 저장소 > Settings > Secrets and variables > Actions 에서');
  console.log('NAVER_AUTH_JSON 시크릿 값을 이 값으로 업데이트하세요.');
  console.log('(NAVER_AUTH_GZIP_B64 / NAVER_SESSION_STORAGE_GZIP_B64 / NAVER_LOCAL_STORAGE_GZIP_B64는');
  console.log(' 이미 삭제하셨으니 그대로 두시면 됩니다. 만들지 마세요.)');
  console.log('(주의: naver_auth_secret.txt에는 로그인 세션이 그대로 들어있으니,');
  console.log(' 업데이트 후 삭제하고 절대 GitHub에 커밋하지 마세요.)');
}