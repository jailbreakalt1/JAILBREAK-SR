// Remembers what query the buttons we sent were for, per chat. Some
// WhatsApp clients don't send back the button's id when a quick_reply is
// tapped (or send the display label as plain text) — the handler then
// resolves the action from the label and the query from this context.
const contexts = new Map();
const TTL_MS = 15 * 60 * 1000;

function set(jid, ctx) {
  contexts.set(jid, { ...ctx, ts: Date.now() });
}

function get(jid) {
  const ctx = contexts.get(jid);
  if (!ctx) return null;
  if (Date.now() - ctx.ts > TTL_MS) {
    contexts.delete(jid);
    return null;
  }
  return ctx;
}

function clear(jid) {
  contexts.delete(jid);
}

module.exports = { set, get, clear };
