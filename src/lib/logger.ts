import type { LogLevel, LogEntry } from "../types/index.ts";

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export interface LoggerLike {
  debug(msg: string, context?: Record<string, unknown>): void;
  info(msg: string, context?: Record<string, unknown>): void;
  warn(msg: string, context?: Record<string, unknown>): void;
  error(msg: string, context?: Record<string, unknown>): void;
  child(context: Record<string, unknown>): LoggerLike;
}

export class Logger implements LoggerLike {
  private worker: string;
  private traceId: string;
  private minLevel: number;

  constructor(worker: string, logLevel: string = "info") {
    this.worker = worker;
    this.traceId = crypto.randomUUID();
    this.minLevel = LEVELS[logLevel as LogLevel] ?? LEVELS.info;
  }

  // Create a child logger with extra context fields
  child(context: Record<string, unknown>): ChildLogger {
    return new ChildLogger(this, context);
  }

  debug(msg: string, context?: Record<string, unknown>): void {
    this.log("debug", msg, context);
  }

  info(msg: string, context?: Record<string, unknown>): void {
    this.log("info", msg, context);
  }

  warn(msg: string, context?: Record<string, unknown>): void {
    this.log("warn", msg, context);
  }

  error(msg: string, context?: Record<string, unknown>): void {
    this.log("error", msg, context);
  }

  log(level: LogLevel, msg: string, context?: Record<string, unknown>): void {
    if (LEVELS[level] < this.minLevel) return;

    const entry: LogEntry = {
      level,
      worker: this.worker,
      traceId: this.traceId,
      msg,
      ts: new Date().toISOString(),
      ...context,
    };

    const line = JSON.stringify(entry);

    switch (level) {
      case "debug":
        console.debug(line);
        break;
      case "info":
        console.log(line);
        break;
      case "warn":
        console.warn(line);
        break;
      case "error":
        console.error(line);
        break;
    }
  }
}

class ChildLogger implements LoggerLike {
  constructor(
    private parent: Logger,
    private context: Record<string, unknown>,
  ) {}

  child(extra: Record<string, unknown>): LoggerLike {
    return new ChildLogger(this.parent, { ...this.context, ...extra });
  }

  debug(msg: string, extra?: Record<string, unknown>): void {
    this.parent.log("debug", msg, { ...this.context, ...extra });
  }

  info(msg: string, extra?: Record<string, unknown>): void {
    this.parent.log("info", msg, { ...this.context, ...extra });
  }

  warn(msg: string, extra?: Record<string, unknown>): void {
    this.parent.log("warn", msg, { ...this.context, ...extra });
  }

  error(msg: string, extra?: Record<string, unknown>): void {
    this.parent.log("error", msg, { ...this.context, ...extra });
  }
}
