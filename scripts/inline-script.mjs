const MODULE_SCRIPT_OPEN = /<script\b[^>]*\btype=["']module["'][^>]*>/i;
const CLASSIC_SCRIPT_OPEN = /<script>/i;
const SCRIPT_CLOSE = /<\/script\s*>/gi;

function locateInlineApplicationScript(html) {
  const openingMatch = MODULE_SCRIPT_OPEN.exec(html) ?? CLASSIC_SCRIPT_OPEN.exec(html);
  if (!openingMatch || openingMatch.index === undefined) {
    throw new Error('Expected one inline application script');
  }

  const closingMatches = [...html.matchAll(SCRIPT_CLOSE)];
  const closingMatch = closingMatches.at(-1);
  if (!closingMatch || closingMatch.index === undefined || closingMatch.index < openingMatch.index) {
    throw new Error('Inline application script is missing its closing tag');
  }

  const payloadStart = openingMatch.index + openingMatch[0].length;
  return {
    openingStart: openingMatch.index,
    payloadStart,
    closingStart: closingMatch.index,
    closingEnd: closingMatch.index + closingMatch[0].length,
  };
}

export function inspectInlineApplicationScript(html) {
  const boundary = locateInlineApplicationScript(html);
  const payload = html.slice(boundary.payloadStart, boundary.closingStart);
  return {
    ...boundary,
    payload,
    unsafeClosingTags: [...payload.matchAll(SCRIPT_CLOSE)].map((match) => match.index ?? -1),
    trailingMarkup: html.slice(boundary.closingEnd),
  };
}

export function makeInlineApplicationScriptSafe(html) {
  const boundary = locateInlineApplicationScript(html);
  const payload = html
    .slice(boundary.payloadStart, boundary.closingStart)
    .replace(/<\/script/gi, '<\\/script');

  return [
    html.slice(0, boundary.openingStart),
    '<script>',
    payload,
    html.slice(boundary.closingStart),
  ].join('');
}
