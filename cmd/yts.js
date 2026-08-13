const yts = require('yt-search');
const config = require('../config');
const { buildCard, buildStatusCard } = require('../tools/style');
const { sendInteractiveMessage } = require('@ryuu-reinzz/button-helper');

const CHANNEL_URL = 'https://whatsapp.com/channel/0029Vb6zZKpKbYMFqRWgx62q';

const formatResult = (video, index) => {
  const title = video.title || 'Unknown title';
  const author = video.author?.name || 'Unknown artist';
  const duration = video.timestamp || 'live';
  const views = typeof video.views === 'number' ? video.views.toLocaleString() : 'unknown';

  return [
    `*${index}. ${title}*`,
    `> Artist: \`${author}\``,
    `> Duration: \`${duration}\``,
    `> Views: \`${views}\``,
  ].join('\n');
};

const buildPickerText = (videos, query) =>
  buildCard({
    title: `YTS RESULTS :: ${query}`,
    lines: videos.map((video, idx) => formatResult(video, idx + 1)),
  });

module.exports = {
  name: 'yts',
  aliases: ['youtubesearch', 'ytsearch', 'ytsong'],
  category: 'cmd',
  description: 'Search YouTube and show the top results',
  usage: '.yts <song name>',

  async execute(sock, msg, args, extra = {}) {
    const from = extra.from || msg.key.remoteJid;
    const query = args.join(' ').trim();

    if (!query) {
      await sock.sendMessage(from, {
        text: buildStatusCard({
          title: 'YTS SEARCH',
          status: '⫎ Provide a search term.',
          lines: [`Example: ${config.prefix}yts amapiano`],
        })
      }, { quoted: msg });
      return;
    }

    try {
      if (typeof extra.react === 'function') await extra.react('🔎');

      const result = await yts(query);
      const videos = (result?.videos || []).slice(0, 8);

      if (!videos.length) {
        await sock.sendMessage(from, {
          text: buildStatusCard({
            title: 'YTS SEARCH',
            status: '❌ No results found.',
            lines: ['Try a different title or artist.'],
          })
        }, { quoted: msg });
        if (typeof extra.react === 'function') await extra.react('❌');
        return;
      }

      const rows = videos.map((video) => {
        const songQuery = `${video.title} ${video.author?.name || ''}`.trim();
        return {
          id: `ytselect:${encodeURIComponent(songQuery)}`,
          title: video.title || 'Unknown title',
          description: `${video.author?.name || 'Unknown artist'} • ${video.timestamp || 'live'}`,
        };
      });

      try {
        await sendInteractiveMessage(sock, from, {
          text: buildPickerText(videos, query) + '\n\n_Tap the button below and pick a result — it downloads automatically._',
          interactiveButtons: [
            {
              name: 'single_select',
              buttonParamsJson: JSON.stringify({
                title: 'SELECT A RESULT TO DOWNLOAD',
                sections: [
                  {
                    title: 'Top 8 results',
                    rows,
                  },
                ],
              }),
            },
            {
              name: 'cta_url',
              buttonParamsJson: JSON.stringify({
                display_text: '▶ JOIN CHANNEL',
                url: CHANNEL_URL,
              }),
            },
          ],
        }, { quoted: msg });
      } catch (error) {
        console.warn('[YTS] interactive send failed, falling back to plain text:', error?.message || error);
        const fallback = buildCard({
          title: `YTS RESULTS :: ${query}`,
          lines: videos.map((video, idx) => formatResult(video, idx + 1) + `\n> Link: ${video.url || 'Not available'}`),
        });
        await sock.sendMessage(from, {
          text: `${fallback}\n\nDownload manually: \`.song <name>\``
        }, { quoted: msg });
      }

      if (typeof extra.react === 'function') await extra.react('✅');
    } catch (error) {
      console.error('[YTS] command error:', error?.message || error);
      await sock.sendMessage(from, {
        text: buildStatusCard({
          title: 'YTS SEARCH',
          status: '❌ Search failed.',
          lines: [error?.message || 'Unknown error'],
        })
      }, { quoted: msg });
      if (typeof extra.react === 'function') await extra.react('❌');
    }
  }
};