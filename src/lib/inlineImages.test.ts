import { afterEach, describe, expect, it } from 'vitest';
import { htmlHasInlineImage, stripInlineDataImages } from './inlineImages';
import {
  isCloudStorageBlocked,
  isLikelyStorageNetworkBlock,
  markCloudStorageBlocked,
  resetCloudStorageBlockedForTests,
} from './imageUpload';

describe('stripInlineDataImages', () => {
  it('leaves storage URLs and text alone', () => {
    const html = '<p>hi</p><img src="https://firebasestorage.googleapis.com/v0/b/x/o/a">';
    expect(stripInlineDataImages(html)).toBe(html);
    expect(htmlHasInlineImage(html)).toBe(false);
  });

  it('strips base64 img src without keeping the payload', () => {
    const html = `<p>q</p><img src="data:image/png;base64,${'A'.repeat(80)}">`;
    const out = stripInlineDataImages(html);
    expect(out.includes('data:image')).toBe(false);
    expect(out.includes('data-tn-stripped')).toBe(true);
  });
});

describe('cloud storage circuit breaker', () => {
  afterEach(() => {
    resetCloudStorageBlockedForTests();
  });

  it('trips on CORS / ERR_FAILED style errors', () => {
    expect(isLikelyStorageNetworkBlock(new Error('Failed to fetch'))).toBe(true);
    expect(isLikelyStorageNetworkBlock({ code: 'storage/retry-limit-exceeded' })).toBe(true);
    expect(isLikelyStorageNetworkBlock({ message: 'Access to XMLHttpRequest has been blocked by CORS policy' })).toBe(true);
    expect(isCloudStorageBlocked()).toBe(false);
    markCloudStorageBlocked();
    expect(isCloudStorageBlocked()).toBe(true);
  });

  it('remembers a blocked Storage session across module checks', () => {
    markCloudStorageBlocked();
    expect(sessionStorage.getItem('malacadhati_storage_blocked')).toBe('1');
    expect(isCloudStorageBlocked()).toBe(true);
  });
});
