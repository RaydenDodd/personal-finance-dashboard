/** Match the visible iPhone viewport while its keyboard is open, without restricting pinch zoom. */
export const installVisualViewportSizing = (): void => {
  const displayMode = window.matchMedia?.('(display-mode: standalone)');
  const updateDisplayMode = () => {
    document.documentElement.toggleAttribute(
      'data-finance-standalone',
      Boolean(displayMode?.matches || (navigator as Navigator & { standalone?: boolean }).standalone),
    );
  };
  displayMode?.addEventListener('change', updateDisplayMode);
  updateDisplayMode();
  const viewport = window.visualViewport;
  if (!viewport) return;
  const resize = () => {
    if (viewport.scale !== 1) return;
    document.documentElement.style.setProperty('--app-visible-height', `${Math.round(viewport.height)}px`);
    const focused = document.activeElement;
    const editing =
      focused instanceof HTMLInputElement ||
      focused instanceof HTMLTextAreaElement ||
      (focused instanceof HTMLElement && focused.isContentEditable);
    document.documentElement.toggleAttribute(
      'data-finance-keyboard',
      editing && window.innerHeight - viewport.height > 140,
    );
  };
  viewport.addEventListener('resize', resize);
  document.addEventListener('focusin', resize);
  document.addEventListener('focusout', () => requestAnimationFrame(resize));
  resize();
};
