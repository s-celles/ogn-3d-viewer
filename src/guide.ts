// ============ full-screen feature guide (markdown → HTML) ============
// The user-facing guide is authored as markdown (docs/features.<lang>.md, one per
// UI language), bundled as text by Bun, and rendered to HTML at runtime with
// `marked`. It opens in a full-screen overlay from the header's guide button.
import { marked } from 'marked';
import { S } from './state';
import type { Lang } from './types';
import { guideBtn, guideEl, guideBody, guideClose } from './dom';

import guideEN from '../docs/features.en.md' with { type: 'text' };
import guideFR from '../docs/features.fr.md' with { type: 'text' };
import guideDE from '../docs/features.de.md' with { type: 'text' };

// es/it have no dedicated guide yet — they fall back to English (see render()).
const SRC: Partial<Record<Lang, string>> = { en: guideEN, fr: guideFR, de: guideDE };

// Language the overlay currently shows, so we only re-parse when it changes.
let renderedLang: Lang | null = null;

function render(): void {
  guideBody.innerHTML = marked.parse(SRC[S.lang] || SRC.en || '', { async: false }) as string;
  // External links open in a new tab (the content is our own, so this is safe).
  guideBody.querySelectorAll('a[href^="http"]').forEach(a => {
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener');
  });
  renderedLang = S.lang;
}

const isOpen = (): boolean => guideEl.classList.contains('open');

export function openGuide(): void {
  if (renderedLang !== S.lang) render();
  guideEl.classList.add('open');
  guideBtn.classList.add('on');
  guideBody.scrollTop = 0;
}
export function closeGuide(): void {
  guideEl.classList.remove('open');
  guideBtn.classList.remove('on');
}
/** Re-render if the UI language changed while the guide is open (from applyI18n). */
export function syncGuide(): void {
  if (isOpen() && renderedLang !== S.lang) render();
}

guideBtn.onclick = () => (isOpen() ? closeGuide() : openGuide());
guideClose.onclick = closeGuide;
guideEl.onclick = e => { if (e.target === guideEl) closeGuide(); };  // click the backdrop to close
document.addEventListener('keydown', e => { if (e.key === 'Escape' && isOpen()) closeGuide(); });
