import { describe, expect, it } from 'vitest';
import { convertSimpleMath, mdToHtml } from './quizHtml';

describe('convertSimpleMath', () => {
  it('converts H$^+$ / OH$^-$ style ions', () => {
    expect(convertSimpleMath('H$^+$ och OH$^-$')).toBe('H⁺ och OH⁻');
  });

  it('converts log$_{10}$[H$^+$]', () => {
    expect(convertSimpleMath('log$_{10}$[H$^+$]')).toBe('log₁₀[H⁺]');
  });

  it('converts bare H^+ / OH^-', () => {
    expect(convertSimpleMath('H^+ och OH^-')).toBe('H⁺ och OH⁻');
  });
});

describe('mdToHtml', () => {
  it('passes through existing editor HTML', () => {
    const html = '<div dir="auto">Already <strong>rich</strong></div>';
    expect(mdToHtml(html)).toBe(html);
  });

  it('renders bold, paragraphs, and bullets', () => {
    const md = [
      '**Grundläggande Definition av pH:**',
      '',
      'pH mäter surhet.',
      '',
      '* **pH < 7:** Sur',
      '* **pH = 7:** Neutral',
      '- **pH > 7:** Basisk',
    ].join('\n');

    const html = mdToHtml(md);
    expect(html).toContain('<strong>Grundläggande Definition av pH:</strong>');
    expect(html).toContain('<div dir="auto">pH mäter surhet.</div>');
    expect(html).toContain('<ul dir="auto">');
    expect(html).toContain('<li dir="auto"><strong>pH &lt; 7:</strong> Sur</li>');
    expect(html).toContain('<li dir="auto"><strong>pH = 7:</strong> Neutral</li>');
    expect(html).toContain('<li dir="auto"><strong>pH &gt; 7:</strong> Basisk</li>');
    expect(html).not.toContain('**');
    expect(html).not.toMatch(/(^|>)\*\s/);
  });

  it('converts chemistry math while structuring text', () => {
    const md = 'pH = -log$_{10}$[H$^+$]\n\nHögre H$^+$ ger lägre pH.';
    const html = mdToHtml(md);
    expect(html).toContain('log₁₀[H⁺]');
    expect(html).toContain('H⁺');
    expect(html).not.toContain('$');
    expect(html).toContain('<div dir="auto"><br></div>');
  });

  it('renders numbered lists', () => {
    const html = mdToHtml('1. Först\n2. Sedan');
    expect(html).toContain('<ol dir="auto">');
    expect(html).toContain('<li dir="auto">Först</li>');
    expect(html).toContain('<li dir="auto">Sedan</li>');
  });

  it('returns empty string for null/undefined (shell quiz items)', () => {
    expect(mdToHtml(undefined)).toBe('');
    expect(mdToHtml(null)).toBe('');
  });

  it('does not show literal &nbsp; for plain-text entities', () => {
    const html = mdToHtml('P.g.a. det höga motståndet i benmärgen.&nbsp;');
    expect(html).not.toContain('&amp;nbsp;');
    expect(html).not.toContain('&nbsp;');
    expect(html).toContain('benmärgen.');
    expect(html).toBe('<div dir="auto">P.g.a. det höga motståndet i benmärgen.</div>');
  });

  it('fixes double-encoded entities inside existing HTML', () => {
    const html = mdToHtml('<div dir="auto">benmärgen.&amp;nbsp;</div>');
    expect(html).toBe('<div dir="auto">benmärgen.&nbsp;</div>');
  });
});
