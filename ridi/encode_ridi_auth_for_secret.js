// .auth/ridi_auth.json 파일을 gzip 압축 + base64 인코딩해서
// GitHub Actions Secret에 붙여넣을 수 있는 텍스트로 만들어주는 도구입니다.
// (세션 파일을 그대로 GitHub에 올리면 안 되기 때문에 압축+인코딩해서
//  Secret이라는 암호화된 저장소에 넣는 방식을 씁니다.)
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

const baseDir = __dirname;
const authFile = path.join(baseDir, '.auth', 'ridi_auth.json');
const outFile = path.join(baseDir, 'ridi_auth_secret.txt');

if (!fs.existsSync(authFile)) {
  console.error(`파일을 찾을 수 없습니다: ${authFile}`);
  console.error('먼저 save_ridi_auth.js를 실행해서 세션을 저장해주세요.');
  process.exitCode = 1;
} else {
  const json = fs.readFileSync(authFile);
  const gz = zlib.gzipSync(json);
  const b64 = gz.toString('base64');
  fs.writeFileSync(outFile, b64, 'utf8');
  console.log(`완료: ${outFile}`);
  console.log('이 파일을 열어서 안의 텍스트 전체를 복사한 뒤,');
  console.log('GitHub 저장소 > Settings > Secrets and variables > Actions 에서');
  console.log('RIDI_AUTH_GZIP_B64 시크릿 값에 붙여넣어 업데이트하세요.');
  console.log('(주의: ridi_auth_secret.txt 안에는 로그인 세션 정보가 들어있으니,');
  console.log(' 업데이트 후에는 이 파일을 지우거나 절대 깃허브에 커밋하지 마세요.)');
}
