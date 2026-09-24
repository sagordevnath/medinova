import type { NextFunction, Request, RequestHandler, Response } from 'express';

/** Wrap an async route handler so rejections reach the error middleware. */
export function h(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    void Promise.resolve(fn(req, res, next)).catch(next);
  };
}
