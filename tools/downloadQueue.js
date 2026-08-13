const MAX_CONCURRENCY = 2;

let running = 0;
const pending = [];

function run(task) {
  return new Promise((resolve, reject) => {
    pending.push({ task, resolve, reject });
    process.nextTick(consume);
  });
}

function consume() {
  while (running < MAX_CONCURRENCY && pending.length > 0) {
    const entry = pending.shift();
    running++;

    const task = entry.task;
    const resolve = entry.resolve;
    const reject = entry.reject;

    entry.task = null;
    entry.resolve = null;
    entry.reject = null;

    const next = () => {
      running--;
      process.nextTick(consume);
    };

    Promise.resolve().then(() => task()).then(
      (val) => { resolve(val); next(); },
      (err) => { reject(err); next(); }
    );
  }
}

module.exports = { run };
