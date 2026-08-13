const BANNER = '⧯ *𝙹𝙰𝙸𝙻𝙱𝚁𝙴𝙰𝙺_𝚂𝚁* 𝙱𝚁𝙸𝙽𝙶𝚂 𝚈𝙾𝚄';
const RULE = '⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯';
const FOOTER = '> ☬ *JAILBREAK HUB* ☬';
const CHANNEL_URL = 'https://whatsapp.com/channel/0029Vb6zZKpKbYMFqRWgx62q';

function buildCard({ title, lines = [], footer = FOOTER }) {
  const body = lines.filter(Boolean).join('\n');
  return [
    BANNER,
    RULE,
    `◈ *${title}*`,
    body,
    RULE,
    footer,
    `▸ *CHANNEL:* ${CHANNEL_URL}`,
  ].filter(Boolean).join('\n');
}

function buildStatusCard({ title, status = '', lines = [], footer = FOOTER }) {
  const bodyLines = [];
  if (status) bodyLines.push(status);
  if (lines.length) bodyLines.push(...lines);
  return buildCard({ title, lines: bodyLines, footer });
}

module.exports = {
  BANNER,
  RULE,
  FOOTER,
  buildCard,
  buildStatusCard,
};
