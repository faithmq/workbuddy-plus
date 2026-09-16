// 构建前把仓库根目录的 hooks/ 同步到 app/hooks/，供 electron-builder 打包进 app。
// app/hooks/ 是构建产物，已在 .gitignore 中忽略；源永远以仓库根目录的 hooks/ 为准。
'use strict';

const fs = require('fs');
const path = require('path');

const SRC = path.resolve(__dirname, '..', '..', 'hooks');
const DST = path.resolve(__dirname, '..', 'hooks');
const FILES = [
  'automation-seconds-inject.js',
  'inject-renderer.js',
  'restart-with-inject.sh'
];

fs.rmSync(DST, { recursive: true, force: true });
fs.mkdirSync(DST, { recursive: true });

for (const f of FILES) {
  const s = path.join(SRC, f);
  if (!fs.existsSync(s)) {
    console.error('缺少源文件：' + s);
    process.exit(1);
  }
  const d = path.join(DST, f);
  fs.copyFileSync(s, d);
  // .sh 需要可执行位；asar 不保留权限，运行时部署时还会再 chmod 一次
  fs.chmodSync(d, f.endsWith('.sh') ? 0o755 : 0o644);
  console.log('  已同步 ' + f);
}
console.log('hooks 已同步到 app/hooks/');
