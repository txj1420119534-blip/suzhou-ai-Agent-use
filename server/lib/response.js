export function ok(ctx, data = {}) {
  ctx.body = { ok: true, ...data };
}

export function badRequest(ctx, message, details = {}) {
  ctx.status = 400;
  ctx.body = { ok: false, error: message, ...details };
}

export function serverError(ctx, error) {
  ctx.status = 500;
  ctx.body = {
    ok: false,
    error: "server_error",
    message: error?.message || String(error)
  };
}
