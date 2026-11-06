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

it('tracks the visible bottom edge including viewport scrolling without resizing during pinch zoom', () => {
  const viewport = Object.assign(new EventTarget(), { height: 760, offsetTop: 24, scale: 1 });
  vi.stubGlobal('visualViewport', viewport);
  vi.stubGlobal('innerHeight', 844);
  installVisualViewportSizing();
  expect(document.documentElement.style.getPropertyValue('--app-visible-bottom')).toBe('784px');
  viewport.offsetTop = 0;
  viewport.height = 740;
  viewport.dispatchEvent(new Event('scroll'));
  expect(document.documentElement.style.getPropertyValue('--app-visible-bottom')).toBe('740px');
  vi.stubGlobal('innerHeight', 720);
  window.dispatchEvent(new Event('resize'));
  expect(document.documentElement.style.getPropertyValue('--app-visible-bottom')).toBe('720px');
  viewport.scale = 2;
  viewport.height = 370;
  viewport.dispatchEvent(new Event('resize'));
  expect(document.documentElement.style.getPropertyValue('--app-visible-bottom')).toBe('720px');
  vi.unstubAllGlobals();
});
