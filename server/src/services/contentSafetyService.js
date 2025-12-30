import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ALLOWED_SCENES = new Set(['chat', 'post', 'experience']);
const URL_REGEX = /(https?:\/\/|www\.)|(\b(bit\.ly|t\.co|tinyurl\.com|goo\.gl|ow\.ly)\b)/i;
const CN_PHONE_REGEX = /1[3-9]\d{9}/;
const INTL_PHONE_REGEX = /\+?\d[\d\s-]{7,}\d/;
const WECHAT_KEYWORDS = ['微信', 'weixin', 'wechat', 'wx', '加v', '加微', '薇信', '威信'];
const WECHAT_ACCOUNT_REGEX = /[a-zA-Z][a-zA-Z0-9_-]{5,19}/g;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SAFETY_DIR = path.resolve(__dirname, '..', 'safety');

let cachedWords = null;

function loadWords(fileName) {
  const filePath = path.join(SAFETY_DIR, fileName);
  const raw = fs.readFileSync(filePath, 'utf8');
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
}

function getWordList(locale) {
  if (!cachedWords) {
    cachedWords = {
      zh: loadWords('sensitive_words_zh.txt'),
      en: loadWords('sensitive_words_en.txt'),
    };
  }
  const isZh = (locale || '').toLowerCase().startsWith('zh');
  return isZh ? cachedWords.zh : cachedWords.en;
}

function hasWeChat(text) {
  const lower = text.toLowerCase();
  const keywordHit = WECHAT_KEYWORDS.some((kw) => lower.includes(kw));
  if (keywordHit) return true;
  const matches = lower.matchAll(WECHAT_ACCOUNT_REGEX);
  for (const match of matches) {
    const start = Math.max(0, match.index - 10);
    const end = Math.min(lower.length, match.index + match[0].length + 10);
    const windowText = lower.slice(start, end);
    if (WECHAT_KEYWORDS.some((kw) => windowText.includes(kw))) return true;
  }
  return false;
}

export function checkText({ scene, text, locale }) {
  if (!ALLOWED_SCENES.has(scene)) {
    throw new Error('Invalid scene');
  }
  const content = (text || '').toString();
  const reasons = [];
  if (!content.trim()) {
    return { ok: true, reasons: [] };
  }

  const words = getWordList(locale);
  const lookup = locale && locale.toLowerCase().startsWith('zh')
    ? content
    : content.toLowerCase();
  for (const w of words) {
    if (!w) continue;
    const needle = locale && locale.toLowerCase().startsWith('zh') ? w : w.toLowerCase();
    if (needle && lookup.includes(needle)) {
      reasons.push('SENSITIVE_WORD');
      break;
    }
  }

  if (URL_REGEX.test(content)) {
    reasons.push('URL');
  }
  if (CN_PHONE_REGEX.test(content) || INTL_PHONE_REGEX.test(content)) {
    reasons.push('PHONE');
  }
  if (hasWeChat(content)) {
    reasons.push('WECHAT');
  }

  return { ok: reasons.length === 0, reasons };
}
