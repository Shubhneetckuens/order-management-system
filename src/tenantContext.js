const { AsyncLocalStorage } = require("async_hooks");
const als = new AsyncLocalStorage();

function parseTenant(value) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function resolveTenantId(req) {
  return (
    parseTenant(req.query && req.query.tenant) ||
    parseTenant(req.body && (req.body.tenant_id || req.body.tenant || req.body.tenantId)) ||
    parseTenant(req.session && req.session.tenant_id) ||
    1
  );
}

function tenantMiddleware(req, res, next) {
  const tid = resolveTenantId(req);

  req.session = req.session || {};
  req.session.tenant_id = tid;

  req.tenant_id = tid;
  res.locals.tenant_id = tid;

  als.run({ tenant_id: tid }, () => next());
}

function getTenantId() {
  const store = als.getStore();
  return store && store.tenant_id ? store.tenant_id : 1;
}

module.exports = { tenantMiddleware, getTenantId, resolveTenantId };
