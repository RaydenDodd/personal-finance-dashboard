import { expect, it, vi } from 'vitest';

import { installVisualViewportSizing } from './visual-viewport';

it('recognizes installed display mode even without the visual viewport API', () => {
  vi.stubGlobal('visualViewport', undefined);
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn() }));
  installVisualViewportSizing();
  expect(document.documentElement.hasAttribute('data-finance-standalone')).toBe(true);
  document.documentElement.removeAttribute('data-finance-standalone');
  vi.unstubAllGlobals();
});

it('recognizes the iPhone standalone flag when the display mode query is unavailable', () => {
  vi.stubGlobal('visualViewport', undefined);
  vi.stubGlobal('matchMedia', undefined);
  vi.stubGlobal('navigator', { standalone: true });
  installVisualViewportSizing();
  expect(document.documentElement.hasAttribute('data-finance-standalone')).toBe(true);
  document.documentElement.removeAttribute('data-finance-standalone');
  vi.unstubAllGlobals();
});

it('distinguishes browser chrome from the keyboard and preserves pinch zoom', () => {
  const viewport = Object.assign(new EventTarget(), { height: 760, scale: 1 });
  vi.stubGlobal('visualViewport', viewport);
  vi.stubGlobal('innerHeight', 844);
  const input = document.createElement('input');
  document.body.append(input);
  installVisualViewportSizing();
  input.focus();
  expect(document.documentElement.hasAttribute('data-finance-keyboard')).toBe(false);
  viewport.height = 500;
  viewport.dispatchEvent(new Event('resize'));
  expect(document.documentElement.hasAttribute('data-finance-keyboard')).toBe(true);
  input.blur();
  viewport.dispatchEvent(new Event('resize'));
  expect(document.documentElement.hasAttribute('data-finance-keyboard')).toBe(false);
  viewport.scale = 2;
  viewport.height = 300;
  viewport.dispatchEvent(new Event('resize'));
  expect(document.documentElement.style.getPropertyValue('--app-visible-height')).toBe('500px');
  input.remove();
  vi.unstubAllGlobals();
});
