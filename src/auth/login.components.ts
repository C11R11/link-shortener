import type { AppConfig } from '../config.js';

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Render a self-contained HTML login page. The page is deliberately
 * minimal — it does not depend on the dashboard stylesheet so it can
 * be served before any admin session exists.
 *
 * The CSRF token is rendered as a hidden input and is expected to also
 * be present as a signed cookie on the same request. The handler
 * compares the submitted value against the unsigned cookie value.
 */
export function renderLoginPage(
  config: AppConfig,
  error?: string,
  email?: string,
  csrfToken?: string,
): string {
  const errorBanner = error
    ? `<div class="login__error" role="alert">${escapeHtml(error)}</div>`
    : '';
  const csrfInput = csrfToken
    ? `<input type="hidden" name="csrfToken" value="${escapeHtml(csrfToken)}" />`
    : '';
  const baseUrl = escapeHtml(`${config.SHORTENER_SCHEME}://${config.SHORTENER_DOMAIN}`);
  const styles = `
    :root { color-scheme: dark; --bg:#0a0a0a; --panel:#111; --border:#222; --text:#e5e5e5; --muted:#888; --accent:#22c55e; --danger:#ef4444; --font:ui-monospace,SFMono-Regular,Menlo,Monaco,monospace; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: var(--bg); color: var(--text); font-family: var(--font); min-height: 100vh; }
    main.login { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px; }
    .login__card { width: 100%; max-width: 360px; background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 28px 24px; }
    .login__title { margin: 0 0 4px 0; font-size: 18px; color: var(--text); }
    .login__subtitle { margin: 0 0 20px 0; color: var(--muted); font-size: 12px; word-break: break-all; }
    .login__error { background: rgba(239,68,68,0.1); color: var(--danger); border: 1px solid var(--danger); border-radius: 4px; padding: 8px 12px; margin-bottom: 16px; font-size: 13px; }
    .login__label { display: block; margin-bottom: 12px; font-size: 12px; color: var(--muted); }
    .login__label span { display: block; margin-bottom: 4px; }
    .login__label input { width: 100%; padding: 8px 10px; background: var(--bg); color: var(--text); border: 1px solid var(--border); border-radius: 4px; font-family: var(--font); font-size: 14px; }
    .login__label input:focus { outline: none; border-color: var(--accent); }
    .login__submit { display: block; width: 100%; margin-top: 8px; padding: 10px; background: var(--accent); color: var(--bg); border: none; border-radius: 4px; font-family: var(--font); font-size: 14px; font-weight: 600; cursor: pointer; }
    .login__submit:hover { filter: brightness(1.1); }
    .login__footnote { margin: 16px 0 0 0; color: var(--muted); font-size: 11px; text-align: center; }
  `;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Sign in &middot; Link Shortener</title>
    <link rel="icon" href="/admin/favicon.svg" type="image/svg+xml" />
    <link rel="icon" href="/admin/favicon.ico" sizes="any" />
    <link rel="apple-touch-icon" href="/admin/apple-touch-icon.png" />
    <style>${styles}</style>
  </head>
  <body>
    <main class="login">
      <div class="login__card">
        <h1 class="login__title">$ sign in</h1>
        <p class="login__subtitle">Link Shortener Admin &middot; ${baseUrl}</p>
        ${errorBanner}
        <form method="post" action="/admin/login" autocomplete="on">
          ${csrfInput}
          <label class="login__label">
            <span>email</span>
            <input type="email" name="email" value="${escapeHtml(email ?? '')}" required autofocus autocomplete="username" />
          </label>
          <label class="login__label">
            <span>password</span>
            <input type="password" name="password" required autocomplete="current-password" />
          </label>
          <button type="submit" class="login__submit">sign in</button>
        </form>
        <p class="login__footnote">Use your admin email and password. Sessions are stored as signed HttpOnly cookies.</p>
      </div>
    </main>
  </body>
</html>`;
}
