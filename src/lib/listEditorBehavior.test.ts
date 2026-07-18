import { describe, expect, it, beforeEach } from 'vitest';
import {
  BULLET_PREFIX_RE,
  collectListItemsBetween,
  convertEmptyListItemToParagraph,
  createEmptyParagraph,
  insertParagraphAboveList,
  isCaretAtStartOfLi,
  isLiEffectivelyEmpty,
  isLiEmpty,
  mergeAdjacentLists,
  removeListItemsInRangeDom,
  selectionSpansEntireListItems,
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

  it('BULLET_PREFIX_RE matches pseudo bullets', () => {
    expect('• test'.match(BULLET_PREFIX_RE)?.[0]).toBe('• ');
    expect('1. test'.match(BULLET_PREFIX_RE)?.[0]).toBe('1. ');
  });
});
