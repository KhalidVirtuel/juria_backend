//export function errorHandler(err,req,res,next){ console.error(err); res.status(500).json({ error: err.message || 'Internal error' }); }
export function errorHandler(err, req, res, next) {
  // Log détaillé côté serveur
  console.error('[API ERROR]', err?.stack || err);
  const payload = {
    error: err?.message || 'Internal Server Error',
  };
  // Si l’SDK renvoie un body d’erreur (OpenAI/Groq/axios), expose-le
  if (err?.response?.data) payload.detail = err.response.data;
  if (err?.status) payload.status = err.status;
  res.status(500).json(payload);
}