import fs from "fs";
import path from "path";

const LOG_DIR = path.join(process.cwd(), "logs");

// FIX: wrap dir creation — a permissions error no longer crashes the app
try {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
} catch (err) {
  process.stderr.write(`[logger] Cannot create log dir: ${(err as Error).message}\n`);
}

type LogLevel = "INFO" | "ERROR" | "WARN" | "DEBUG"; // FIX: typo LogLeveL → LogLevel

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  DEBUG: 10,
  INFO: 20,
  WARN: 30,
  ERROR: 40,
};

// FIX: filter by level via env var (default INFO) so DEBUG doesn't leak in prod
const MIN_LEVEL: LogLevel =
  (process.env.LOG_LEVEL?.toUpperCase() as LogLevel) in LEVEL_PRIORITY
    ? (process.env.LOG_LEVEL!.toUpperCase() as LogLevel)
    : "INFO";

// FIX: safe serialization — circular refs, BigInt, Error no longer throw
const safeStringify = (value: unknown): string => {
  const seen = new WeakSet<object>();
  try {
    return JSON.stringify(value, (_key, val) => {
      if (typeof val === "bigint") return val.toString();
      if (val instanceof Error) {
        return { name: val.name, message: val.message, stack: val.stack };
      }
      if (typeof val === "object" && val !== null) {
        if (seen.has(val)) return "[Circular]";
        seen.add(val);
      }
      return val;
    });
  } catch {
    return "[Unserializable]";
  }
};

const formatMessage = (
  level: LogLevel,
  message: string,
  meta?: unknown,
): string => {
  const timestamp = new Date().toISOString();
  // FIX: check !== undefined so meta = 0 / "" / false is still logged
  const metaStr = meta !== undefined ? ` | ${safeStringify(meta)}` : "";
  return `[${timestamp}] [${level}] ${message}${metaStr}`;
};

// FIX: async (appendFile instead of appendFileSync) — no event-loop blocking
// FIX: errors go to stderr instead of crashing the process
const writeToFile = (level: LogLevel, content: string) => {
  const date = new Date().toISOString().split("T")[0];
  const fileName = path.join(LOG_DIR, `${date}-${level.toLowerCase()}.log`);
  fs.appendFile(fileName, content + "\n", (err) => {
    if (err) {
      process.stderr.write(`[logger] Write failed: ${err.message}\n`);
    }
  });
};

// FIX: colors go to console only — log files stay clean (no ANSI garbage)
// FIX: only colorize when attached to a TTY, and not in production
// FIX: use console.error / warn / debug instead of console.log for every level
const printToConsole = (level: LogLevel, formatted: string) => {
  const useColor =
    process.stdout.isTTY && process.env.NODE_ENV !== "production";
  const color =
    level === "ERROR"
      ? "\x1b[31m"
      : level === "WARN"
        ? "\x1b[33m"
        : level === "DEBUG"
          ? "\x1b[36m"
          : "\x1b[32m";
  const out = useColor ? `${color}${formatted}\x1b[0m` : formatted;

  if (level === "ERROR") console.error(out);
  else if (level === "WARN") console.warn(out);
  else if (level === "DEBUG") console.debug(out);
  else console.log(out);
};

// FIX: shared helper — removes the 4 duplicated 3-line blocks below
const log = (level: LogLevel, message: string, meta?: unknown) => {
  if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[MIN_LEVEL]) return;
  const formatted = formatMessage(level, message, meta);
  printToConsole(level, formatted);
  writeToFile(level, formatted);
};

export const logger = {
  info: (message: string, meta?: unknown) => log("INFO", message, meta),

  warn: (message: string, meta?: unknown) => log("WARN", message, meta),

  error: (message: string, meta?: unknown) => log("ERROR", message, meta),

  debug: (message: string, meta?: unknown) => log("DEBUG", message, meta),
};

export default logger;