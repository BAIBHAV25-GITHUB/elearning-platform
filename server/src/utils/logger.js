// Tiny structured logger (no dependency). One JSON object per line in production so log tools can parse it;
// readable text while developing. LOG_LEVEL = debug | info | warn | error | silent (silent by default under test).
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };
const configured = (process.env.LOG_LEVEL || (process.env.NODE_ENV === 'test' ? 'silent' : 'info')).toLowerCase();
const threshold = LEVELS[configured] ?? LEVELS.info;
const json = process.env.NODE_ENV === 'production' || process.env.LOG_FORMAT === 'json';

const serialiseError = (err) =>
  err instanceof Error ? { name: err.name, message: err.message, code: err.code, stack: err.stack } : err;

const write = (level, msg, fields = {}) => {
  if (LEVELS[level] < threshold) return;
  const clean = Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, k === 'err' ? serialiseError(v) : v]));
  const stream = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
  if (json) {
    stream.write(JSON.stringify({ level, time: new Date().toISOString(), msg, ...clean }) + '\n');
  } else {
    const extra = Object.keys(clean).length
      ? ' ' + Object.entries(clean).map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' ')
      : '';
    stream.write(`${level.toUpperCase().padEnd(5)} ${msg}${extra}\n`);
  }
};

// logger.error('what happened', { err, id })  - preferred: msg + one fields object
// logger.error('what happened', err)           - also fine: an Error becomes the "err" field
// Older console.*-style extra arguments are folded into one "detail" string so nothing is lost.
const toFields = (args) => {
  if (!args.length) return {};
  if (args.length === 1 && args[0] && typeof args[0] === 'object' && !(args[0] instanceof Error)) return args[0];
  const err = args.find((a) => a instanceof Error);
  const rest = args.filter((a) => a !== err).map((a) => (a && typeof a === 'object' ? JSON.stringify(a) : String(a)));
  return { ...(err ? { err } : {}), ...(rest.length ? { detail: rest.join(' ') } : {}) };
};

export const logger = {
  debug: (msg, ...args) => write('debug', msg, toFields(args)),
  info: (msg, ...args) => write('info', msg, toFields(args)),
  warn: (msg, ...args) => write('warn', msg, toFields(args)),
  error: (msg, ...args) => write('error', msg, toFields(args)),
};
