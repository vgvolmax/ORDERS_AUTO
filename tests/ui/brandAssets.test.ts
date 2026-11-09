import { describe, expect, it } from 'vitest';
import lightWordmark from '../../src/styles/brand/wordmark.svg?raw';
import darkWordmark from '../../src/styles/brand/wordmark-inverse.svg?raw';
import favicon from '../../src/styles/brand/volmax-mark.svg?raw';

function markCircles(markup: string): string[][] {
  const svg = new DOMParser().parseFromString(markup, 'image/svg+xml');
  return [...svg.querySelectorAll('#volmax-mark circle')].map((circle) => [
    circle.parentElement!.getAttribute('fill')!,
    circle.getAttribute('cx')!,
    circle.getAttribute('cy')!,
    circle.getAttribute('r')!,
  ]);
}

describe('Volmax wordmarks', () => {
  it('uses the same 15-dot sign in the favicon and both product wordmarks', () => {
    const canonical = markCircles(favicon);
    expect(canonical.filter(([color]) => color === '#009add')).toHaveLength(12);
    expect(canonical.filter(([color]) => color === '#e61f2f')).toHaveLength(3);
    expect(markCircles(lightWordmark)).toEqual(canonical);
    expect(markCircles(darkWordmark)).toEqual(canonical);
  });
});
