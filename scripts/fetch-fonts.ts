import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

/*
 * 抓取并自托管网页字体。
 *
 * 为什么不用 npm 的 fontsource：Google 的中文字体是按 unicode-range 切成上百片的，
 * fontsource 也是同样的分片方式，但会把三个家族的 400/500/600 全拉下来；
 * 而这里只需要页面实际用到的三个家族与字重，直接照 Google 的分片表取更小。
 *
 * 关键点：保留 unicode-range 原样，浏览器仍按需加载 —— 一个页面通常只命中
 * 二十来片（实测 24 片 / 1.1MB），不是把 7MB 全下。
 *
 * 用法：npm run fonts:fetch
 * 产物：public/vendor/fonts/*.woff2 + fonts.css（文件名取 URL 的 md5 前 16 位）
 */

const FAMILIES = [
  'IBM+Plex+Mono:wght@400;500',
  'Noto+Sans+SC:wght@400;500;600',
  'ZCOOL+XiaoWei'
].join('&family=');

const CSS_URL = `https://fonts.googleapis.com/css2?family=${FAMILIES}&display=swap`;
const OUTPUT_DIR = path.resolve('public/vendor/fonts');
// Google 只在现代 UA 下返回 woff2；用旧 UA 会拿到 ttf，体积大三四倍
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const fetchBin = async (url: string, headers: Record<string, string> = {}) => {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return Buffer.from(await res.arrayBuffer());
};

const main = async () => {
  console.log('拉取字体样式表…');
  const css = (await fetchBin(CSS_URL, { 'User-Agent': USER_AGENT })).toString('utf8');

  const urls = [...new Set(
    [...css.matchAll(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g)].map(match => match[1])
  )];
  if (!urls.length) throw new Error('样式表里没有字体地址，Google 可能改了格式');
  console.log(`发现 ${urls.length} 个分片，开始下载…`);

  await fs.rm(OUTPUT_DIR, { recursive: true, force: true });
  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  let rewritten = css;
  let total = 0;
  let done = 0;

  // 并发 12：再多对 fonts.gstatic.com 不礼貌，也没有更快
  const queue = [...urls];
  const workers = Array.from({ length: 12 }, async () => {
    for (;;) {
      const url = queue.shift();
      if (!url) return;
      const name = `${crypto.createHash('md5').update(url).digest('hex').slice(0, 16)}.woff2`;
      const body = await fetchBin(url);
      await fs.writeFile(path.join(OUTPUT_DIR, name), body);
      rewritten = rewritten.split(`url(${url})`).join(`url(./${name})`);
      total += body.length;
      done += 1;
      if (done % 40 === 0) console.log(`  ${done}/${urls.length}`);
    }
  });
  await Promise.all(workers);

  if (rewritten.includes('gstatic.com') || rewritten.includes('googleapis.com')) {
    throw new Error('仍有外链未替换，检查样式的书写格式');
  }

  const header = `/* =========================================================
   本地字体：由 scripts/fetch-fonts.ts 从 Google Fonts 抓取后自托管
   —— Noto Sans SC（正文）/ ZCOOL XiaoWei（标题）/ IBM Plex Mono（数字与微字）
   —— 保留原 unicode-range 分片，浏览器仍按需加载
   —— 不要手工编辑；更新请重跑 npm run fonts:fetch
   ========================================================= */
`;
  await fs.writeFile(path.join(OUTPUT_DIR, 'fonts.css'), header + rewritten);

  console.log(`完成：${done} 个分片，共 ${(total / 1048576).toFixed(2)} MB`);
  console.log(`输出：${path.relative(process.cwd(), OUTPUT_DIR)}`);
};

await main();
