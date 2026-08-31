import { describe, expect, it } from 'vitest';

// The production packager is deliberately plain Node.js so the same code is
// exercised by both Vitest and the post-build command.
// @ts-expect-error -- the runtime module has no separate TypeScript declarations
import { inspectInlineApplicationScript, makeInlineApplicationScriptSafe } from '../../scripts/inline-script.mjs';

describe('single-file inline script packaging', () => {
  const unsafeHtml = [
    '<!doctype html><html><body><div id="root"></div>',
    '<script type="module">',
    'const closingTag = "</script>";',
    'window.example = closingTag;',
    '</script>',
    '</body></html>',
  ].join('');

  it('PACK-01/PACK-02 preserves the intended script boundary and escapes only its payload', () => {
    const safeHtml = makeInlineApplicationScriptSafe(unsafeHtml);
    const inspection = inspectInlineApplicationScript(safeHtml);

    expect(safeHtml).toContain('<script>');
    expect(safeHtml).toContain('const closingTag = "<\\/script>";');
    expect(inspection.unsafeClosingTags).toEqual([]);
    expect(inspection.trailingMarkup).toBe('</body></html>');
  });

  it('does not rewrite the real HTML closing tag', () => {
    const safeHtml = makeInlineApplicationScriptSafe(unsafeHtml);

    expect(safeHtml.match(/<\/script>/g)).toHaveLength(1);
  });
});
