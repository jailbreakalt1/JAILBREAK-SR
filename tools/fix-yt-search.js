const fs = require('fs');
const path = require('path');

// yt-search@2.13.1 crashes with "title.trim is not a function" because
// YouTube now serves the new "lockup" view model where titles are objects
// like { content: 'Taylor Swift', styleRuns: [...] } instead of plain
// strings. This idempotently patches the bundled parser so it coerces any
// title shape to a string. Reapplied on every `npm install` via postinstall.

const target = path.join(__dirname, '..', 'node_modules', 'yt-search', 'dist', 'yt-search.js');

const MARKER = 'function _str(v)';

const HELPER = `
function _str(v) {
  if (typeof v === 'string') return v.trim();
  if (v === undefined || v === null) return '';
  if (typeof v.content === 'string') return v.content.trim();
  if (typeof v.simpleText === 'string') return v.simpleText.trim();
  if (Array.isArray(v.runs)) return v.runs.map(function (r) { return r && typeof r.text === 'string' ? r.text : ''; }).join('').trim();
  return String(v);
}
`;

const REPLACEMENTS = [
  ['title: title.trim(),', 'title: _str(title),'],
  ['title: _title.trim(),', 'title: _str(_title),'],
  ['title: _title2.trim(),', 'title: _str(_title2),'],
  ['title: _title3.trim(),', 'title: _str(_title3),'],
  [
    'var viewsCount = Number(viewCountText.split(/\\s+/)[0].split(/[,.]/).join(\'\').trim());',
    'var viewsCount = Number(_str(viewCountText).split(/\\s+/)[0].split(/[,.]/).join(\'\').trim());',
  ],
  [
    'var watchCount = Number(_watchingLabel.split(/\\s+/)[0].split(/[,.]/).join(\'\').trim());',
    'var watchCount = Number(_str(_watchingLabel).split(/\\s+/)[0].split(/[,.]/).join(\'\').trim());',
  ],
  [
    'var duration = _parseDuration(lengthText || \'0:00\');',
    'var duration = _parseDuration(_str(lengthText) || \'0:00\');',
  ],
  [
    'function _parseDuration(timestampText) {',
    'function _parseDuration(timestampText) {\n  timestampText = _str(timestampText || \'0:00\');',
  ],
  [
    'var listId = _jp.value(json, \'$..microformat..urlCanonical\').split(\'=\')[1];',
    'var listId = _str(_jp.value(json, \'$..microformat..urlCanonical\') || \'\').split(\'=\')[1];',
  ],
];

try {
  let src = fs.readFileSync(target, 'utf8');

  if (src.includes(MARKER)) {
    console.log('[fix-yt-search] already patched, skipping.');
    return;
  }

  src = src.replace(
    'var _jp = {};',
    'var _jp = {};' + HELPER
  );

  for (const [from, to] of REPLACEMENTS) {
    if (!src.includes(from)) {
      console.warn(`[fix-yt-search] pattern not found (skipping): ${from.slice(0, 60)}...`);
      continue;
    }
    src = src.split(from).join(to);
  }

  fs.writeFileSync(target, src);
  console.log('[fix-yt-search] patched yt-search parser.');
} catch (err) {
  console.error('[fix-yt-search] failed:', err.message);
  process.exitCode = 1;
}
