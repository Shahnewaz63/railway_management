module.exports = function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status < 500 ? err.message : "Something went wrong. Please try again." });
};
