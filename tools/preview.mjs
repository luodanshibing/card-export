/* Card Export —— 生成 8 套主题的预览页（给无头浏览器截图做视觉自检）
 * 用法：node tools/preview.mjs [输出路径]
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

/* ---- obsidian 桩（只为把 main.js 加载起来） ---- */
class Plugin {}
class PluginSettingTab {}
class Modal {}
class SuggestModal {}
class Setting {}
class Notice {}
class TFile {}
class TFolder {}
const Module = require('module');
const originalLoad = Module._load;
Module._load = function (request) {
  if (request === 'obsidian') {
    return {
      Plugin, PluginSettingTab, Setting, SuggestModal, Modal, Notice,
      TFile, TFolder, MarkdownRenderer: {}, normalizePath: (p) => String(p),
    };
  }
  return originalLoad.apply(this, arguments);
};

const { __test } = require('../main.js');
const { THEMES, themeCss, buildCardShellHtml } = __test;

/* ---- 一段有代表性的"渲染后"内容 ---- */
const SAMPLE_BODY = `
<h2>一、为什么要做卡片</h2>
<p>笔记躺在库里没人看，<strong>发出去的图才有人看</strong>。把一段话说清楚，比排一屏版更难。</p>
<blockquote><p>样式不是装饰，是帮读者分清主次的手段。</p></blockquote>
<h2>二、三条经验</h2>
<ul>
  <li>一屏只讲一件事，标题要能<strong>独立成立</strong>；</li>
  <li>重点只用一种颜色，别让读者猜哪里重要；</li>
  <li>页脚放署名，这是<code>版权</code>最低成本的声明。</li>
</ul>
<pre><code>node tools/test.mjs   # 52 项断言</code></pre>
<h2>三、对照表</h2>
<table>
  <thead><tr><th>场景</th><th>推荐尺寸</th></tr></thead>
  <tbody>
    <tr><td>小红书图文</td><td>440 × 586</td></tr>
    <tr><td>公众号配图</td><td>正方形 500 × 500</td></tr>
  </tbody>
</table>
<hr>
<p>最后一句：<em>先能看，再好看。</em> <a href="#">参考资料</a></p>
`;

const cards = THEMES.map((t) => {
  const shell = buildCardShellHtml({
    themeId: t.id,
    sizeId: 'long',
    width: 440,
    height: 0,
    title: '把笔记变成一张卡片',
    meta: '2026-10-02 · 486 字',
    footerLeft: 'luodanshibing',
    footerRight: '2026-10-02',
    watermark: '@luodanshibing',
  });
  return `
  <section class="cell">
    <div class="cellname">${t.name} <code>${t.id}</code></div>
    <div class="cardwrap" data-theme-name="${t.id}">
      ${shell.replace('<div class="ce-body"></div>', `<div class="ce-body">${SAMPLE_BODY}</div>`)}
    </div>
  </section>`;
}).join('\n');

const allCss = THEMES.map((t) => themeCss(t.id, '')).join('\n');

const html = `<!DOCTYPE html>
<html lang="zh-CN"><head>
<meta charset="utf-8">
<title>Card Export · 8 套主题预览</title>
<style>
  body { margin: 0; padding: 20px; background: #6b7280; font-family: "Microsoft YaHei", sans-serif; }
  h1 { color: #fff; font-size: 18px; margin: 0 0 16px; font-weight: 600; }
  .grid { display: grid; grid-template-columns: 480px 480px 480px; gap: 20px; align-items: start; }
  .cellname { color: #f3f4f6; font-size: 13px; margin-bottom: 6px; }
  .cellname code { opacity: .6; }
  .cardwrap { width: 440px; box-shadow: 0 8px 24px rgba(0,0,0,.28); }
  .ce-card .ce-watermark { display: block; }
${allCss}
</style>
</head>
<body>
<h1>Card Export · 15 套主题 · 440px 自适应长图</h1>
<div class="grid">${cards}
</div>
</body></html>`;

const out = process.argv[2] || path.join(__dirname, 'preview.html');
fs.writeFileSync(out, html, 'utf8');
console.log(`预览页已生成：${out}`);
console.log(`尺寸估算：${THEMES.length} 张卡片，2 列排布`);
