/**
 * Every expected failure in the app is thrown as an HttpError. The error
 * middleware turns it into a JSON body; anything that is NOT an HttpError is
 * treated as a bug and reported as a 500 without leaking internals.
 */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code: string = 'error',
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const badRequest = (message: string, code = 'bad_request') => new HttpError(400, message, code);
export const unauthorized = (message = 'Authentication required', code = 'unauthorized') =>
  new HttpError(401, message, code);
export const forbidden = (message = 'Not allowed', code = 'forbidden') => new HttpError(403, message, code);
export const notFound = (message = 'Not found', code = 'not_found') => new HttpError(404, message, code);
export const conflict = (message: string, code = 'conflict') => new HttpError(409, message, code);
