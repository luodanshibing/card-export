/* Card Export —— 纯逻辑单元测试
 * 用法：node tools/test.mjs
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

/* ---- obsidian 桩 ---- */
class Plugin {}
class PluginSettingTab {}
class Modal {}
class SuggestModal {}
class Setting {}
class Notice {}
class TFile {}
class TFolder {}
const MarkdownRenderer = {};
const normalizePath = (p) => String(p).replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');

const Module = require('module');
const originalLoad = Module._load;
Module._load = function (request) {
  if (request === 'obsidian') {
    return {
      Plugin, PluginSettingTab, Setting, SuggestModal, Modal, Notice,
      TFile, TFolder, MarkdownRenderer, normalizePath,
    };
  }
  return originalLoad.apply(this, arguments);
};

const { __test } = require('../main.js');
const {
  SIZES, THEMES, GRADIENTS, TEXTURES, BG_TYPES, BASE_CSS, DEFAULT_SETTINGS,
  getTheme, getSize, getGradient, getTexture, themeCss, buildCardShellHtml, paginate, splitByHeadings,
  buildFileName, plainText, escapeHtml, normDir, hexToRgba, backgroundStyle, backgroundImageStyle,
  buildMetaParts,
} = __test;

/* ---- 迷你断言 ---- */
let pass = 0;
const fails = [];
const eq = (a, b, label) => {
  const x = JSON.stringify(a);
  const y = JSON.stringify(b);
  if (x === y) pass++;
  else fails.push(`${label}\n    期望 ${y}\n    实际 ${x}`);
};
const ok = (cond, label) => {
  if (cond) pass++;
  else fails.push(`${label}（断言为假）`);
};

/* ============ 1. 主题与尺寸清单 ============ */
eq(THEMES.length, 15, '共 15 套主题（v1.1 从 8 套扩到 15 套）');
eq(new Set(THEMES.map((t) => t.id)).size, 15, '主题 id 不重复');
ok(THEMES.every((t) => t.name && t.css && t.css.includes('.ce-card')), '每套主题都有名称与作用在 .ce-card 上的 CSS');
const NEW_THEMES = ['gray', 'warm', 'dawn', 'watercolor', 'japan', 'china', 'notebook'];
ok(NEW_THEMES.every((id) => THEMES.some((t) => t.id === id)), 'v1.1 新增 7 套都在：简约高级灰/温暖柔和/清野晨光/水彩艺术/日本杂志/中国传统/笔记本');
ok(['mono', 'gray', 'memo', 'warm', 'fresh', 'dawn', 'dream', 'watercolor', 'xhs', 'dark', 'biz', 'japan', 'china', 'typewriter', 'notebook']
  .every((id) => THEMES.some((t) => t.id === id)), '主题清单与设计一致');

eq(SIZES.length, 5, '共 5 种尺寸');
eq(getSize('long').height, 0, '自适应长图没有固定高度');
eq(getSize('xhs').width, 440, '小红书宽 440');
eq(getSize('xhs').height, 586, '小红书高 586');
eq(getSize('a4').height, 842, 'A4 高 842');
eq(getSize('不存在').id, 'long', '未知尺寸回退到自适应长图');
eq(getTheme('不存在').id, 'mono', '未知主题回退到极简黑白');

/* ============ 2. 样式合成 ============ */
const css = themeCss('dark', '.ce-card{outline:1px solid red}');
ok(css.includes('.ce-inner'), '合成样式包含基础排版');
ok(css.includes('data-theme="dark"'), '合成样式包含所选主题');
ok(css.includes('outline:1px solid red'), '自定义 CSS 追加在最后');
ok(css.indexOf('.ce-inner') < css.indexOf('data-theme="dark"'), '基础样式在主题之前');

/* ============ 3. 卡片外壳 ============ */
const shell = buildCardShellHtml({
  themeId: 'xhs', sizeId: 'xhs', title: '标题 <b>', meta: '120 字',
  footerLeft: '作者', footerRight: '2026-10-02', watermark: '@me',
});
ok(shell.includes('data-theme="xhs"'), '外壳带主题标记');
ok(shell.includes('width:440px;height:586px'), '固定尺寸写进 style');
ok(!shell.includes('<b>'), '标题里的 HTML 被转义（防注入）');
ok(shell.includes('&lt;b&gt;'), '转义后保留字面内容');
ok(shell.includes('class="ce-body"'), '外壳预留正文容器');
ok(shell.includes('ce-watermark'), '水印节点存在');
const shellLong = buildCardShellHtml({ themeId: 'mono', sizeId: 'long', title: 't' });
ok(shellLong.includes('min-height'), '长图模式用 min-height 而不是固定高');
ok(!shellLong.includes('ce-footer'), '没有页脚内容时不渲染页脚');
ok(buildCardShellHtml({ themeId: 'mono', sizeId: 'long', title: 't', watermark: 'x', watermarkBand: true }).includes('ce-watermark-band'),
  '水印带模式的类名正确');

/* ============ 4. 分页 ============ */
const B = (h) => ({ height: h });
eq(paginate([B(100), B(200)], { contentHeight: 0 }).length, 1, '长图模式只有一页');
eq(paginate([B(100), B(200)], { contentHeight: 0 })[0].height, 300, '长图高度为各块之和');
eq(paginate([B(100), B(200), B(100)], { contentHeight: 320 }).length, 2, '320 高装得下 100+200，装不下再来 100 → 两页');
eq(paginate([B(100), B(200), B(100)], { contentHeight: 320 })[0].indices, [0, 1], '第一页装前两块');
eq(paginate([B(100), B(200), B(100)], { contentHeight: 320 })[1].indices, [2], '第二页装第三块');
eq(paginate([B(100), B(200), B(100)], { contentHeight: 250 }).length, 3, '250 高连 100+200 都装不下 → 三页');
eq(paginate([B(600)], { contentHeight: 250 })[0].indices, [0], '单块超高时独占一页');
eq(paginate([B(600)], { contentHeight: 250 })[0].height, 600, '单块超高时该页高度等于块高（宁可变高也不裁切）');
eq(paginate([B(10), B(10), B(10)], { contentHeight: 30 }).length, 1, '刚好装满算一页');
eq(paginate([B(10), B(10), B(10)], { contentHeight: 29 }).length, 2, '29 高装两块，剩一块分到第二页');
eq(paginate([], { contentHeight: 100 }).length, 1, '空内容也返回一页（渲染空卡片）');
eq(paginate([B(100), B(100)], { contentHeight: 250, gap: 10 })[0].height, 210, 'gap 计入页高');

/* ============ 5. 按标题切分 ============ */
const md = `开头一段\n\n## 第一节\n内容一\n\n## 第二节\n内容二\n### 三级别标题不该切\n还有内容`;
const parts = splitByHeadings(md, 2);
eq(parts.length, 3, '切出「开头 + 两节」共 3 段');
eq(parts[0].title, null, '开头段没有标题');
ok(parts[0].markdown.includes('开头一段'), '开头段内容保留');
eq(parts[1].title, '第一节', '第二段标题正确');
ok(parts[2].markdown.includes('### 三级别标题不该切'), '三级标题不参与切分，留在本节内');
eq(splitByHeadings('没有标题的正文', 2).length, 1, '没有二级标题时只有一段');
eq(splitByHeadings('', 2).length, 0, '空内容切出 0 段');
eq(splitByHeadings('## A\n\n## B\n', 2).length, 2, '连续两个空节也各算一段');

/* ============ 6. 文件名 ============ */
const d = new Date(2026, 9, 2, 15, 31);
eq(buildFileName('我的笔记', d, 0, 1), '我的笔记-20261002-1531.png', '单张文件名');
eq(buildFileName('我的笔记', d, 0, 3), '我的笔记-20261002-1531-1.png', '多张时带序号（从 1 开始）');
eq(buildFileName('我的笔记', d, 2, 3), '我的笔记-20261002-1531-3.png', '第三张序号为 3');
eq(buildFileName('a/b:c*?', d, 0, 1), 'a_b_c__-20261002-1531.png', '文件名非法字符被替换');
eq(buildFileName('', d, 0, 1), '卡片-20261002-1531.png', '空标题回退为「卡片」');

/* ============ 7. 文本处理 ============ */
eq(escapeHtml('<a href="x">&</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;', 'HTML 转义');
eq(plainText('# 标题\n\n**加粗**与`代码`以及[链接](http://x)'), '标题 加粗 与 以及链接', '去掉 markdown 语法（标记符号变空格）');
eq(plainText('![图](a.png) 后面'), '后面', '图片链接被去掉');
eq(plainText('```js\nconst a=1;\n```\n正文'), '正文', '代码块被去掉');
eq(normDir('a/b/c.md'), 'a/b', '取得所在目录');
eq(normDir('c.md'), '', '根目录返回空串');
eq(normDir('a\\b\\c.md'), 'a/b', '反斜杠也被处理');

/* ============ 8.5 背景自定义（v1.1） ============ */
eq(hexToRgba('#FFFFFF', 0.5), 'rgba(255,255,255,0.5)', 'hex → rgba');
eq(hexToRgba('#000', 1), 'rgba(0,0,0,1)', '三位 hex 也支持');
eq(hexToRgba('乱写的内容', 0.5), 'rgba(255,255,255,0.5)', '非法输入回退成白色');
eq(backgroundStyle({ type: 'theme' }), '', '跟随主题时不覆盖背景');
eq(backgroundStyle({ type: 'solid', color: '#123456' }), 'background:#123456;', '纯色背景');
ok(backgroundStyle({ type: 'gradient', gradient: 'ink' }).includes('linear-gradient'), '渐变背景');
ok(backgroundStyle({ type: 'texture', texture: 'dots', color: '#FFF' }).includes('radial-gradient'), '圆点纹理');
ok(backgroundStyle({ type: 'texture', texture: 'grid', color: '#FFF' }).includes('background-image'), '网格纹理写入 background-image');
ok(backgroundStyle({ type: 'texture', texture: 'noise', color: '#FFF' }).includes('data:image/svg+xml'), '噪点纹理是内联 SVG');

const imgCss = backgroundImageStyle('data:image/png;base64,AAA', { type: 'image', veil: 50, veilColor: '#000000' });
ok(imgCss.includes('linear-gradient(rgba(0,0,0,0.5)'), '背景图带遮罩层');
ok(imgCss.includes('url("data:image/png;base64,AAA")'), '背景图用 dataURL（导出不依赖外部文件）');
ok(imgCss.includes('background-size:cover'), '默认铺满裁切');
ok(backgroundImageStyle('data:x', { imageFit: 'contain' }).includes('background-size:contain'), '完整显示');
ok(backgroundImageStyle('data:x', { imageFit: 'repeat' }).includes('background-repeat:repeat'), '平铺');
eq(backgroundImageStyle('data:x', { veil: 0 }).includes('linear-gradient'), false, '遮罩为 0 时不叠加层');

eq(getGradient('不存在').id, 'dawn', '未知渐变回退到晨光');
eq(getTexture('不存在').id, 'dots', '未知纹理回退到圆点');
eq(GRADIENTS.length, 7, '渐变预设 7 种');
eq(TEXTURES.length, 5, '纹理预设 5 种');
eq(BG_TYPES.length, 5, '背景类型 5 种（跟随主题/纯色/渐变/纹理/图片）');

/* ============ 8.6 元素：头像 / 日期 / 字数 / 来源（v1.1） ============ */
const shellAvatar = buildCardShellHtml({
  themeId: 'mono', sizeId: 'long', title: 't',
  avatar: '1 Obsidian/附件/头像.png', footerLeft: '作者',
});
ok(shellAvatar.includes('class="ce-avatar"'), '头像渲染成 img.ce-avatar');
ok(shellAvatar.includes('src="1 Obsidian/附件/头像.png"'), '头像路径写进 src');
ok(!buildCardShellHtml({ themeId: 'mono', sizeId: 'long', title: 't' }).includes('ce-footer'), '没有头像/页脚内容时不渲染页脚');
ok(buildCardShellHtml({ themeId: 'mono', sizeId: 'long', title: 't', bgStyle: 'background:#FF0000;' }).includes('background:#FF0000;'),
  '背景样式被写进卡片的 style');

eq(buildMetaParts({ showDate: true, date: '2026-10-02', showWords: true, words: 486, source: '公众号' }),
  ['2026-10-02', '486 字', '公众号'], '元信息按开关拼装');
eq(buildMetaParts({ showDate: false, showWords: false, words: 100 }), [], '两个开关都关掉时元信息为空');
eq(buildMetaParts({ mode: 'selection', showWords: true, words: 20 }), ['选中内容', '20 字'], '选中模式会标注');
eq(buildMetaParts({ mode: 'headings', showDate: true, date: 'D' }), ['按标题切分', 'D'], '按标题模式会标注');

/* ============ 8.7 v1.1 新增设置项 ============ */
eq(DEFAULT_SETTINGS.bgType, 'theme', '默认背景跟随主题');
eq(DEFAULT_SETTINGS.saveToFile, false, '默认不另存文件');
eq(DEFAULT_SETTINGS.lastExportDir, '', '默认没有"上次另存目录"');
eq(DEFAULT_SETTINGS.showMetaDate, true, '默认显示日期');
eq(DEFAULT_SETTINGS.showMetaWords, true, '默认显示字数');
eq(DEFAULT_SETTINGS.avatar, '', '默认没有头像');

/* ============ 8. 设置默认值 ============ */
eq(DEFAULT_SETTINGS.scale, 2, '默认 2 倍输出');
eq(DEFAULT_SETTINGS.defaultTheme, 'mono', '默认主题为极简黑白');
eq(DEFAULT_SETTINGS.defaultSize, 'long', '默认尺寸为自适应长图');
eq(DEFAULT_SETTINGS.saveToVault, true, '默认保存到库');
eq(DEFAULT_SETTINGS.outputFolder, '', '默认导出目录为空（与笔记同目录）');
ok(BASE_CSS.includes('.ce-body pre'), '基础样式包含代码块');

/* ---- 结果 ---- */
console.log(`\n通过 ${pass} 项，失败 ${fails.length} 项`);
if (fails.length) {
  console.log('\n失败明细：');
  fails.forEach((f, i) => console.log(`  ${i + 1}) ${f}`));
  process.exit(1);
}
console.log('全部通过 ✓');
