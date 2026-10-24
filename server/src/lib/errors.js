export class HttpError extends Error {
  constructor(status, message, fields) {
    super(message);
    this.status = status;
    this.fields = fields;
  }
}
export const badRequest = (m, f) => new HttpError(400, m, f);
export const unauthorized = (m = 'Please sign in to continue') => new HttpError(401, m);
export const forbidden = (m = 'You do not have permission to do that') => new HttpError(403, m);
export const notFound = (m = 'Not found') => new HttpError(404, m);
export const conflict = (m) => new HttpError(409, m);
