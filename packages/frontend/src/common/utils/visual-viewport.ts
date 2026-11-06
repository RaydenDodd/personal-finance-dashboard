/** Match the visible iPhone viewport while its keyboard is open, without restricting pinch zoom. */
export const installVisualViewportSizing = (): void => {
  const viewport = window.visualViewport;
  if (!viewport) return;
  const resize = () => {
    if (viewport.scale !== 1) return;
    document.documentElement.style.setProperty('--app-visible-height', `${Math.round(viewport.height)}px`);
  };
  viewport.addEventListener('resize', resize);
  resize();
};
