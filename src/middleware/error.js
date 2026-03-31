export function errorHandler(err, _req, res, _next){
  console.error('[API ERROR]', err);
  const status = err.status || 500;
  const body = err.body || { error: err.message || 'Internal Server Error' };
  res.status(status).json(body);
}
