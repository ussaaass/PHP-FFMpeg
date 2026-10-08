export class HlsCtrPlayerError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = 'HlsCtrPlayerError';
    this.code = code;
  }
}
