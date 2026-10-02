'use strict';

/* ==========================================================================
 * Card Export（卡片导出）v1.1.0
 * --------------------------------------------------------------------------
 * 把笔记正文渲染成"漂亮卡片"并导出为 PNG。零依赖、只读笔记、从不改动内容。
 *
 *   · 15 套主题   极简黑白 / 简约高级灰 / 苹果备忘录 / 温暖柔和 / 清新自然 / 清野晨光 /
 *                 梦幻渐变 / 水彩艺术 / 紫色小红书 / 暗黑科技 / 商务简报 / 日本杂志 /
 *                 中国传统 / 复古打字机 / 笔记本
 *   · 5 种尺寸   自适应长图 + 小红书 440×586 / 正方形 500×500 / 手机海报 440×782 / A4 595×842
 *   · 3 种范围   整篇 / 选中内容 / 按标题切成多张
 *   · 背景自定义 纯色 / 渐变 / 纹理 / 图片（+ 遮罩）
 *   · 元素      头像、作者、日期、字数、来源、自定义行、水印
 *   · 输出      存进库 / 另存到任意路径（原生保存对话框）/ 复制到剪贴板
 *
 * 技术路线：克隆卡片 DOM → getComputedStyle 全量内联 → SVG <foreignObject> → canvas → PNG。
 * 不引入任何第三方库（参考插件 export-image 用的是 dom-to-image-more，同一条路子）。
 * ========================================================================== */

const {
  Plugin,
  PluginSettingTab,
  Setting,
  Modal,
  Notice,
  TFile,
  TFolder,
  MarkdownRenderer,
  normalizePath,
} = require('obsidian');

/* ============================== 尺寸预设 ============================== */

const SIZES = [
  { id: 'long', name: '自适应长图', width: 620, height: 0 },
  { id: 'xhs', name: '小红书 440×586', width: 440, height: 586 },
  { id: 'square', name: '正方形 500×500', width: 500, height: 500 },
  { id: 'poster', name: '手机海报 440×782', width: 440, height: 782 },
  { id: 'a4', name: 'A4 打印 595×842', width: 595, height: 842 },
];

/* ============================== 背景预设 ============================== */

const NOISE_DATA_URI =
  'url("data:image/svg+xml;charset=utf-8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="140" height="140">' +
      '<filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2"/></filter>' +
      '<rect width="140" height="140" filter="url(%23n)" opacity="0.07"/></svg>'
  ) +
  '")';

const GRADIENTS = [
  { id: 'dawn', name: '晨光', css: 'linear-gradient(165deg, #E9F3FF 0%, #F6FBEF 55%, #FFF8E7 100%)' },
  { id: 'dream', name: '梦幻', css: 'linear-gradient(140deg, #7F7FD5 0%, #86A8E7 48%, #91EAE4 100%)' },
  { id: 'peach', name: '蜜桃', css: 'linear-gradient(140deg, #FFE3E3 0%, #FFF3E0 100%)' },
  { id: 'mint', name: '薄荷', css: 'linear-gradient(140deg, #DCF7EA 0%, #EAF4FF 100%)' },
  { id: 'sunset', name: '日落', css: 'linear-gradient(145deg, #FFD3A5 0%, #FD6585 100%)' },
  { id: 'ink', name: '墨色', css: 'linear-gradient(150deg, #232B36 0%, #0F141B 100%)' },
  { id: 'paper', name: '宣纸', css: 'linear-gradient(160deg, #FBF6EC 0%, #F2E9D8 100%)' },
];

const TEXTURES = [
  { id: 'dots', name: '圆点', css: 'radial-gradient(rgba(0,0,0,.10) 1.1px, transparent 1.1px) 0 0 / 16px 16px' },
  {
    id: 'grid',
    name: '网格',
    css:
      'linear-gradient(rgba(0,0,0,.055) 1px, transparent 1px) 0 0 / 22px 22px, ' +
      'linear-gradient(90deg, rgba(0,0,0,.055) 1px, transparent 1px) 0 0 / 22px 22px',
  },
  { id: 'diag', name: '斜纹', css: 'repeating-linear-gradient(45deg, rgba(0,0,0,.035) 0 2px, transparent 2px 7px)' },
  { id: 'ruled', name: '横线纸', css: 'repeating-linear-gradient(180deg, transparent 0 31px, rgba(70,130,180,.20) 31px 32px)' },
  { id: 'noise', name: '噪点', css: NOISE_DATA_URI },
];

const BG_TYPES = [
  { id: 'theme', name: '跟随主题' },
  { id: 'solid', name: '纯色' },
  { id: 'gradient', name: '渐变' },
  { id: 'texture', name: '纹理' },
  { id: 'image', name: '图片' },
];

function getGradient(id) {
  return GRADIENTS.find((g) => g.id === id) || GRADIENTS[0];
}

function getTexture(id) {
  return TEXTURES.find((t) => t.id === id) || TEXTURES[0];
}

function hexToRgba(hex, alpha) {
  let h = String(hex || '#FFFFFF').replace('#', '').trim();
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (h.length !== 6 || /[^0-9a-fA-F]/.test(h)) return `rgba(255,255,255,${alpha})`;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/**
 * 背景 → 卡片内联样式片段。
 * 图片类需要先取到 dataURL，单独由 prepareBackgroundImage() 补齐。
 */
function backgroundStyle(bg) {
  const b = bg || {};
  const veilA = Math.max(0, Math.min(100, Number(b.veil) || 0)) / 100;
  const veilColor = b.veilColor || '#FFFFFF';
  switch (b.type) {
    case 'solid':
      return `background:${b.color || '#FFFFFF'};`;
    case 'gradient':
      return `background:${getGradient(b.gradient).css};`;
    case 'texture': {
      const t = getTexture(b.texture);
      return `background-color:${b.color || '#FFFFFF'};background-image:${t.css};`;
    }
    case 'image':
      // 真正的 url 在 prepareBackgroundImage 里补；这里先铺底色 + 遮罩
      return `background-color:${b.color || '#FFFFFF'};`;
    default:
      return '';
  }
}

function backgroundImageStyle(dataUrl, bg) {
  const b = bg || {};
  const veilA = Math.max(0, Math.min(100, Number(b.veil) || 0)) / 100;
  const layers = [];
  if (veilA > 0) layers.push(`linear-gradient(${hexToRgba(b.veilColor || '#FFFFFF', veilA)}, ${hexToRgba(b.veilColor || '#FFFFFF', veilA)})`);
  layers.push(`url("${dataUrl}")`);
  const fit = b.imageFit === 'contain' ? 'contain' : b.imageFit === 'repeat' ? 'auto' : 'cover';
  const repeat = b.imageFit === 'repeat' ? 'repeat' : 'no-repeat';
  return `background-image:${layers.join(',')};background-size:${fit === 'auto' ? 'auto' : fit};background-position:center;background-repeat:${repeat};`;
}

/* ============================== 基础样式 ============================== */

const BASE_CSS = `
.ce-card {
  position: relative;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  font-family: "PingFang SC", "Microsoft YaHei", -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
  -webkit-font-smoothing: antialiased;
}
.ce-card *, .ce-card *::before, .ce-card *::after { box-sizing: border-box; }
.ce-inner {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
  padding: 34px 30px;
}
.ce-head { flex: 0 0 auto; }
.ce-title { font-size: 26px; font-weight: 700; line-height: 1.35; margin: 0 0 8px; }
.ce-meta { font-size: 12px; opacity: .62; margin-bottom: 18px; letter-spacing: .02em; }
.ce-body { flex: 1 1 auto; font-size: 16px; line-height: 1.85; }
.ce-body > *:first-child { margin-top: 0; }
.ce-body > *:last-child { margin-bottom: 0; }
.ce-body h1 { font-size: 23px; line-height: 1.4; margin: 24px 0 10px; }
.ce-body h2 { font-size: 20px; line-height: 1.45; margin: 22px 0 9px; }
.ce-body h3 { font-size: 17px; line-height: 1.5; margin: 18px 0 7px; }
.ce-body p { margin: 0 0 13px; }
.ce-body ul, .ce-body ol { margin: 0 0 13px; padding-left: 1.35em; }
.ce-body li { margin: 5px 0; }
.ce-body blockquote { margin: 15px 0; padding: 4px 0 4px 14px; border-left: 3px solid currentColor; opacity: .88; }
.ce-body blockquote p { margin: 0 0 8px; }
.ce-body code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Courier New", monospace;
  font-size: .9em; padding: 2px 5px; border-radius: 4px; background: rgba(127,127,127,.16);
}
.ce-body pre { margin: 15px 0; padding: 14px 16px; border-radius: 10px; background: rgba(127,127,127,.12); }
.ce-body pre code { background: none; padding: 0; font-size: 13px; line-height: 1.7; white-space: pre-wrap; word-break: break-word; }
.ce-body img { max-width: 100%; border-radius: 8px; display: block; margin: 12px 0; }
.ce-body hr { border: none; border-top: 1px solid currentColor; opacity: .18; margin: 22px 0; }
.ce-body table { width: 100%; border-collapse: collapse; font-size: 14px; margin: 14px 0; }
.ce-body th, .ce-body td { border: 1px solid rgba(127,127,127,.35); padding: 6px 9px; text-align: left; }
.ce-body a { color: inherit; text-decoration: underline; text-underline-offset: 3px; opacity: .9; }
.ce-body .callout { border: 1px solid rgba(127,127,127,.3); border-radius: 10px; padding: 10px 14px; margin: 14px 0; }
.ce-body .callout-title { font-weight: 600; margin-bottom: 4px; }
.ce-footer {
  flex: 0 0 auto; margin-top: 16px; padding-top: 12px; font-size: 12px; opacity: .72;
  display: flex; justify-content: space-between; align-items: center; gap: 12px;
}
.ce-footer-left { display: flex; align-items: center; gap: 8px; text-align: left; min-width: 0; }
.ce-footer-right { text-align: right; white-space: nowrap; }
.ce-avatar { width: 26px; height: 26px; border-radius: 50%; object-fit: cover; flex: 0 0 auto; }
.ce-watermark {
  position: absolute; right: 14px; bottom: 8px; font-size: 11px; opacity: .34; letter-spacing: .04em;
}
.ce-watermark.ce-watermark-band { left: 0; right: 0; bottom: 0; text-align: center; padding: 4px 0; opacity: .5; }
`;

/* ============================== 15 套主题 ============================== */

const THEMES = [
  {
    id: 'mono',
    name: '极简黑白',
    css: `
.ce-card[data-theme="mono"] { background: #FFFFFF; color: #111111; }
.ce-card[data-theme="mono"] .ce-inner { padding: 42px 38px; }
.ce-card[data-theme="mono"] .ce-title { letter-spacing: -.012em; }
.ce-card[data-theme="mono"] .ce-meta { border-bottom: 1px solid #E6E6E6; padding-bottom: 14px; }
.ce-card[data-theme="mono"] .ce-body strong { background: linear-gradient(transparent 62%, #FFE58F 62%); padding: 0 1px; }
.ce-card[data-theme="mono"] .ce-body h2 { border-bottom: 1px solid #EDEDED; padding-bottom: 6px; }
.ce-card[data-theme="mono"] .ce-body blockquote { border-left-color: #111111; font-style: normal; }
.ce-card[data-theme="mono"] .ce-footer { border-top: 1px solid #E6E6E6; }
`,
  },
  {
    id: 'gray',
    name: '简约高级灰',
    css: `
.ce-card[data-theme="gray"] { background: #F3F4F6; color: #2B2F36; }
.ce-card[data-theme="gray"] .ce-inner {
  margin: 22px; padding: 30px 28px; background: #FFFFFF; border: 1px solid #E4E7EC; border-radius: 6px;
}
.ce-card[data-theme="gray"] .ce-title { font-weight: 600; letter-spacing: .01em; }
.ce-card[data-theme="gray"] .ce-meta {
  color: #8A93A0; opacity: 1; font-size: 11px; letter-spacing: .14em; text-transform: uppercase;
}
.ce-card[data-theme="gray"] .ce-body h2 { font-weight: 600; border-left: 3px solid #C4CAD3; padding-left: 10px; }
.ce-card[data-theme="gray"] .ce-body strong { color: #111827; box-shadow: inset 0 -1px 0 #C4CAD3; }
.ce-card[data-theme="gray"] .ce-body blockquote { border-left-color: #C4CAD3; opacity: 1; color: #4B5563; }
.ce-card[data-theme="gray"] .ce-footer { border-top: 1px solid #E4E7EC; }
`,
  },
  {
    id: 'memo',
    name: '苹果备忘录',
    css: `
.ce-card[data-theme="memo"] { background: #F7F7F5; color: #1C1C1E; }
.ce-card[data-theme="memo"] .ce-inner {
  margin: 26px; padding: 28px 26px; background: #FFFFFF; border-radius: 16px;
  box-shadow: 0 1px 2px rgba(0,0,0,.05), 0 10px 30px rgba(0,0,0,.06);
}
.ce-card[data-theme="memo"] .ce-title { font-size: 24px; }
.ce-card[data-theme="memo"] .ce-meta { color: #8E8E93; opacity: 1; }
.ce-card[data-theme="memo"] .ce-body strong { color: #B4690E; }
.ce-card[data-theme="memo"] .ce-body blockquote { border-left-color: #FFD60A; opacity: 1; color: #4A4A4A; }
.ce-card[data-theme="memo"] .ce-body code { background: #F2F2F7; color: #C2410C; }
.ce-card[data-theme="memo"] .ce-footer { border-top: 1px solid #F0F0F0; }
`,
  },
  {
    id: 'warm',
    name: '温暖柔和',
    css: `
.ce-card[data-theme="warm"] { background: #FFF6EC; color: #4A3B32; }
.ce-card[data-theme="warm"] .ce-inner {
  margin: 20px; padding: 30px 28px; background: #FFFDFA; border-radius: 22px;
  box-shadow: 0 10px 30px rgba(180,140,100,.14);
}
.ce-card[data-theme="warm"] .ce-title { color: #B4690E; }
.ce-card[data-theme="warm"] .ce-meta { color: #B08968; opacity: 1; }
.ce-card[data-theme="warm"] .ce-body h2 { color: #B4690E; }
.ce-card[data-theme="warm"] .ce-body strong { color: #C2410C; }
.ce-card[data-theme="warm"] .ce-body code { background: #FFF1E0; color: #B4690E; }
.ce-card[data-theme="warm"] .ce-body blockquote {
  background: #FFF3E4; border-left-color: #F0B77A; border-radius: 0 12px 12px 0; padding: 10px 14px; opacity: 1; color: #6B4E33;
}
.ce-card[data-theme="warm"] .ce-footer { border-top: 1px dashed #EADBC8; }
`,
  },
  {
    id: 'fresh',
    name: '清新自然',
    css: `
.ce-card[data-theme="fresh"] { background: #F1F7F2; color: #22402B; }
.ce-card[data-theme="fresh"] .ce-inner {
  margin: 24px; padding: 28px 26px; background: #FFFFFF; border-radius: 18px;
  box-shadow: 0 8px 24px rgba(34,64,43,.10);
}
.ce-card[data-theme="fresh"] .ce-title { color: #2F6B45; }
.ce-card[data-theme="fresh"] .ce-meta { color: #6B8F78; opacity: 1; }
.ce-card[data-theme="fresh"] .ce-body h2 { color: #2F6B45; }
.ce-card[data-theme="fresh"] .ce-body strong { color: #C2410C; }
.ce-card[data-theme="fresh"] .ce-body code { background: #ECF7EE; color: #2F6B45; }
.ce-card[data-theme="fresh"] .ce-body blockquote {
  background: #ECF7EE; border-left-color: #7BC495; border-radius: 0 10px 10px 0; padding: 10px 14px; opacity: 1;
}
.ce-card[data-theme="fresh"] .ce-footer { border-top: 1px solid #E3EFE7; }
`,
  },
  {
    id: 'dawn',
    name: '清野晨光',
    css: `
.ce-card[data-theme="dawn"] { background: linear-gradient(170deg, #E9F5FF 0%, #F7FBEF 55%, #FFF8E7 100%); color: #274156; }
.ce-card[data-theme="dawn"] .ce-inner { padding: 38px 34px; }
.ce-card[data-theme="dawn"] .ce-title { color: #1D4E89; }
.ce-card[data-theme="dawn"] .ce-meta { color: #6B8CAE; opacity: 1; }
.ce-card[data-theme="dawn"] .ce-body h2 { color: #2C7A7B; }
.ce-card[data-theme="dawn"] .ce-body strong { color: #B7791F; }
.ce-card[data-theme="dawn"] .ce-body code { background: rgba(214,236,255,.85); color: #1D4E89; }
.ce-card[data-theme="dawn"] .ce-body blockquote {
  border-left-color: #63B3ED; background: rgba(255,255,255,.62); border-radius: 0 10px 10px 0; padding: 10px 14px; opacity: 1;
}
.ce-card[data-theme="dawn"] .ce-footer { border-top: 1px solid rgba(39,65,86,.15); }
`,
  },
  {
    id: 'dream',
    name: '梦幻渐变',
    css: `
.ce-card[data-theme="dream"] { background: linear-gradient(140deg, #7F7FD5 0%, #86A8E7 48%, #91EAE4 100%); color: #FFFFFF; }
.ce-card[data-theme="dream"] .ce-inner {
  margin: 22px; padding: 26px 24px; border-radius: 20px;
  background: rgba(255,255,255,.16); border: 1px solid rgba(255,255,255,.4);
}
.ce-card[data-theme="dream"] .ce-title { text-shadow: 0 2px 14px rgba(0,0,0,.22); }
.ce-card[data-theme="dream"] .ce-meta { color: #FFFFFF; opacity: .8; }
.ce-card[data-theme="dream"] .ce-body strong { color: #FFF9C4; }
.ce-card[data-theme="dream"] .ce-body code { background: rgba(255,255,255,.24); color: #FFFFFF; }
.ce-card[data-theme="dream"] .ce-body pre { background: rgba(0,0,0,.20); }
.ce-card[data-theme="dream"] .ce-body blockquote { border-left-color: #FFFFFF; opacity: .95; }
.ce-card[data-theme="dream"] .ce-footer { border-top: 1px solid rgba(255,255,255,.35); opacity: .9; }
`,
  },
  {
    id: 'watercolor',
    name: '水彩艺术',
    css: `
.ce-card[data-theme="watercolor"] {
  color: #33404A;
  background-color: #FDFDFB;
  background-image:
    radial-gradient(circle at 12% 16%, rgba(255,183,197,.55) 0 21%, transparent 58%),
    radial-gradient(circle at 88% 10%, rgba(167,216,255,.55) 0 20%, transparent 56%),
    radial-gradient(circle at 80% 88%, rgba(255,229,168,.5) 0 22%, transparent 58%),
    radial-gradient(circle at 18% 88%, rgba(186,238,214,.5) 0 20%, transparent 56%);
}
.ce-card[data-theme="watercolor"] .ce-inner {
  margin: 18px; padding: 30px 28px; background: rgba(255,255,255,.74); border-radius: 18px;
}
.ce-card[data-theme="watercolor"] .ce-title { color: #2C5F8A; }
.ce-card[data-theme="watercolor"] .ce-meta { color: #6B8CAE; opacity: 1; }
.ce-card[data-theme="watercolor"] .ce-body h2 { color: #2C5F8A; }
.ce-card[data-theme="watercolor"] .ce-body strong { color: #C2410C; }
.ce-card[data-theme="watercolor"] .ce-body blockquote {
  border-left-color: #7FB3D5; background: rgba(255,255,255,.7); padding: 10px 14px; opacity: 1;
}
.ce-card[data-theme="watercolor"] .ce-footer { border-top: 1px dashed rgba(51,64,74,.25); }
`,
  },
  {
    id: 'xhs',
    name: '紫色小红书',
    css: `
.ce-card[data-theme="xhs"] { background: #FFFFFF; color: #1F1F1F; }
.ce-card[data-theme="xhs"] .ce-inner {
  margin: 16px; padding: 26px 24px 22px; border-radius: 18px; border: 1px solid #F1E4FF;
  background: linear-gradient(180deg, #FBF5FF 0%, #FFFFFF 46%);
}
.ce-card[data-theme="xhs"] .ce-title { color: #7C3AED; font-size: 25px; line-height: 1.3; }
.ce-card[data-theme="xhs"] .ce-meta { color: #A855F7; opacity: 1; }
.ce-card[data-theme="xhs"] .ce-body h2 {
  color: #6D28D9; background: #F5F3FF; border-radius: 8px; padding: 3px 11px; display: inline-block; font-size: 18px;
}
.ce-card[data-theme="xhs"] .ce-body strong { color: #DB2777; }
.ce-card[data-theme="xhs"] .ce-body blockquote {
  background: #FDF2F8; border-left-color: #F472B6; border-radius: 0 10px 10px 0; padding: 10px 14px; opacity: 1;
}
.ce-card[data-theme="xhs"] .ce-footer { border-top: 1px dashed #E9D5FF; }
`,
  },
  {
    id: 'dark',
    name: '暗黑科技',
    css: `
.ce-card[data-theme="dark"] { background: #0E1116; color: #E6EDF3; }
.ce-card[data-theme="dark"] .ce-inner { padding: 38px 34px; }
.ce-card[data-theme="dark"] .ce-title { color: #FFFFFF; }
.ce-card[data-theme="dark"] .ce-meta { border-bottom: 1px solid #30363D; padding-bottom: 13px; color: #8B949E; opacity: 1; }
.ce-card[data-theme="dark"] .ce-body h2 { color: #7EE787; border-left: 3px solid #7EE787; padding-left: 10px; }
.ce-card[data-theme="dark"] .ce-body strong { color: #FFA657; }
.ce-card[data-theme="dark"] .ce-body code { background: rgba(110,118,129,.28); color: #FFA657; }
.ce-card[data-theme="dark"] .ce-body pre { background: #161B22; border: 1px solid #30363D; }
.ce-card[data-theme="dark"] .ce-body blockquote { border-left-color: #58A6FF; opacity: 1; color: #A5D6FF; }
.ce-card[data-theme="dark"] .ce-body th, .ce-card[data-theme="dark"] .ce-body td { border-color: #30363D; }
.ce-card[data-theme="dark"] .ce-footer { border-top: 1px solid #30363D; color: #8B949E; opacity: 1; }
`,
  },
  {
    id: 'biz',
    name: '商务简报',
    css: `
.ce-card[data-theme="biz"] { background: #EEF2F7; color: #1F2937; }
.ce-card[data-theme="biz"] .ce-inner { margin: 18px; padding: 0; background: #FFFFFF; border-radius: 14px; overflow: hidden; }
.ce-card[data-theme="biz"] .ce-head { background: #123B6D; color: #FFFFFF; padding: 22px 28px 18px; }
.ce-card[data-theme="biz"] .ce-title { color: #FFFFFF; font-size: 24px; }
.ce-card[data-theme="biz"] .ce-meta { color: #BFD3EA; opacity: 1; margin-bottom: 0; }
.ce-card[data-theme="biz"] .ce-body { padding: 22px 28px 0; }
.ce-card[data-theme="biz"] .ce-body h2 { color: #123B6D; }
.ce-card[data-theme="biz"] .ce-body strong { color: #1D4ED8; }
.ce-card[data-theme="biz"] .ce-body blockquote {
  border-left-color: #1D4ED8; opacity: 1; color: #334155; background: #F1F5F9; border-radius: 0 8px 8px 0; padding: 10px 14px;
}
.ce-card[data-theme="biz"] .ce-body th { background: #F1F5F9; }
.ce-card[data-theme="biz"] .ce-footer { margin: 16px 28px 22px; border-top: 1px solid #E2E8F0; }
`,
  },
  {
    id: 'japan',
    name: '日本杂志',
    css: `
.ce-card[data-theme="japan"] { background: #FFFFFF; color: #1A1A1A; }
.ce-card[data-theme="japan"] .ce-inner { padding: 40px 34px; }
.ce-card[data-theme="japan"] .ce-title {
  font-size: 24px; font-weight: 600; letter-spacing: .04em; padding-bottom: 12px; border-bottom: 3px solid #1A1A1A;
}
.ce-card[data-theme="japan"] .ce-meta {
  font-size: 11px; letter-spacing: .24em; text-transform: uppercase; color: #8A8A8A; opacity: 1;
}
.ce-card[data-theme="japan"] .ce-body h2 { font-size: 17px; letter-spacing: .06em; padding-left: 12px; border-left: 4px solid #C0392B; }
.ce-card[data-theme="japan"] .ce-body strong { color: #C0392B; }
.ce-card[data-theme="japan"] .ce-body blockquote {
  border-left: none; border-top: 1px solid #DDDDDD; border-bottom: 1px solid #DDDDDD; padding: 12px 0;
  opacity: 1; color: #444444; font-style: normal;
}
.ce-card[data-theme="japan"] .ce-body code { background: #F4F4F4; color: #333333; }
.ce-card[data-theme="japan"] .ce-footer { border-top: 1px solid #DDDDDD; }
`,
  },
  {
    id: 'china',
    name: '中国传统',
    css: `
.ce-card[data-theme="china"] {
  background: #F4EDE0; color: #2E2A26;
  font-family: "Songti SC", "SimSun", "STSong", Georgia, serif;
}
.ce-card[data-theme="china"] .ce-inner {
  margin: 14px; padding: 34px 30px; background: #FBF7F0; border: 1px solid #C9B79C;
}
.ce-card[data-theme="china"] .ce-title { text-align: center; color: #8C1F28; letter-spacing: .08em; }
.ce-card[data-theme="china"] .ce-meta { text-align: center; color: #8C6A4A; opacity: 1; letter-spacing: .18em; }
.ce-card[data-theme="china"] .ce-body h2 {
  color: #8C1F28; text-align: center; border-top: 1px solid #D9C8AE; border-bottom: 1px solid #D9C8AE; padding: 6px 0;
}
.ce-card[data-theme="china"] .ce-body strong { color: #8C1F28; }
.ce-card[data-theme="china"] .ce-body blockquote {
  border-left: 3px solid #B03A3A; background: #F7EFE2; padding: 10px 14px; opacity: 1; color: #4A3F35;
}
.ce-card[data-theme="china"] .ce-body code { background: #F2E7D5; color: #8C1F28; }
.ce-card[data-theme="china"] .ce-footer { border-top: 1px solid #D9C8AE; }
`,
  },
  {
    id: 'typewriter',
    name: '复古打字机',
    css: `
.ce-card[data-theme="typewriter"] {
  background: #F6F1E4; color: #2B2B2B;
  font-family: Georgia, "Songti SC", "SimSun", "Times New Roman", serif;
}
.ce-card[data-theme="typewriter"] .ce-inner { padding: 40px 36px; }
.ce-card[data-theme="typewriter"] .ce-title {
  text-align: center; border-bottom: 2px double #2B2B2B; padding-bottom: 12px; letter-spacing: .02em;
}
.ce-card[data-theme="typewriter"] .ce-meta { text-align: center; font-style: italic; opacity: .8; }
.ce-card[data-theme="typewriter"] .ce-body h2 { border-bottom: 1px dashed #9A8C6E; padding-bottom: 6px; }
.ce-card[data-theme="typewriter"] .ce-body blockquote {
  border-left: 3px double #9A8C6E; font-style: italic; opacity: 1; color: #4A4034;
}
.ce-card[data-theme="typewriter"] .ce-body code, .ce-card[data-theme="typewriter"] .ce-body pre {
  font-family: "Courier New", ui-monospace, monospace;
}
.ce-card[data-theme="typewriter"] .ce-body pre { background: #EFE8D6; border: 1px solid #DED3B8; }
.ce-card[data-theme="typewriter"] .ce-footer { border-top: 2px double #2B2B2B; }
`,
  },
  {
    id: 'notebook',
    name: '笔记本',
    css: `
.ce-card[data-theme="notebook"] {
  color: #22303C;
  background-color: #FBFCFD;
  background-image:
    linear-gradient(90deg, transparent 0 44px, rgba(224,90,90,.45) 44px 45px, transparent 45px),
    repeating-linear-gradient(180deg, transparent 0 31px, rgba(70,130,180,.22) 31px 32px);
}
.ce-card[data-theme="notebook"] .ce-inner { padding: 34px 30px 34px 58px; }
.ce-card[data-theme="notebook"] .ce-title { color: #1B4F72; font-family: "Kaiti SC", "KaiTi", Georgia, serif; }
.ce-card[data-theme="notebook"] .ce-meta { color: #5D8AA8; opacity: 1; }
.ce-card[data-theme="notebook"] .ce-body h2 { color: #1B4F72; }
.ce-card[data-theme="notebook"] .ce-body strong { background: linear-gradient(transparent 60%, #FFE9A8 60%); }
.ce-card[data-theme="notebook"] .ce-body code { background: rgba(70,130,180,.12); color: #1B4F72; }
.ce-card[data-theme="notebook"] .ce-footer { border-top: 1px dashed rgba(70,130,180,.35); }
`,
  },
];

/* ============================== 默认设置 ============================== */

const DEFAULT_SETTINGS = {
  // 默认样式
  defaultTheme: 'mono',
  defaultSize: 'long',
  // 输出
  saveToVault: true,
  saveToFile: false,
  outputFolder: '',
  lastExportDir: '',
  scale: 2,
  copyToClipboard: false,
  maxPages: 12,
  // 元素
  footerEnabled: true,
  footerAuthor: '',
  footerNote: '',
  avatar: '',
  showMetaDate: true,
  showMetaWords: true,
  metaSource: '',
  // 水印
  watermarkEnabled: false,
  watermarkText: '',
  watermarkBand: false,
  // 背景
  bgType: 'theme',
  bgColor: '#FFFFFF',
  bgGradient: 'dawn',
  bgTexture: 'dots',
  bgImage: '',
  bgImageFit: 'cover',
  bgVeil: 0,
  bgVeilColor: '#FFFFFF',
  // 高级
  customCssFile: '',
};

/* ============================== 纯函数（可单测） ============================== */

function getTheme(id) {
  return THEMES.find((t) => t.id === id) || THEMES[0];
}

function getSize(id) {
  return SIZES.find((s) => s.id === id) || SIZES[0];
}

function themeCss(themeId, customCss) {
  const t = getTheme(themeId);
  return `${BASE_CSS}\n${t.css}\n${customCss || ''}`;
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * 卡片外壳（不含正文块）。正文块由调用方 append 到 .ce-body。
 * opts: { themeId, sizeId, width, height, title, meta, footerLeft, footerRight,
 *         avatar, watermark, watermarkBand, bgStyle }
 */
function buildCardShellHtml(opts) {
  const o = opts || {};
  const size = getSize(o.sizeId);
  const theme = getTheme(o.themeId);
  const width = o.width || size.width;
  const height = o.height === undefined ? size.height : o.height;
  const sizeStyle = height
    ? `width:${width}px;height:${height}px`
    : `width:${width}px;min-height:${Math.round(width * 0.5)}px`;
  const style = `${sizeStyle};${o.bgStyle || ''}`;
  const parts = [];
  parts.push(`<div class="ce-card" data-theme="${escapeHtml(theme.id)}" style="${style}">`);
  parts.push('<div class="ce-inner">');
  parts.push('<div class="ce-head">');
  if (o.title) parts.push(`<div class="ce-title">${escapeHtml(o.title)}</div>`);
  if (o.meta) parts.push(`<div class="ce-meta">${escapeHtml(o.meta)}</div>`);
  parts.push('</div>');
  parts.push('<div class="ce-body"></div>');
  if (o.avatar || o.footerLeft || o.footerRight) {
    parts.push('<div class="ce-footer">');
    parts.push('<div class="ce-footer-left">');
    if (o.avatar) parts.push(`<img class="ce-avatar" src="${escapeHtml(o.avatar)}" alt="">`);
    if (o.footerLeft) parts.push(`<span>${escapeHtml(o.footerLeft)}</span>`);
    parts.push('</div>');
    parts.push(`<div class="ce-footer-right">${escapeHtml(o.footerRight || '')}</div>`);
    parts.push('</div>');
  }
  parts.push('</div>');
  if (o.watermark) {
    const cls = o.watermarkBand ? 'ce-watermark ce-watermark-band' : 'ce-watermark';
    parts.push(`<div class="${cls}">${escapeHtml(o.watermark)}</div>`);
  }
  parts.push('</div>');
  return parts.join('');
}

/** 分页：contentHeight 为 0 表示自适应长图（一页装完） */
function paginate(blocks, opts) {
  const o = opts || {};
  const contentHeight = Number(o.contentHeight) || 0;
  const gap = Number(o.gap) || 0;
  const list = (blocks || []).map((b) => ({ height: Math.max(0, Number(b && b.height) || 0) }));
  const pages = [];
  if (!list.length) return [{ indices: [], height: 0 }];
  if (!contentHeight) {
    const total = list.reduce((s, b) => s + b.height, 0) + gap * (list.length - 1);
    return [{ indices: list.map((_, i) => i), height: Math.ceil(total) }];
  }
  let cur = [];
  let curH = 0;
  for (let i = 0; i < list.length; i++) {
    const h = list[i].height;
    const add = cur.length ? gap + h : h;
    if (cur.length && curH + add > contentHeight) {
      pages.push({ indices: cur, height: Math.ceil(curH) });
      cur = [i];
      curH = h;
    } else {
      cur.push(i);
      curH += add;
    }
  }
  if (cur.length) pages.push({ indices: cur, height: Math.ceil(curH) });
  return pages;
}

/** 按第 level 级标题把 markdown 切成多段 */
function splitByHeadings(markdown, level) {
  const lv = Number(level) || 2;
  const text = String(markdown == null ? '' : markdown);
  const isHeading = new RegExp(`^#{${lv}}\\s+(.+?)\\s*$`);
  const parts = [];
  let title = null;
  let buf = [];
  const flush = () => {
    const body = buf.join('\n').trim();
    if (body || title) parts.push({ title, markdown: body });
    buf = [];
  };
  for (const line of text.split(/\r?\n/)) {
    const m = isHeading.exec(line);
    if (m) {
      flush();
      title = m[1].trim();
    } else {
      buf.push(line);
    }
  }
  flush();
  return parts.filter((p) => (p.markdown || '').trim().length > 0 || p.title);
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function stamp(date) {
  const d = date instanceof Date ? date : new Date();
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}`;
}

/** 导出文件名：<笔记名>-<YYYYMMDD-HHmm>[-序号].png */
function buildFileName(baseName, date, index, total) {
  const clean = String(baseName == null ? '' : baseName).trim().replace(/[\\/:*?"<>|]/g, '_') || '卡片';
  const suffix = total && total > 1 ? `-${index + 1}` : '';
  return `${clean}-${stamp(date)}${suffix}.png`;
}

/** 去掉 markdown 语法后的纯文本，用来统计字数 */
function plainText(markdown) {
  return String(markdown == null ? '' : markdown)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_~\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normDir(p) {
  const s = String(p || '').replace(/\\/g, '/');
  const i = s.lastIndexOf('/');
  return i === -1 ? '' : s.slice(0, i);
}

/** 组 meta 行：日期 / 字数 / 来源 / 模式提示，按设置取舍 */
function buildMetaParts(opts) {
  const o = opts || {};
  const parts = [];
  if (o.mode === 'selection') parts.push('选中内容');
  if (o.mode === 'headings') parts.push('按标题切分');
  if (o.showDate && o.date) parts.push(o.date);
  if (o.showWords && Number.isFinite(o.words)) parts.push(`${o.words} 字`);
  if (o.source) parts.push(o.source);
  return parts;
}

/* ============================== DOM → PNG ============================== */

function arrayBufferToDataUrl(buf, mime) {
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return `data:${mime || 'image/png'};base64,${btoa(binary)}`;
}

const MIME_BY_EXT = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', avif: 'image/avif',
};

async function fileToDataUrl(app, file) {
  const buf = await app.vault.readBinary(file);
  const ext = (file.extension || '').toLowerCase();
  return arrayBufferToDataUrl(buf, MIME_BY_EXT[ext] || 'image/png');
}

async function resolveVaultFile(app, linkOrPath) {
  const raw = String(linkOrPath || '').trim();
  if (!raw) return null;
  const cleaned = raw.replace(/^!?\[\[|\]\]$/g, '').split('|')[0].split('#')[0].trim();
  let f = app.metadataCache.getFirstLinkpathDest(cleaned, '');
  if (!f) f = app.vault.getAbstractFileByPath(normalizePath(cleaned));
  return f instanceof TFile ? f : null;
}

/** 卡片里的 <img>（含头像）换成 dataURL —— SVG 作为图片加载时拿不到 app:// 资源 */
async function inlineImages(root, app) {
  const imgs = Array.from(root.querySelectorAll('img'));
  let failed = 0;
  for (const img of imgs) {
    const src = img.getAttribute('src') || '';
    if (!src || src.startsWith('data:')) continue;
    try {
      let rel = src;
      const m = /^app:\/\/[^/]*\/(.*)$/.exec(src);
      if (m) rel = decodeURIComponent(m[1]);
      rel = rel.split('#')[0].split('?')[0];
      let file = app.metadataCache.getFirstLinkpathDest(rel, '');
      if (!file) file = app.vault.getAbstractFileByPath(normalizePath(rel));
      if (!(file instanceof TFile)) { failed++; continue; }
      img.setAttribute('src', await fileToDataUrl(app, file));
      img.removeAttribute('srcset');
    } catch (e) {
      failed++;
    }
  }
  return failed;
}

/** 背景图：把库内图片读成 dataURL 并铺到卡片上（导出前必须做完） */
async function applyBackgroundImage(cardEl, app, bg) {
  const b = bg || {};
  if (b.type !== 'image' || !b.image) return false;
  const file = await resolveVaultFile(app, b.image);
  if (!file) return false;
  const dataUrl = await fileToDataUrl(app, file);
  cardEl.style.cssText += backgroundImageStyle(dataUrl, b);
  return true;
}

/** 把整棵树的计算样式内联到克隆节点上（foreignObject 里不会继承文档样式） */
function inlineComputedStyles(src, dst) {
  const srcNodes = [src].concat(Array.from(src.querySelectorAll('*')));
  const dstNodes = [dst].concat(Array.from(dst.querySelectorAll('*')));
  const n = Math.min(srcNodes.length, dstNodes.length);
  for (let i = 0; i < n; i++) {
    const cs = window.getComputedStyle(srcNodes[i]);
    let css = '';
    for (let j = 0; j < cs.length; j++) {
      const prop = cs[j];
      css += `${prop}:${cs.getPropertyValue(prop)};`;
    }
    const el = dstNodes[i];
    if (el.setAttribute) el.setAttribute('style', css);
  }
}

/** 卡片元素 → PNG Blob（纯浏览器 API，无第三方依赖） */
async function cardToPngBlob(cardEl, opts) {
  const o = opts || {};
  const width = Math.round(cardEl.offsetWidth || o.width || 600);
  const height = Math.round(cardEl.offsetHeight || o.height || 600);
  const scale = Number(o.scale) > 0 ? Number(o.scale) : 2;

  const clone = cardEl.cloneNode(true);
  clone.style.position = 'static';
  clone.style.margin = '0';
  clone.style.left = '0';
  clone.style.top = '0';
  clone.style.transform = 'none';
  inlineComputedStyles(cardEl, clone);

  const holder = document.createElement('div');
  holder.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
  holder.style.width = `${width}px`;
  holder.style.height = `${height}px`;
  holder.appendChild(clone);

  const xhtml = new XMLSerializer().serializeToString(holder);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
    `<foreignObject x="0" y="0" width="${width}" height="${height}">${xhtml}</foreignObject></svg>`;
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

  const img = new Image();
  await new Promise((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('SVG 渲染失败（内容里可能有不受支持的资源）'));
    img.src = url;
  });

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  ctx.drawImage(img, 0, 0, width, height);

  return await new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('导出 PNG 失败'))), 'image/png');
  });
}

/* ============================== 另存到文件系统 ============================== */

function getElectronRemote() {
  try {
    const r = require('@electron/remote');
    if (r && r.dialog) return r;
  } catch (e) { /* 不是桌面端或没有该模块 */ }
  try {
    const e = require('electron');
    if (e && e.remote && e.remote.dialog) return e.remote;
  } catch (e) { /* 同上 */ }
  return null;
}

function nodeRequire(name) {
  try {
    return require(name);
  } catch (e) {
    return null;
  }
}

/** 桌面端：弹原生"另存为"对话框，把 PNG 写到用户选的位置 */
async function saveBlobToFileDialog(blob, suggestedName, defaultDir, promptFn) {
  const fs = nodeRequire('fs');
  const path = nodeRequire('path');
  const os = nodeRequire('os');
  if (!fs || !path) throw new Error('当前环境不支持写入文件系统（手机端请改用"保存到库"）');
  const remote = getElectronRemote();
  let desktop = '';
  try {
    desktop = remote && remote.app ? remote.app.getPath('desktop') : path.join(os.homedir(), 'Desktop');
  } catch (e) {
    desktop = os.homedir ? os.homedir() : '';
  }
  if (!remote) {
    // 没有原生对话框：弹输入框让用户手填路径（默认给到桌面），再直接写
    const fallback = path.join(defaultDir || desktop, suggestedName);
    const chosen = promptFn ? await promptFn(fallback) : null;
    if (!chosen) return null;
    fs.writeFileSync(chosen, Buffer.from(new Uint8Array(await blob.arrayBuffer())));
    return chosen;
  }
  const options = {
    title: '保存卡片图片',
    defaultPath: path.join(defaultDir || desktop, suggestedName),
    filters: [{ name: 'PNG 图片', extensions: ['png'] }],
  };
  let res;
  try {
    const win = remote.getCurrentWindow ? remote.getCurrentWindow() : null;
    res = win ? await remote.dialog.showSaveDialog(win, options) : await remote.dialog.showSaveDialog(options);
  } catch (e) {
    res = await remote.dialog.showSaveDialog(options);
  }
  if (!res || res.canceled || !res.filePath) return null;
  fs.writeFileSync(res.filePath, Buffer.from(new Uint8Array(await blob.arrayBuffer())));
  return res.filePath;
}

/* ============================== 路径输入框（保存对话框不可用时的兜底） ============================== */

class PathPromptModal extends Modal {
  constructor(app, opts) {
    super(app);
    this.opts = opts || {};
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl('h3', { text: this.opts.title || '保存到文件' });
    if (this.opts.description) contentEl.createEl('p', { text: this.opts.description });
    const input = contentEl.createEl('input', { type: 'text', cls: 'ce-path-input' });
    input.value = this.opts.value || '';
    input.style.width = '100%';
    input.style.marginTop = '6px';
    const submit = () => {
      const v = input.value.trim();
      if (!v) return;
      this._submitted = true;
      this.close();
      if (this.opts.onSubmit) this.opts.onSubmit(v);
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        submit();
      }
    });
    const bar = contentEl.createDiv({ cls: 'ce-path-buttons' });
    bar.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;margin-top:14px;';
    const ok = bar.createEl('button', { text: '保存', cls: 'mod-cta' });
    ok.addEventListener('click', submit);
    const cancel = bar.createEl('button', { text: '取消' });
    cancel.addEventListener('click', () => this.close());
    setTimeout(() => input.focus(), 0);
  }

  onClose() {
    this.contentEl.empty();
    if (!this._submitted && this.opts.onCancel) this.opts.onCancel();
  }
}

/* ============================== 主插件 ============================== */

class CardExportPlugin extends Plugin {
  async onload() {
    await this.loadSettings();

    this.addCommand({
      id: 'export-card',
      name: '导出为卡片图片（整篇）',
      callback: () => this.openExport({ mode: 'note' }),
    });
    this.addCommand({
      id: 'export-card-selection',
      name: '导出为卡片图片（选中的内容）',
      callback: () => this.openExport({ mode: 'selection' }),
    });
    this.addCommand({
      id: 'export-card-headings',
      name: '导出为卡片图片（按标题切成多张）',
      callback: () => this.openExport({ mode: 'headings' }),
    });

    this.addSettingTab(new CardExportSettingTab(this.app, this));
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, (await this.loadData()) || {});
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  async openExport(opts) {
    const file = this.app.workspace.getActiveFile();
    if (!file) {
      new Notice('没有打开的笔记。');
      return;
    }
    const mode = opts.mode;
    let markdown = await this.app.vault.cachedRead(file);

    if (mode === 'selection') {
      const editor = this.app.workspace.activeEditor && this.app.workspace.activeEditor.editor;
      const sel = editor ? editor.getSelection() : '';
      if (!sel || !sel.trim()) {
        new Notice('没有选中任何内容。先在编辑器里选中一段再试。');
        return;
      }
      markdown = sel;
    }

    const noFm = markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
    const docTitle = (markdown.match(/^#\s+(.+)$/m) || [])[1] || file.basename;
    const withoutH1 = noFm.replace(/^#\s+.+$/m, '').trim();

    new CardExportModal(this.app, this, {
      mode,
      sourcePath: file.path,
      baseName: file.basename,
      docTitle,
      markdown: withoutH1 || noFm,
    }).open();
  }

  async loadCustomCss() {
    const p = (this.settings.customCssFile || '').trim();
    if (!p) return '';
    const f = this.app.vault.getAbstractFileByPath(normalizePath(p));
    if (!(f instanceof TFile)) return '';
    try {
      return await this.app.vault.cachedRead(f);
    } catch (e) {
      return '';
    }
  }

  themeCssFor(themeId, customCss) {
    return themeCss(themeId, customCss);
  }

  /* ---------------- 落盘 ---------------- */

  async ensureFolder(path) {
    const clean = normalizePath(path);
    if (!clean) return null;
    if (this.app.vault.getAbstractFileByPath(clean) instanceof TFolder) return clean;
    const parts = clean.split('/');
    let cur = '';
    for (const part of parts) {
      cur = cur ? `${cur}/${part}` : part;
      if (this.app.vault.getAbstractFileByPath(cur) instanceof TFolder) continue;
      try {
        await this.app.vault.createFolder(cur);
      } catch (e) {
        if (!(this.app.vault.getAbstractFileByPath(cur) instanceof TFolder)) throw e;
      }
    }
    return clean;
  }

  resolveOutputFolder(sourcePath) {
    const configured = (this.settings.outputFolder || '').trim();
    if (configured) return normalizePath(configured);
    return normDir(sourcePath);
  }

  async saveBlobToVault(blob, sourcePath, fileName) {
    const folder = this.resolveOutputFolder(sourcePath);
    if (folder) await this.ensureFolder(folder);
    const withFolder = (name) => normalizePath(folder ? `${folder}/${name}` : name);
    let path = withFolder(fileName);
    let i = 1;
    while (this.app.vault.getAbstractFileByPath(path) && i <= 50) {
      path = withFolder(fileName.replace(/\.png$/, ` (${i}).png`));
      i++;
    }
    return await this.app.vault.createBinary(path, await blob.arrayBuffer());
  }

  async copyBlobToClipboard(blob) {
    if (!navigator.clipboard || !window.ClipboardItem) throw new Error('当前环境不支持写图片到剪贴板');
    await navigator.clipboard.write([new window.ClipboardItem({ 'image/png': blob })]);
  }

  /** 拿不到原生保存对话框时：让用户手填完整路径 */
  promptSavePath(defaultPath) {
    return new Promise((resolve) => {
      new PathPromptModal(this.app, {
        title: '保存到文件',
        description: '当前环境拿不到系统保存对话框，请直接填完整路径（含文件名）。默认已给到桌面。',
        value: defaultPath,
        onSubmit: (p) => resolve(p),
        onCancel: () => resolve(null),
      }).open();
    });
  }

  /** 另存到文件系统；成功后记住目录，下次默认落在这里 */
  async saveBlobToFile(blob, suggestedName) {
    const target = await saveBlobToFileDialog(
      blob, suggestedName, this.settings.lastExportDir, (def) => this.promptSavePath(def)
    );
    if (target) {
      const path = nodeRequire('path');
      this.settings.lastExportDir = path ? path.dirname(target) : '';
      await this.saveSettings();
    }
    return target;
  }
}

/* ============================== 导出弹窗 ============================== */

class CardExportModal extends Modal {
  constructor(app, plugin, ctx) {
    super(app);
    this.plugin = plugin;
    this.ctx = ctx;
    this.themeId = plugin.settings.defaultTheme;
    this.sizeId = plugin.settings.defaultSize;
    this.customCss = '';
    this.pages = [];
    this.pageIndex = 0;
    this.busy = false;
    this._holders = [];
    this.bg = {
      type: plugin.settings.bgType,
      color: plugin.settings.bgColor,
      gradient: plugin.settings.bgGradient,
      texture: plugin.settings.bgTexture,
      image: plugin.settings.bgImage,
      imageFit: plugin.settings.bgImageFit,
      veil: plugin.settings.bgVeil,
      veilColor: plugin.settings.bgVeilColor,
    };
  }

  async onOpen() {
    const { contentEl } = this;
    contentEl.addClass('ce-modal');
    this.titleEl.setText('导出为卡片图片');
    this.customCss = await this.plugin.loadCustomCss();

    this.styleEl = document.createElement('style');
    this.styleEl.textContent = this.plugin.themeCssFor(this.themeId, this.customCss);
    document.head.appendChild(this.styleEl);

    this.setupDom();
    await this.renderPreview();
  }

  setupDom() {
    const { contentEl } = this;
    const s = this.plugin.settings;

    const split = contentEl.createDiv({ cls: 'ce-split' });
    const left = split.createDiv({ cls: 'ce-left' });
    const panel = split.createDiv({ cls: 'ce-panel' });
    this.panel = panel;

    const bar = left.createDiv({ cls: 'ce-bar' });
    const themeWrap = bar.createDiv({ cls: 'ce-field' });
    themeWrap.createEl('label', { text: '样式' });
    const themeSel = themeWrap.createEl('select');
    for (const t of THEMES) themeSel.createEl('option', { value: t.id, text: t.name });
    themeSel.value = this.themeId;
    themeSel.addEventListener('change', async () => {
      this.themeId = themeSel.value;
      await this.renderPreview();
    });

    const sizeWrap = bar.createDiv({ cls: 'ce-field' });
    sizeWrap.createEl('label', { text: '尺寸' });
    const sizeSel = sizeWrap.createEl('select');
    for (const z of SIZES) sizeSel.createEl('option', { value: z.id, text: z.name });
    sizeSel.value = this.sizeId;
    sizeSel.addEventListener('change', async () => {
      this.sizeId = sizeSel.value;
      await this.renderPreview();
    });

    this.infoEl = bar.createDiv({ cls: 'ce-info' });
    this.stageEl = left.createDiv({ cls: 'ce-stage' });

    const actions = left.createDiv({ cls: 'ce-actions' });
    this.pagerEl = actions.createDiv({ cls: 'ce-pager' });
    actions.createDiv({ cls: 'ce-spacer' });
    this.saveBtn = actions.createEl('button', { text: '保存', cls: 'mod-cta' });
    this.saveBtn.addEventListener('click', () => this.exportAll('auto'));
    this.saveAsBtn = actions.createEl('button', { text: '另存为…' });
    this.saveAsBtn.addEventListener('click', () => this.exportAll('file'));
    this.copyBtn = actions.createEl('button', { text: '复制' });
    this.copyBtn.addEventListener('click', () => this.exportAll('copy'));
    const closeBtn = actions.createEl('button', { text: '关闭' });
    closeBtn.addEventListener('click', () => this.close());

    /* ---------- 右侧控制面板 ---------- */
    // 背景
    panel.createEl('h4', { text: '背景' });
    this.row('类型', (r) => {
      const sel = r.createEl('select');
      for (const t of BG_TYPES) sel.createEl('option', { value: t.id, text: t.name });
      sel.value = this.bg.type;
      sel.addEventListener('change', async () => {
        this.bg.type = sel.value;
        await this.renderPreview();
      });
    });
    this.row('纯色', (r) => {
      const c = r.createEl('input', { type: 'color' });
      c.value = this.bg.color;
      c.addEventListener('input', () => { this.bg.color = c.value; this.refreshSoon(); });
    });
    this.row('渐变', (r) => {
      const sel = r.createEl('select');
      for (const g of GRADIENTS) sel.createEl('option', { value: g.id, text: g.name });
      sel.value = this.bg.gradient;
      sel.addEventListener('change', async () => { this.bg.gradient = sel.value; await this.renderPreview(); });
    });
    this.row('纹理', (r) => {
      const sel = r.createEl('select');
      for (const t of TEXTURES) sel.createEl('option', { value: t.id, text: t.name });
      sel.value = this.bg.texture;
      sel.addEventListener('change', async () => { this.bg.texture = sel.value; await this.renderPreview(); });
    });
    this.row('图片', (r) => {
      const i = r.createEl('input', { type: 'text', placeholder: '库内图片路径' });
      i.value = this.bg.image;
      i.addEventListener('change', async () => { this.bg.image = i.value.trim(); await this.renderPreview(); });
    });
    this.row('图片填充', (r) => {
      const sel = r.createEl('select');
      [['cover', '铺满裁切'], ['contain', '完整显示'], ['repeat', '平铺']].forEach(([v, t]) => sel.createEl('option', { value: v, text: t }));
      sel.value = this.bg.imageFit;
      sel.addEventListener('change', async () => { this.bg.imageFit = sel.value; await this.renderPreview(); });
    });
    this.row('遮罩', (r) => {
      const i = r.createEl('input', { type: 'range', min: '0', max: '90' });
      i.value = String(this.bg.veil);
      i.addEventListener('input', () => { this.bg.veil = Number(i.value); this.refreshSoon(); });
    });
    this.row('遮罩色', (r) => {
      const c = r.createEl('input', { type: 'color' });
      c.value = this.bg.veilColor;
      c.addEventListener('input', () => { this.bg.veilColor = c.value; this.refreshSoon(); });
    });

    // 元素
    panel.createEl('h4', { text: '元素' });
    this.row('头像', (r) => {
      const i = r.createEl('input', { type: 'text', placeholder: '库内图片路径（可空）' });
      i.value = s.avatar;
      i.addEventListener('change', async () => { s.avatar = i.value.trim(); await this.plugin.saveSettings(); await this.renderPreview(); });
    });
    this.row('作者', (r) => {
      const i = r.createEl('input', { type: 'text', placeholder: '署名' });
      i.value = s.footerAuthor;
      i.addEventListener('change', async () => { s.footerAuthor = i.value.trim(); await this.plugin.saveSettings(); await this.renderPreview(); });
    });
    this.row('补充', (r) => {
      const i = r.createEl('input', { type: 'text', placeholder: '接在作者后面' });
      i.value = s.footerNote;
      i.addEventListener('change', async () => { s.footerNote = i.value.trim(); await this.plugin.saveSettings(); await this.renderPreview(); });
    });
    this.row('来源', (r) => {
      const i = r.createEl('input', { type: 'text', placeholder: '显示在元信息里' });
      i.value = s.metaSource;
      i.addEventListener('change', async () => { s.metaSource = i.value.trim(); await this.plugin.saveSettings(); await this.renderPreview(); });
    });
    this.toggleRow('显示日期', s.showMetaDate, async (v) => { s.showMetaDate = v; await this.plugin.saveSettings(); await this.renderPreview(); });
    this.toggleRow('显示字数', s.showMetaWords, async (v) => { s.showMetaWords = v; await this.plugin.saveSettings(); await this.renderPreview(); });
    this.toggleRow('显示页脚', s.footerEnabled, async (v) => { s.footerEnabled = v; await this.plugin.saveSettings(); await this.renderPreview(); });

    // 水印
    panel.createEl('h4', { text: '水印' });
    this.row('文字', (r) => {
      const i = r.createEl('input', { type: 'text', placeholder: '@账号' });
      i.value = s.watermarkText;
      i.addEventListener('change', async () => { s.watermarkText = i.value.trim(); s.watermarkEnabled = !!s.watermarkText; await this.plugin.saveSettings(); await this.renderPreview(); });
    });
    this.toggleRow('铺满底部', s.watermarkBand, async (v) => { s.watermarkBand = v; await this.plugin.saveSettings(); await this.renderPreview(); });

    // 输出
    panel.createEl('h4', { text: '输出' });
    this.toggleRow('保存到库', s.saveToVault, async (v) => { s.saveToVault = v; await this.plugin.saveSettings(); });
    this.toggleRow('同时另存为文件', s.saveToFile, async (v) => { s.saveToFile = v; await this.plugin.saveSettings(); });
    this.toggleRow('复制到剪贴板', s.copyToClipboard, async (v) => { s.copyToClipboard = v; await this.plugin.saveSettings(); });
    this.row('倍率', (r) => {
      const sel = r.createEl('select');
      [['1', '1×'], ['2', '2×'], ['3', '3×']].forEach(([v, t]) => sel.createEl('option', { value: v, text: t }));
      sel.value = String(s.scale);
      sel.addEventListener('change', async () => { s.scale = Number(sel.value) || 2; await this.plugin.saveSettings(); });
    });
    panel.createEl('p', {
      cls: 'ce-tip',
      text: '提示：「另存为…」总是弹系统保存对话框，可选桌面等任意位置；手机端请用「保存」到库。',
    });
  }

  row(labelText, build) {
    const r = this.panel.createDiv({ cls: 'ce-row' });
    r.createEl('label', { text: labelText });
    build(r);
    return r;
  }

  toggleRow(labelText, value, onChange) {
    const r = this.panel.createDiv({ cls: 'ce-row' });
    r.createEl('label', { text: labelText });
    const c = r.createEl('input', { type: 'checkbox' });
    c.checked = !!value;
    c.addEventListener('change', () => onChange(c.checked));
    return r;
  }

  refreshSoon() {
    if (this._timer) clearTimeout(this._timer);
    this._timer = setTimeout(() => {
      this.renderPreview();
    }, 220);
  }

  /* ---------------- 渲染与测量 ---------------- */

  async renderMarkdownToBlocks(markdown) {
    const holder = document.createElement('div');
    holder.style.cssText = 'position:fixed;left:-20000px;top:0;width:620px;';
    document.body.appendChild(holder);
    try {
      if (typeof MarkdownRenderer.render === 'function') {
        await MarkdownRenderer.render(this.app, markdown, holder, this.ctx.sourcePath, this.plugin);
      } else if (typeof MarkdownRenderer.renderMarkdown === 'function') {
        await MarkdownRenderer.renderMarkdown(markdown, holder, this.ctx.sourcePath, this.plugin);
      } else {
        holder.innerHTML = `<p>${escapeHtml(markdown)}</p>`;
      }
      const kids = Array.from(holder.children);
      const keep = document.createElement('div');
      keep.style.cssText = 'position:fixed;left:-20000px;top:0;width:620px;';
      for (const k of kids) keep.appendChild(k);
      document.body.appendChild(keep);
      this._holders.push(keep);
      holder.remove();
      return kids;
    } catch (e) {
      holder.remove();
      throw e;
    }
  }

  shellOpts(heightOverride, bgStyle) {
    const size = getSize(this.sizeId);
    const s = this.plugin.settings;
    return {
      themeId: this.themeId,
      sizeId: this.sizeId,
      width: size.width,
      height: heightOverride === undefined ? size.height : heightOverride,
      title: this.ctx.docTitle,
      meta: this.metaText(),
      footerLeft: s.footerEnabled ? this.footerLeftText() : '',
      footerRight: s.footerEnabled && s.showMetaDate ? new Date().toLocaleDateString('zh-CN') : '',
      avatar: s.footerEnabled ? s.avatar : '',
      watermark: s.watermarkEnabled && s.watermarkText ? s.watermarkText : '',
      watermarkBand: s.watermarkBand,
      bgStyle: bgStyle === undefined ? backgroundStyle(this.bg) : bgStyle,
    };
  }

  ensureMeasurer() {
    const bgCss = backgroundStyle(this.bg);
    const key = `${this.themeId}|${this.sizeId}|${bgCss}`;
    if (this._m && this._mKey === key) return this._m;
    this.disposeMeasurer();
    const size = getSize(this.sizeId);
    const wrap = document.createElement('div');
    wrap.innerHTML = buildCardShellHtml(this.shellOpts(undefined, bgCss));
    const card = wrap.firstElementChild;
    card.style.position = 'fixed';
    card.style.left = '-20000px';
    card.style.top = '0';
    document.body.appendChild(card);
    const body = card.querySelector('.ce-body');
    this._m = { card, body, size };
    this._mKey = key;
    this._contentHeight = size.height ? body.clientHeight : 0;
    return this._m;
  }

  disposeMeasurer() {
    if (this._m && this._m.card) this._m.card.remove();
    this._m = null;
    this._mKey = '';
  }

  async measureBlocks(markdown) {
    const m = this.ensureMeasurer();
    const els = await this.renderMarkdownToBlocks(markdown);
    const out = [];
    let prev = m.body.scrollHeight;
    for (const el of els) {
      m.body.appendChild(el);
      const now = m.body.scrollHeight;
      out.push({ el, height: Math.max(0, now - prev) });
      prev = now;
    }
    for (const o of out) m.body.removeChild(o.el);
    return out;
  }

  async buildPages() {
    const mode = this.ctx.mode;
    const size = getSize(this.sizeId);
    this.ensureMeasurer();
    const contentHeight = size.height ? this._contentHeight : 0;

    if (mode === 'headings') {
      const parts = splitByHeadings(this.ctx.markdown, 2);
      if (parts.length > 1) {
        const result = [];
        for (const part of parts) {
          const md = [part.title ? `## ${part.title}` : '', part.markdown].filter(Boolean).join('\n\n');
          const blocks = await this.measureBlocks(md);
          for (const pg of paginate(blocks, { contentHeight })) {
            result.push({ blocks: pg.indices.map((i) => blocks[i]) });
          }
        }
        return result;
      }
    }
    const blocks = await this.measureBlocks(this.ctx.markdown);
    return paginate(blocks, { contentHeight }).map((pg) => ({
      blocks: pg.indices.map((i) => blocks[i]),
    }));
  }

  async renderPreview() {
    if (!this.stageEl) return;
    this.stageEl.empty();
    this.pageIndex = 0;
    this.styleEl.textContent = this.plugin.themeCssFor(this.themeId, this.customCss);
    this.disposeMeasurer();
    try {
      this.pages = await this.buildPages();
    } catch (e) {
      this.stageEl.createEl('p', { text: `预览失败：${e.message || e}` });
      return;
    }
    if (!this.pages.length) {
      this.stageEl.createEl('p', { text: '没有可导出的内容。' });
      return;
    }
    await this.paintPage(0);
  }

  async paintPage(index) {
    const stage = this.stageEl;
    stage.empty();
    const page = this.pages[index];
    if (!page) return;
    this.pageIndex = index;

    const size = getSize(this.sizeId);
    const wrap = document.createElement('div');
    wrap.innerHTML = buildCardShellHtml(this.shellOpts(0));
    const cardEl = wrap.firstElementChild;
    const bodyEl = cardEl.querySelector('.ce-body');
    for (const b of page.blocks) bodyEl.appendChild(b.el);

    // 背景图（预览与导出都要）
    if (this.bg.type === 'image' && this.bg.image) {
      const okBg = await applyBackgroundImage(cardEl, this.app, this.bg);
      if (!okBg) new Notice(`背景图没找到：${this.bg.image}`, 4000);
    }

    cardEl.style.position = 'fixed';
    cardEl.style.left = '-20000px';
    cardEl.style.top = '0';
    cardEl.style.minHeight = '0';
    document.body.appendChild(cardEl);
    const natural = cardEl.offsetHeight;
    const finalH = size.height ? Math.max(size.height, natural) : natural;
    cardEl.style.height = `${finalH}px`;
    const measuredH = cardEl.offsetHeight;
    document.body.removeChild(cardEl);
    cardEl.style.position = 'relative';
    cardEl.style.left = '0';
    cardEl.style.top = '0';

    const box = stage.createDiv({ cls: 'ce-preview-box' });
    const maxW = Math.min(520, stage.clientWidth || 520);
    const k = Math.min(1, maxW / size.width);
    const holder = box.createDiv({ cls: 'ce-preview-holder' });
    holder.style.width = `${size.width * k}px`;
    holder.style.height = `${measuredH * k}px`;
    const scaler = holder.createDiv({ cls: 'ce-preview-scale' });
    scaler.style.transform = `scale(${k})`;
    scaler.style.transformOrigin = 'top left';
    scaler.style.width = `${size.width}px`;
    scaler.appendChild(cardEl);
    cardEl.style.height = `${measuredH}px`;

    this.currentCard = cardEl;
    this.currentHeight = measuredH;

    this.pagerEl.empty();
    if (this.pages.length > 1) {
      const prev = this.pagerEl.createEl('button', { text: '‹' });
      prev.addEventListener('click', () => this.paintPage(Math.max(0, this.pageIndex - 1)));
      this.pagerEl.createEl('span', { text: `${this.pageIndex + 1} / ${this.pages.length}` });
      const next = this.pagerEl.createEl('button', { text: '›' });
      next.addEventListener('click', () => this.paintPage(Math.min(this.pages.length - 1, this.pageIndex + 1)));
    }
    const scale = this.plugin.settings.scale || 2;
    this.infoEl.setText(
      `${size.width}×${measuredH} · 输出 ${size.width * scale}×${measuredH * scale} · ${this.pages.length} 张`
    );
  }

  metaText() {
    const s = this.plugin.settings;
    const t = plainText(this.ctx.markdown);
    const chars = t.replace(/\s/g, '').length;
    const parts = buildMetaParts({
      mode: this.ctx.mode,
      showDate: s.showMetaDate,
      date: new Date().toLocaleDateString('zh-CN'),
      showWords: s.showMetaWords,
      words: chars,
      source: s.metaSource,
    });
    return parts.join(' · ') || `${chars} 字`;
  }

  footerLeftText() {
    const s = this.plugin.settings;
    const bits = [];
    if (s.footerAuthor) bits.push(s.footerAuthor);
    if (s.footerNote) bits.push(s.footerNote);
    return bits.join(' · ');
  }

  /* ---------------- 导出 ---------------- */

  async exportAll(mode) {
    if (this.busy || !this.pages.length) return;
    const s = this.plugin.settings;
    const total = this.pages.length;
    const limited = Math.min(total, Math.max(1, s.maxPages || 12));
    this.busy = true;
    for (const b of [this.saveBtn, this.saveAsBtn, this.copyBtn]) b.setAttribute('disabled', 'disabled');
    const notice = new Notice('正在生成图片…', 0);
    const madeVault = [];
    const madeFiles = [];
    try {
      for (let i = 0; i < limited; i++) {
        const blob = await this.renderPageBlob(i);
        const name = buildFileName(this.ctx.baseName, new Date(), i, limited);

        const wantVault = mode === 'auto' ? s.saveToVault : false;
        const wantFile = mode === 'file' ? true : mode === 'auto' ? s.saveToFile : false;
        const wantCopy = mode === 'copy' ? true : mode === 'auto' ? s.copyToClipboard && i === limited - 1 : false;

        if (wantVault) {
          const f = await this.plugin.saveBlobToVault(blob, this.ctx.sourcePath, name);
          madeVault.push(f.path);
        }
        if (wantFile) {
          const target = await this.plugin.saveBlobToFile(blob, name);
          if (target) madeFiles.push(target);
          else if (limited > 1) break; // 用户取消对话框：后面的不再问
        }
        if (wantCopy) await this.plugin.copyBlobToClipboard(blob);
      }
      notice.hide();
      const lines = [];
      if (madeVault.length) lines.push(`存入库 ${madeVault.length} 张`);
      if (madeFiles.length) lines.push(`另存文件 ${madeFiles.length} 张`);
      if (lines.length) new Notice(`${lines.join('；')}\n${(madeVault.length ? madeVault[0] : madeFiles[0])}`, 8000);
      else if (mode === 'copy') new Notice('已复制到剪贴板。');
      if (mode === 'auto' && !s.saveToVault && !s.saveToFile && !s.copyToClipboard) {
        new Notice('当前没有任何输出目标：请勾选「保存到库」「同时另存为文件」或「复制到剪贴板」。', 7000);
      }
      if (total > limited) new Notice(`内容较多，本次只导出前 ${limited} 张（可在设置里调大上限）。`, 6000);
    } catch (e) {
      notice.hide();
      new Notice(`导出失败：${e.message || e}`, 8000);
    } finally {
      this.busy = false;
      for (const b of [this.saveBtn, this.saveAsBtn, this.copyBtn]) b.removeAttribute('disabled');
    }
  }

  async renderPageBlob(index) {
    const keep = this.pageIndex;
    if (index !== keep) await this.paintPage(index);
    await new Promise((r) => requestAnimationFrame(() => r()));
    const cardEl = this.currentCard;
    const failed = await inlineImages(cardEl, this.app);
    if (failed) new Notice(`有 ${failed} 张图片没能内联，导出的图里会缺这几张。`, 5000);
    const blob = await cardToPngBlob(cardEl, {
      width: cardEl.offsetWidth,
      height: cardEl.offsetHeight,
      scale: this.plugin.settings.scale || 2,
    });
    if (index !== keep) await this.paintPage(keep);
    return blob;
  }

  onClose() {
    if (this._timer) clearTimeout(this._timer);
    if (this.styleEl) this.styleEl.remove();
    this.disposeMeasurer();
    for (const h of this._holders) h.remove();
    this._holders = [];
    this.contentEl.empty();
  }
}

/* ============================== 设置页 ============================== */

class CardExportSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    const s = this.plugin.settings;
    containerEl.empty();

    containerEl.createEl('h3', { text: '卡片导出' });

    new Setting(containerEl)
      .setName('默认样式')
      .setDesc('共 15 套，都能在导出窗口里临时切换。')
      .addDropdown((d) => {
        for (const t of THEMES) d.addOption(t.id, t.name);
        d.setValue(s.defaultTheme).onChange(async (v) => {
          s.defaultTheme = v;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName('默认尺寸')
      .setDesc('自适应长图随内容变高；固定尺寸装不下时自动切成多张，绝不裁掉内容。')
      .addDropdown((d) => {
        for (const z of SIZES) d.addOption(z.id, z.name);
        d.setValue(s.defaultSize).onChange(async (v) => {
          s.defaultSize = v;
          await this.plugin.saveSettings();
        });
      });

    containerEl.createEl('h3', { text: '输出' });

    new Setting(containerEl)
      .setName('保存到库')
      .setDesc('PNG 存进库里。')
      .addToggle((t) =>
        t.setValue(!!s.saveToVault).onChange(async (v) => {
          s.saveToVault = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName('同时另存为文件')
      .setDesc('导出时再弹一次系统保存对话框（可选桌面等任意位置）。')
      .addToggle((t) =>
        t.setValue(!!s.saveToFile).onChange(async (v) => {
          s.saveToFile = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName('导出目录（库内）')
      .setDesc('留空 = 与笔记同目录。填相对路径（如 附件/卡片）时目录会自动创建。')
      .addText((t) =>
        t.setPlaceholder('留空 = 与笔记同目录').setValue(s.outputFolder).onChange(async (v) => {
          s.outputFolder = v.trim();
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName('上次另存目录')
      .setDesc('「另存为」对话框的默认位置，成功保存后自动更新。')
      .addText((t) =>
        t.setPlaceholder('（还没有）').setValue(s.lastExportDir).onChange(async (v) => {
          s.lastExportDir = v.trim();
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName('输出倍率')
      .addDropdown((d) =>
        d
          .addOption('1', '1×')
          .addOption('2', '2×（推荐）')
          .addOption('3', '3×')
          .setValue(String(s.scale))
          .onChange(async (v) => {
            s.scale = Number(v) || 2;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('单次最多导出张数')
      .addText((t) =>
        t.setValue(String(s.maxPages)).onChange(async (v) => {
          const n = parseInt(v, 10);
          s.maxPages = Number.isFinite(n) ? Math.max(1, Math.min(60, n)) : 12;
          await this.plugin.saveSettings();
        })
      );

    containerEl.createEl('h3', { text: '元素' });

    new Setting(containerEl)
      .setName('头像')
      .setDesc('库内图片路径，会以圆形显示在页脚左侧。')
      .addText((t) =>
        t.setPlaceholder('如 1 Obsidian/附件/头像.png').setValue(s.avatar).onChange(async (v) => {
          s.avatar = v.trim();
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName('作者')
      .addText((t) =>
        t.setValue(s.footerAuthor).onChange(async (v) => {
          s.footerAuthor = v.trim();
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName('补充说明')
      .setDesc('接在作者名后面。')
      .addText((t) =>
        t.setValue(s.footerNote).onChange(async (v) => {
          s.footerNote = v.trim();
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName('来源')
      .setDesc('显示在标题下方的元信息里，例如公众号名或链接。')
      .addText((t) =>
        t.setValue(s.metaSource).onChange(async (v) => {
          s.metaSource = v.trim();
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName('元信息显示日期')
      .addToggle((t) =>
        t.setValue(!!s.showMetaDate).onChange(async (v) => {
          s.showMetaDate = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName('元信息显示字数')
      .addToggle((t) =>
        t.setValue(!!s.showMetaWords).onChange(async (v) => {
          s.showMetaWords = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName('显示页脚')
      .addToggle((t) =>
        t.setValue(!!s.footerEnabled).onChange(async (v) => {
          s.footerEnabled = v;
          await this.plugin.saveSettings();
        })
      );

    containerEl.createEl('h3', { text: '背景' });

    new Setting(containerEl)
      .setName('背景类型')
      .setDesc('跟随主题 = 用主题自带的底色；纯色 / 渐变 / 纹理 / 图片 会覆盖它。')
      .addDropdown((d) => {
        for (const t of BG_TYPES) d.addOption(t.id, t.name);
        d.setValue(s.bgType).onChange(async (v) => {
          s.bgType = v;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName('纯色 / 纹理底色')
      .addText((t) =>
        t.setPlaceholder('#FFFFFF').setValue(s.bgColor).onChange(async (v) => {
          s.bgColor = v.trim() || '#FFFFFF';
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName('渐变预设')
      .addDropdown((d) => {
        for (const g of GRADIENTS) d.addOption(g.id, g.name);
        d.setValue(s.bgGradient).onChange(async (v) => {
          s.bgGradient = v;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName('纹理预设')
      .addDropdown((d) => {
        for (const t of TEXTURES) d.addOption(t.id, t.name);
        d.setValue(s.bgTexture).onChange(async (v) => {
          s.bgTexture = v;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName('背景图片')
      .setDesc('库内图片路径；导出时会被内联进图片，不依赖外部文件。')
      .addText((t) =>
        t.setPlaceholder('如 1 Obsidian/附件/底图.jpg').setValue(s.bgImage).onChange(async (v) => {
          s.bgImage = v.trim();
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName('背景图填充')
      .addDropdown((d) =>
        d
          .addOption('cover', '铺满裁切')
          .addOption('contain', '完整显示')
          .addOption('repeat', '平铺')
          .setValue(s.bgImageFit)
          .onChange(async (v) => {
            s.bgImageFit = v;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('遮罩浓度（0-90）')
      .setDesc('在背景图/纹理上叠一层半透明色，压暗或提亮以保证文字可读。')
      .addText((t) =>
        t.setValue(String(s.bgVeil)).onChange(async (v) => {
          const n = parseInt(v, 10);
          s.bgVeil = Number.isFinite(n) ? Math.max(0, Math.min(90, n)) : 0;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName('遮罩颜色')
      .addText((t) =>
        t.setValue(s.bgVeilColor).onChange(async (v) => {
          s.bgVeilColor = v.trim() || '#FFFFFF';
          await this.plugin.saveSettings();
        })
      );

    containerEl.createEl('h3', { text: '水印' });

    new Setting(containerEl)
      .setName('水印文字')
      .setDesc('留空即不显示水印。')
      .addText((t) =>
        t.setValue(s.watermarkText).onChange(async (v) => {
          s.watermarkText = v.trim();
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName('水印铺满底部')
      .addToggle((t) =>
        t.setValue(!!s.watermarkBand).onChange(async (v) => {
          s.watermarkBand = v;
          await this.plugin.saveSettings();
        })
      );

    containerEl.createEl('h3', { text: '高级' });

    new Setting(containerEl)
      .setName('自定义 CSS 文件')
      .setDesc('填库内一份 .css 的路径，会在主题之后追加生效 —— 想微调样式不必改插件代码。')
      .addText((t) =>
        t.setPlaceholder('例如 1 Obsidian/CSS/卡片.css').setValue(s.customCssFile).onChange(async (v) => {
          s.customCssFile = v.trim();
          await this.plugin.saveSettings();
        })
      );

    containerEl.createEl('h3', { text: '关于数据' });
    containerEl.createEl('p', {
      cls: 'setting-item-description',
      text: '本插件只读取笔记内容并生成图片，从不修改任何笔记；导出的 PNG 放在你指定的位置，卸载插件也不影响笔记。',
    });
  }
}

/* ============================== 导出 ============================== */

module.exports = CardExportPlugin;
module.exports.__test = {
  SIZES,
  THEMES,
  GRADIENTS,
  TEXTURES,
  BG_TYPES,
  BASE_CSS,
  DEFAULT_SETTINGS,
  getTheme,
  getSize,
  getGradient,
  getTexture,
  themeCss,
  buildCardShellHtml,
  paginate,
  splitByHeadings,
  buildFileName,
  plainText,
  escapeHtml,
  normDir,
  hexToRgba,
  backgroundStyle,
  backgroundImageStyle,
  buildMetaParts,
};
