import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BROWSER_SHELL_METRICS,
  browserAddressLabel,
} from '../studio/src/browser-shell.ts';

test('浏览器套壳使用圆润地址栏并保留足够内容空间', () => {
  assert.equal(BROWSER_SHELL_METRICS.height, 50);
  assert.equal(
    BROWSER_SHELL_METRICS.addressRadius,
    BROWSER_SHELL_METRICS.addressHeight / 2,
  );
  assert(BROWSER_SHELL_METRICS.addressHeight < BROWSER_SHELL_METRICS.height);
});

test('地址栏隐藏协议和默认根路径', () => {
  assert.equal(browserAddressLabel('https://www.example.com/'), 'example.com');
  assert.equal(
    browserAddressLabel('https://example.com/product/demo'),
    'example.com/product/demo',
  );
});
