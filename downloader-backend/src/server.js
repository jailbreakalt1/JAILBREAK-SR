const express = require('express');
const https = require('https');
const config = require('./config');
const logger = require('./utils/logger');
const requestLogger = require('./middleware/requestLogger');
const rateLimiter = require('./middleware/rateLimiter');
const errorHandler = require('./middleware/errorHandler');
const downloadRoute = require('./routes/download.route');
const mediaRoute = require('./routes/media.route');
const cookieRoute = require('./routes/cookie.route');
const potRoute = require('./routes/pot.route');
const imgRoute = require('./routes/img.route');
const healthRoute = require('./routes/health.route');
const quotaRoute = require('./routes/quota.route');
const tempFileManager = require('./core/tempFileManager');

const app = express();

app.use(requestLogger);
app.use(express.json({ limit: '100kb' }));
app.use(rateLimiter);

app.use('/api', downloadRoute);
app.use('/api/media', mediaRoute);
app.use('/api/cookies', cookieRoute);
app.use('/api/pot', potRoute);
app.use('/api/img', imgRoute);
app.use('/api/quota', quotaRoute);
app.use('/', healthRoute);

app.use((_req, res) => {
  res.status(404).json({ error: 'NotFound', message: 'Route not found.' });
});
app.use(errorHandler);

const SWEEP_INTERVAL_MS = 15 * 60 * 1000;
const SWEEP_MAX_AGE_MS = 30 * 60 * 1000;
const sweepTimer = setInterval(() => {
  tempFileManager.sweepOld(SWEEP_MAX_AGE_MS).then((n) => {
    if (n > 0) logger.info({ removed: n }, 'temp sweep');
  }).catch(() => {});
}, SWEEP_INTERVAL_MS);
sweepTimer.unref();

function lookupPublicIp() {
  return new Promise((resolve) => {
    const request = https.get('https://api.ipify.org', { timeout: 5000 }, (response) => {
      if (response.statusCode !== 200) {
        response.resume();
        resolve('');
        return;
      }

      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => resolve(/^\d{1,3}(?:\.\d{1,3}){3}$/.test(body.trim()) ? body.trim() : ''));
    });

    request.on('timeout', () => request.destroy());
    request.on('error', () => resolve(''));
  });
}

async function logConnectionDetails() {
  const publicIp = process.env.PUBLIC_IP || process.env.PUBLIC_HOST || await lookupPublicIp();
  const host = publicIp || 'PUBLIC_IP_UNAVAILABLE';
  const backendUrl = `http://${host}:${config.port}`;
  const quotaUrl = `${backendUrl}/api/quota`;

  logger.info({
    bind: '0.0.0.0',
    ip: host,
    port: config.port,
    backendUrl,
    quotaUrl,
    quotaToken: config.quotaToken ? 'configured' : 'missing',
  }, 'connection details');

  const reset = '\x1b[0m';
  const cyan = '\x1b[36m';
  const green = '\x1b[32m';
  const yellow = '\x1b[33m';
  const white = '\x1b[97m';
  const bold = '\x1b[1m';
  const tokenStatus = config.quotaToken ? `${green}configured${reset}` : `${yellow}missing${reset}`;

  console.log(`\n${cyan}${bold}╔══════════════════════════════════════════╗${reset}`);
  console.log(`${cyan}${bold}║         JAILBREAK DOWNLOAD BACKEND       ║${reset}`);
  console.log(`${cyan}${bold}╠══════════════════════════════════════════╣${reset}`);
  console.log(`${cyan}║${reset} ${white}IP       ${cyan}│${reset} ${green}${host}${reset}`);
  console.log(`${cyan}║${reset} ${white}PORT     ${cyan}│${reset} ${green}${config.port}${reset}`);
  console.log(`${cyan}║${reset} ${white}BACKEND  ${cyan}│${reset} ${green}${backendUrl}${reset}`);
  console.log(`${cyan}║${reset} ${white}QUOTA    ${cyan}│${reset} ${green}${quotaUrl}${reset}`);
  console.log(`${cyan}║${reset} ${white}TOKEN    ${cyan}│${reset} ${tokenStatus}`);
  console.log(`${cyan}${bold}╚══════════════════════════════════════════╝${reset}\n`);
}

app.listen(config.port, process.env.HOST || '127.0.0.1', () => {
  logger.info({ port: config.port }, 'downloader backend listening');
  logConnectionDetails().catch((error) => {
    logger.warn({ error: error.message }, 'could not determine public connection details');
  });
});

module.exports = app;
