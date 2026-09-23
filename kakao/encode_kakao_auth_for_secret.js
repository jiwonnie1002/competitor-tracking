// .auth/kakao_auth.json 파일을 gzip 압축 + base64 인코딩해서
// GitHub Actions Secret에 붙여넣을 수 있는 텍스트로 만들어주는 도구입니다.
//
// 실제 GitHub 저장소(origin/main)의 collect.yml은 카카오 세션을 아래 방식으로 복원합니다:
//   printf '%s' "$KAKAO_AUTH_GZIP_B64" | base64 -d | gzip -d > kakao/.auth/kakao_auth.json
// 즉 반드시 "gzip 압축 후 base64 인코딩"된 값이어야 하며, 순수 base64(KAKAO_AUTH_JSON)를
// 넣으면 "gzip: stdin: not in gzip format" 오류로 실패합니다. (리디/레진/봄툰과 동일한 방식)
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

const baseDir = __dirname;
const authFile = path.join(baseDir, '.auth', 'kakao_auth.json');
const outFile = path.join(baseDir, 'kakao_auth_secret.txt');

if (!fs.existsSync(authFile)) {
  console.error(`파일을 찾을 수 없습니다: ${authFile}`);
  console.error('먼저 save_kakao_auth.js를 실행해서 세션을 저장해주세요.');
  process.exitCode = 1;
} else {
  const json = fs.readFileSync(authFile);
  const gz = zlib.gzipSync(json);
  const b64 = gz.toString('base64');
  fs.writeFileSync(outFile, b64, 'utf8');
  console.log(`완료: ${outFile}`);
  console.log('이 파일을 열어서 안의 텍스트 전체를 복사한 뒤,');
  console.log('GitHub 저장소 > Settings > Secrets and variables > Actions 에서');
  console.log('KAKAO_AUTH_GZIP_B64 시크릿 값에 붙여넣어 업데이트하세요.');
  console.log('(KAKAO_AUTH_JSON이라는 시크릿이 남아있다면 더 이상 쓰이지 않으니 삭제해도 됩니다.)');
  console.log('(주의: kakao_auth_secret.txt 안에는 로그인 세션 정보가 들어있으니,');
  console.log(' 업데이트 후에는 이 파일을 지우거나 절대 깃허브에 커밋하지 마세요.)');
}
