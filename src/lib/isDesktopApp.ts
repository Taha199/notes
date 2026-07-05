declare global {
  interface Window {
    tahaNoteDesktop?: { isDesktop: boolean; platform: string };
  }
}

export function isDesktopApp(): boolean {
  if (typeof window === 'undefined') return false;
  return window.tahaNoteDesktop?.isDesktop === true || navigator.userAgent.includes('Electron');
}
