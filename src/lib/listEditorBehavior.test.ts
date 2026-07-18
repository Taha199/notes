import { describe, expect, it, beforeEach } from 'vitest';
import {
  BULLET_PREFIX_RE,
  collectListItemsBetween,
  convertEmptyListItemToParagraph,
  convertListItemToParagraph,
  clipboardToNativeListHtml,
  convertPseudoBulletBlocksToNativeLists,
  convertSymbolPrefixedRunsToLists,
  isCaretInBulletPrefixZone,
  wrapLooseInlineChildren,
  createEmptyParagraph,
  deleteSelectionRangeContents,
  insertParagraphAboveList,
  isCaretAtStartOfLi,
  isLiEffectivelyEmpty,
  isLiEmpty,
  mergeAdjacentLists,
  normalizePseudoListsInHtmlString,
  plainTextToListHtml,
  removeEmptyListItemSimple,
  removeListItemsInRangeDom,
  selectionSpansEntireListItems,
  shouldRemoveOrphanEmptyLists,
  stripListPasteIndent,
} from './listEditorBehavior';

function editorHtml(html: string): HTMLDivElement {
  const ed = document.createElement('div');
  ed.contentEditable = 'true';
  ed.innerHTML = html;
  document.body.appendChild(ed);
  return ed;
}

function caretIn(node: Node, offset: number): Range {
  const range = document.createRange();
  range.setStart(node, offset);
  range.collapse(true);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
  return range;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('listEditorBehavior', () => {
  it('detects empty list items', () => {
    const ed = editorHtml('<ul><li><br></li><li>Hej</li></ul>');
    const items = ed.querySelectorAll('li');
    expect(isLiEmpty(items[0] as HTMLLIElement)).toBe(true);
    expect(isLiEffectivelyEmpty(items[0] as HTMLLIElement)).toBe(true);
    expect(isLiEmpty(items[1] as HTMLLIElement)).toBe(false);
    ed.remove();
  });

  it('Shift+Enter target: caret at start of first li', () => {
    const ed = editorHtml('<ul><li>Mukosa</li><li>Sub</li></ul>');
    const first = ed.querySelector('li') as HTMLLIElement;
    const text = first.firstChild as Text;
    const range = caretIn(text, 0);
    expect(isCaretAtStartOfLi(first, range)).toBe(true);
    ed.remove();
  });

  it('insertParagraphAboveList adds margin paragraph above entire list', () => {
    const ed = editorHtml('<ul><li>Mukosa</li><li>Submukosa</li></ul>');
    const ul = ed.querySelector('ul') as HTMLUListElement;
    const para = insertParagraphAboveList(ul);
    expect(ed.children[0]).toBe(para);
    expect(ed.children[1]).toBe(ul);
    expect(para.tagName).toBe('DIV');
    ed.remove();
  });

  it('convertEmptyListItemToParagraph removes bullet but keeps empty line', () => {
    const ed = editorHtml('<ul><li>A</li><li><br></li><li>C</li></ul>');
    const empty = ed.querySelectorAll('li')[1] as HTMLLIElement;
    const div = convertEmptyListItemToParagraph(empty, () => {});
    expect(div).toBeTruthy();
    expect(ed.querySelectorAll('ul').length).toBe(2);
    expect(ed.querySelectorAll('div').length).toBe(1);
    expect(div?.tagName).toBe('DIV');
    ed.remove();
  });

  it('convertListItemToParagraph keeps text and leaves sibling bullets', () => {
    const ed = editorHtml('<ul><li>1</li><li>2</li><li>3</li><li>4</li></ul><div>Bye</div>');
    const items = [...ed.querySelectorAll('li')] as HTMLLIElement[];
    const div = convertListItemToParagraph(items[3], () => {});
    expect(div?.textContent).toBe('4');
    expect(ed.querySelectorAll('ul').length).toBe(1);
    expect(ed.querySelectorAll('li').length).toBe(3);
    expect(ed.textContent).toContain('Bye');
    expect(div?.nextElementSibling?.textContent).toContain('Bye');
    ed.remove();
  });

  it('second backspace strips paragraph indent', () => {
    const block = createEmptyParagraph();
    block.style.marginLeft = '40px';
    block.style.paddingLeft = '20px';
    expect(stripListPasteIndent(block, true)).toBe(true);
    expect(block.style.marginLeft).toBe('');
    expect(block.style.paddingLeft).toBe('');
  });

  it('collectListItemsBetween returns contiguous items', () => {
    const ed = editorHtml('<ul><li>1</li><li>2</li><li>3</li></ul>');
    const items = [...ed.querySelectorAll('li')] as HTMLLIElement[];
    expect(collectListItemsBetween(items[0], items[2]).length).toBe(3);
    expect(collectListItemsBetween(items[0], items[1]).length).toBe(2);
    ed.remove();
  });

  it('selectionSpansEntireListItems detects full multi-item selection', () => {
    const ed = editorHtml('<ul><li>1</li><li>2</li><li>3</li></ul>');
    const items = [...ed.querySelectorAll('li')] as HTMLLIElement[];
    const range = document.createRange();
    range.setStart(items[0], 0);
    range.setEnd(items[2], items[2].childNodes.length);
    expect(selectionSpansEntireListItems(items[0], items[2], range)).toBe(true);
    ed.remove();
  });

  it('removeListItemsInRangeDom deletes selected items', () => {
    const ed = editorHtml('<ul><li>1</li><li>2</li><li>3</li></ul>');
    const items = [...ed.querySelectorAll('li')] as HTMLLIElement[];
    const caretTarget = removeListItemsInRangeDom(items[0], items[1], () => {});
    expect(ed.querySelectorAll('li').length).toBe(1);
    expect(ed.textContent).toContain('3');
    expect(caretTarget?.textContent).toContain('3');
    ed.remove();
  });

  it('mergeAdjacentLists merges same-type siblings', () => {
    const ed = editorHtml('<ul><li>A</li></ul><ul><li>B</li></ul>');
    mergeAdjacentLists(ed);
    expect(ed.querySelectorAll('ul').length).toBe(1);
    expect(ed.querySelectorAll('li').length).toBe(2);
    ed.remove();
  });

  it('removeEmptyListItemSimple drops trailing empty item only', () => {
    const ed = editorHtml('<ul><li><br></li><li><br></li><li><br></li></ul>');
    const items = [...ed.querySelectorAll('li')] as HTMLLIElement[];
    const caretTarget = removeEmptyListItemSimple(items[2], () => {});
    expect(ed.querySelectorAll('li').length).toBe(2);
    expect(caretTarget).toBe(items[1]);
    ed.remove();
  });

  it('removeEmptyListItemSimple on middle empty keeps unified list and targets previous li', () => {
    const ed = editorHtml('<ul><li>Content</li><li><br></li><li><br></li></ul>');
    const items = [...ed.querySelectorAll('li')] as HTMLLIElement[];
    const caretTarget = removeEmptyListItemSimple(items[1], () => {});
    mergeAdjacentLists(ed);
    expect(ed.querySelectorAll('ul').length).toBe(1);
    expect(ed.querySelectorAll('div').length).toBe(0);
    expect(ed.querySelectorAll('li').length).toBe(2);
    expect(caretTarget).toBe(items[0]);
    expect(caretTarget?.textContent).toContain('Content');
    ed.remove();
  });

  it('removeEmptyListItemSimple on trailing empty after content targets content li', () => {
    const ed = editorHtml('<ul><li>Content</li><li><br></li></ul>');
    const items = [...ed.querySelectorAll('li')] as HTMLLIElement[];
    const caretTarget = removeEmptyListItemSimple(items[1], () => {});
    mergeAdjacentLists(ed);
    expect(ed.querySelectorAll('ul').length).toBe(1);
    expect(ed.querySelectorAll('div').length).toBe(0);
    expect(ed.querySelectorAll('li').length).toBe(1);
    expect(caretTarget).toBe(items[0]);
    expect(caretTarget?.textContent).toContain('Content');
    ed.remove();
  });

  it('BULLET_PREFIX_RE matches pseudo bullets', () => {
    expect('• test'.match(BULLET_PREFIX_RE)?.[0]).toBe('• ');
    expect('1. test'.match(BULLET_PREFIX_RE)?.[0]).toBe('1. ');
  });

  it('shouldRemoveOrphanEmptyLists keeps multi-item lists when all items are empty', () => {
    expect(shouldRemoveOrphanEmptyLists(6, false)).toBe(false);
    expect(shouldRemoveOrphanEmptyLists(1, false)).toBe(true);
    expect(shouldRemoveOrphanEmptyLists(1, true)).toBe(false);
  });

  it('deleteSelectionRangeContents deletes multi-paragraph selection and keeps list above', () => {
    const ed = editorHtml('<div>Hej</div><ul><li>1</li></ul><div>2</div><div>3</div>');
    const two = ed.querySelectorAll('div')[1] as HTMLElement;
    const three = ed.querySelectorAll('div')[2] as HTMLElement;
    const range = document.createRange();
    range.setStart(two, 0);
    range.setEnd(three, three.childNodes.length);
    deleteSelectionRangeContents(ed, range);
    expect(ed.textContent).toContain('Hej');
    expect(ed.textContent).toContain('1');
    expect(ed.textContent).not.toContain('2');
    expect(ed.textContent).not.toContain('3');
    expect(ed.querySelectorAll('li').length).toBe(1);
    ed.remove();
  });

  it('deleteSelectionRangeContents works for backward selection of paragraphs', () => {
    const ed = editorHtml('<div>Hej</div><div>2</div><div>3</div>');
    const two = ed.children[1] as HTMLElement;
    const three = ed.children[2] as HTMLElement;
    const range = document.createRange();
    // Normalized range is always start→end; simulate selecting both lines.
    range.setStartBefore(two);
    range.setEndAfter(three);
    deleteSelectionRangeContents(ed, range);
    expect(ed.textContent?.replace(/\u200B/g, '')).toBe('Hej');
    expect(ed.querySelectorAll('div').length).toBe(1);
    ed.remove();
  });

  it('removeListItemsInRangeDom deletes complete selected list items only', () => {
    const ed = editorHtml('<ul><li>1</li><li>2</li><li>3</li><li>4</li></ul>');
    const items = [...ed.querySelectorAll('li')] as HTMLLIElement[];
    removeListItemsInRangeDom(items[1], items[2], () => {});
    expect([...ed.querySelectorAll('li')].map((li) => li.textContent)).toEqual(['1', '4']);
    ed.remove();
  });

  it('convertPseudoBulletBlocksToNativeLists turns ChatGPT • lines into ul/li', () => {
    const ed = editorHtml(
      '<div><b>• Mukosa</b> – barriär</div><div><b>• Submukosa</b> – kärl</div><div><b>• Serosa</b> – ytterst</div>',
    );
    expect(convertPseudoBulletBlocksToNativeLists(ed)).toBe(true);
    expect(ed.querySelectorAll('ul').length).toBe(1);
    expect(ed.querySelectorAll('li').length).toBe(3);
    expect(ed.textContent).toContain('Mukosa');
    expect(ed.textContent).not.toMatch(/•/);
    expect(ed.querySelector('li b')?.textContent).toContain('Mukosa');
    ed.remove();
  });

  it('convertPseudoBulletBlocksToNativeLists splits one block with br-separated bullets', () => {
    const ed = editorHtml(
      '<div><b>• Mukosa</b> – a<br><b>• Submukosa</b> – b<br><b>• Serosa</b> – c</div>',
    );
    expect(convertPseudoBulletBlocksToNativeLists(ed)).toBe(true);
    expect(ed.querySelectorAll('ul').length).toBe(1);
    expect(ed.querySelectorAll('li').length).toBe(3);
    expect([...ed.querySelectorAll('li')].map((li) => li.textContent?.includes('Mukosa') || li.textContent?.includes('Submukosa') || li.textContent?.includes('Serosa'))).toEqual([true, true, true]);
    expect(ed.textContent).not.toMatch(/•/);
    ed.remove();
  });

  it('convertPseudoBulletBlocksToNativeLists explodes bullets trapped inside one li', () => {
    const ed = editorHtml(
      '<ul><li><b>Mukosa</b> – a<br>• <b>Submukosa</b> – b<br>• <b>Serosa</b> – c</li></ul>',
    );
    expect(convertPseudoBulletBlocksToNativeLists(ed)).toBe(true);
    expect(ed.querySelectorAll('li').length).toBe(3);
    expect(ed.textContent).not.toMatch(/•/);
    ed.remove();
  });

  it('convertPseudoBulletBlocksToNativeLists unwraps p inside li like manual lists', () => {
    const ed = editorHtml(
      '<ul><li><p><strong>Mukosa</strong> – a</p></li><li><p><strong>Serosa</strong> – b</p></li></ul>',
    );
    convertPseudoBulletBlocksToNativeLists(ed);
    expect(ed.querySelector('li > p')).toBeNull();
    expect(ed.querySelector('li strong')?.textContent).toBe('Mukosa');
    ed.remove();
  });

  it('convertPseudoBulletBlocksToNativeLists promotes nested pasted paragraphs', () => {
    const ed = editorHtml(
      '<div><p>• One</p><p>• Two</p></div>',
    );
    expect(convertPseudoBulletBlocksToNativeLists(ed)).toBe(true);
    expect(ed.querySelectorAll('li').length).toBe(2);
    expect(ed.querySelector('li')?.textContent?.trim()).toBe('One');
    ed.remove();
  });

  it('plainTextToListHtml builds a ul from bullet lines', () => {
    const html = plainTextToListHtml('• Alpha\n• Beta\n• Gamma');
    expect(html).toContain('<ul');
    expect(html).toContain('<li dir="auto">Alpha</li>');
    expect(html).toContain('Gamma');
  });

  it('plainTextToListHtml rejects mixed non-list text', () => {
    expect(plainTextToListHtml('• Alpha\nplain line')).toBeNull();
    expect(BULLET_PREFIX_RE.test('• Mukosa')).toBe(true);
  });

  it('clipboardToNativeListHtml uses plain bullets when HTML has no markers but keeps bold from HTML', () => {
    const html = '<p><strong>Mukosa</strong> – a</p><p><strong>Submukosa</strong> – b</p><p><strong>Serosa</strong> – c</p>';
    const plain = '• Mukosa – a\n• Submukosa – b\n• Serosa – c';
    const out = clipboardToNativeListHtml(html, plain);
    expect(out).toBeTruthy();
    expect(out!).toContain('<ul');
    expect(out!).toContain('<li dir="auto">');
    expect((out!.match(/<li\b/g) || []).length).toBe(3);
    expect(out!).toContain('<strong>Mukosa</strong>');
    expect(out!).not.toMatch(/•/);
  });

  it('clipboardToNativeListHtml rebuilds clean lists from ChatGPT ul HTML', () => {
    const html = '<!--StartFragment--><ul><li><p><b>• Mukosa</b> – a</p></li><li><p><b>• Serosa</b> – b</p></li></ul><!--EndFragment-->';
    const out = clipboardToNativeListHtml(html, '• Mukosa – a\n• Serosa – b');
    expect(out).toBeTruthy();
    expect(out!).toContain('<ul dir="auto">');
    expect((out!.match(/<li\b/g) || []).length).toBe(2);
    expect(out!).not.toMatch(/<p>/);
    expect(out!).not.toMatch(/•/);
  });

  it('clipboardToNativeListHtml falls back to plain when HTML is empty', () => {
    const out = clipboardToNativeListHtml('', '• One\n• Two');
    expect(out).toBe('<ul dir="auto"><li dir="auto">One</li><li dir="auto">Two</li></ul>');
  });

  it('convertPseudoBulletBlocksToNativeLists converts a single • line', () => {
    const ed = editorHtml('<div>• <b>Mukosa</b> – barriär</div>');
    expect(convertPseudoBulletBlocksToNativeLists(ed)).toBe(true);
    expect(ed.querySelectorAll('li').length).toBe(1);
    expect(ed.textContent).not.toMatch(/•/);
    expect(ed.querySelector('li b')?.textContent).toContain('Mukosa');
    ed.remove();
  });

  it('wrapLooseInlineChildren wraps a bare bullet text node at root', () => {
    const ed = editorHtml('\u2022 Mukosa');
    expect(wrapLooseInlineChildren(ed)).toBe(true);
    expect(ed.querySelector('div')?.textContent).toContain('Mukosa');
    ed.remove();
  });

  it('convertPseudoBulletBlocksToNativeLists converts a bare • node at editor root', () => {
    const ed = editorHtml('\u2022 <b>Mukosa</b> \u2013 barri\u00e4r');
    expect(convertPseudoBulletBlocksToNativeLists(ed)).toBe(true);
    expect(ed.querySelectorAll('li').length).toBe(1);
    expect(ed.textContent).not.toMatch(/\u2022/);
    expect(ed.querySelector('li b')?.textContent).toBe('Mukosa');
    ed.remove();
  });

  it('convertPseudoBulletBlocksToNativeLists clears a lone empty • at root', () => {
    const ed = editorHtml('\u2022');
    expect(convertPseudoBulletBlocksToNativeLists(ed)).toBe(true);
    expect(ed.textContent?.replace(/[\u200B\s]/g, '')).toBe('');
    ed.remove();
  });

  it('convertSymbolPrefixedRunsToLists converts an exotic bullet glyph run', () => {
    // U+2B24 (⬤) is NOT in the known bullet list — must still convert.
    const ed = editorHtml('<div>\u2B24 Mukosa</div><div>\u2B24 Submukosa</div><div>\u2B24 Serosa</div>');
    expect(convertSymbolPrefixedRunsToLists(ed)).toBe(true);
    expect(ed.querySelectorAll('li').length).toBe(3);
    expect(ed.textContent).not.toMatch(/\u2B24/);
    ed.remove();
  });

  it('convertSymbolPrefixedRunsToLists leaves single symbol line and prose alone', () => {
    const ed = editorHtml('<div>\u2B24 Only one</div><div>Vanlig text</div>');
    expect(convertSymbolPrefixedRunsToLists(ed)).toBe(false);
    expect(ed.querySelectorAll('li').length).toBe(0);
    ed.remove();
  });

  it('convertSymbolPrefixedRunsToLists does not touch emoji-led lines', () => {
    const ed = editorHtml('<div>\uD83D\uDE00 Glad</div><div>\uD83D\uDE00 Ledsen</div>');
    expect(convertSymbolPrefixedRunsToLists(ed)).toBe(false);
    expect(ed.querySelectorAll('li').length).toBe(0);
    expect(ed.textContent).toContain('\uD83D\uDE00');
    ed.remove();
  });

  it('convertSymbolPrefixedRunsToLists ignores quote-led prose lines', () => {
    const ed = editorHtml('<div>" Ett citat</div><div>" Ett till</div>');
    expect(convertSymbolPrefixedRunsToLists(ed)).toBe(false);
    ed.remove();
  });

  it('convertPseudoBulletBlocksToNativeLists handles exotic glyph via fallback', () => {
    const ed = editorHtml('<div>\u25B8 <b>A</b> \u2013 x</div><div>\u25B8 <b>B</b> \u2013 y</div>');
    expect(convertPseudoBulletBlocksToNativeLists(ed)).toBe(true);
    expect(ed.querySelectorAll('ul').length).toBe(1);
    expect(ed.querySelectorAll('li').length).toBe(2);
    expect(ed.textContent).not.toMatch(/\u25B8/);
    ed.remove();
  });

  it('normalizePseudoListsInHtmlString converts pasted • blocks in a string', () => {
    const out = normalizePseudoListsInHtmlString(
      '<div>\u2022 <b>Mukosa</b> \u2013 a</div><div>\u2022 <b>Serosa</b> \u2013 b</div>',
    );
    expect(out).toContain('<ul');
    expect((out.match(/<li\b/g) || []).length).toBe(2);
    expect(out).not.toMatch(/\u2022/);
  });

  it('normalizePseudoListsInHtmlString leaves normal prose untouched', () => {
    const html = '<div>Hej det är 3. plats</div><div>Andra raden</div>';
    expect(normalizePseudoListsInHtmlString(html)).toBe(html);
  });

  it('normalizePseudoListsInHtmlString keeps real lists intact', () => {
    const html = '<ul dir="auto"><li dir="auto">a</li><li dir="auto">b</li></ul>';
    expect(normalizePseudoListsInHtmlString(html)).toBe(html);
  });

  it('isCaretInBulletPrefixZone is true between bullet and text', () => {
    const ed = editorHtml('<div>• Mukosa</div>');
    const text = ed.querySelector('div')!.firstChild as Text;
    const range = caretIn(text, 2); // after "• "
    expect(isCaretInBulletPrefixZone(ed.querySelector('div')!, range)).toBe(true);
    const afterM = caretIn(text, 4);
    expect(isCaretInBulletPrefixZone(ed.querySelector('div')!, afterM)).toBe(false);
    ed.remove();
  });
});
