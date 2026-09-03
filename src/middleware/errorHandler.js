module.exports = function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  if (res.headersSent) return next(err);
  const status = err.status || (err.type === "entity.parse.failed" ? 400 : err.type === "entity.too.large" ? 413 : 500);
  if (status >= 500) console.error(err);
  const message = status < 500
    ? (err.type === "entity.parse.failed" ? "Request body must contain valid JSON." : err.message)
    : "Something went wrong. Please try again.";
  res.status(status).json({ error: message });
};
