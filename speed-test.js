const axios = require('axios');

async function bench(name, fn, runs = 3) {
  const times = [];
  for (let i = 0; i < runs; i++) {
    const t0 = Date.now();
    try {
      await fn();
      times.push(`${Date.now() - t0}ms`);
    } catch (e) {
      times.push(`ERR: ${e.message?.slice(0, 80)}`);
    }
    await new Promise(r => setTimeout(r, 1500));
  }
  console.log(`${name}:`, times.join(', '));
}

async function run() {
  console.log('Speed test (3 runs each):\n');
  const TEST_URL = 'https://www.youtube.com/watch?v=jNQXAC9IVRw';

  // siputzx ytmp3
  await bench('siputzx ytmp3', async () => {
    const r = await axios.get('https://api.siputzx.my.id/api/d/ytmp3', {
      params: { url: TEST_URL }, timeout: 30000
    });
    if (!r.data?.download && !r.data?.url) throw new Error('no url');
  });

  // eliteprotech - correct endpoint
  await bench('eliteprotech', async () => {
    const r = await axios.get(`https://eliteprotech-apis.zone.id/ytdown`, {
      params: { url: TEST_URL, format: 'mp3' }, timeout: 30000
    });
    if (!r.data?.download && !r.data?.url) throw new Error('no url');
  });

  // VPS audio download
  await bench('vps audio', async () => {
    const r = await axios.post('http://92.118.206.4:30102/api/media/audio', {
      url: TEST_URL
    }, { timeout: 90000, responseType: 'stream', validateStatus: () => true, headers: { 'Accept': '*/*' }});
    if (r.status !== 200) throw new Error(`status ${r.status}`);
    await new Promise((res, rej) => { r.data.on('end', res); r.data.on('error', rej); });
  });

  // VPS info (metadata only - fast)
  await bench('vps info', async () => {
    const r = await axios.post('http://92.118.206.4:30102/api/media/info', { url: TEST_URL }, { timeout: 30000 });
    if (r.status !== 200 || !r.data?.title) throw new Error('info failed');
  });
}
run();
