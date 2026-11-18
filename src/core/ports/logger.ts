type Log = (details: object, message: string) => void;

export interface Logger {
  debug: Log;
  info: Log;
  warn: Log;
  error: Log;
  child: (bindings: object) => Logger;
}
