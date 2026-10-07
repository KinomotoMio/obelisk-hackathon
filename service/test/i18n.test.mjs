import { test } from 'node:test';
import assert from 'node:assert/strict';
import { translate, initialLanguage, CONTENT_SELECTOR } from '../public/site/i18n.js';

test('UI localization preserves variables and unrecognized content', () => {
  assert.equal(translate('Skill 市场'), 'Skill Market');
  assert.equal(translate('来自 3 个钱包 · 最近上报 2 小时前'), 'From 3 wallets · Last reported 2 hours ago');
  assert.equal(translate('结算 #12 · 付款 0.5 BOT'), 'Settlement #12 · Paid 0.5 BOT');
  assert.equal(translate('我的私密项目经历：调用失败后修复了问题'), '我的私密项目经历：调用失败后修复了问题');
  assert.equal(translate('Skill 市场', 'zh'), 'Skill 市场');
  assert.match(CONTENT_SELECTOR, /\[translate="no"\]/);
});
test('language choice prioritizes explicit URL, then preference, then browser', () => {
  assert.equal(initialLanguage('?lang=en', 'zh', 'zh-CN'), 'en');
  assert.equal(initialLanguage('', 'zh', 'en-US'), 'zh');
  assert.equal(initialLanguage('', null, 'zh-TW'), 'zh');
  assert.equal(initialLanguage('?lang=bogus', null, 'en-US'), 'en');
});
