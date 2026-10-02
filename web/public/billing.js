(() => {
  'use strict';
  const api = document.querySelector('meta[name="tardy-api-url"]')?.content?.replace(/\/$/, '');
  const status = document.querySelector('#billing-status');
  const buttons = [...document.querySelectorAll('[data-tier]')];
  const manage = document.querySelector('#manage-billing');
  if (!api || !status) return;

  const request = async (path, options = {}) => {
    const response = await fetch(`${api}${path}`, {
      credentials: 'include',
      headers: { 'content-type': 'application/json', ...(options.headers || {}) },
      ...options,
    });
    const text = await response.text();
    const body = text ? JSON.parse(text) : null;
    if (!response.ok) throw new Error(body?.error || `HTTP ${response.status}`);
    return body;
  };

  const show = (message, error = false) => {
    status.textContent = message;
    status.classList.toggle('error', error);
  };

  const load = async () => {
    const billing = await request('/v1/web/billing');
    buttons.forEach((button) => {
      button.disabled = Boolean(billing.tier);
    });
    manage.hidden = !billing.stripe_customer;
    if (billing.tier === 'super_tardy') show(`SUPER Tardy #${billing.super_tardy_slot} · lifetime`);
    else if (billing.tier === 'real_tardy') show(`REAL Tardy active${billing.expires_at ? ` through ${new Date(billing.expires_at).toLocaleDateString()}` : ''}`);
    else show('Signed in · choose your verification');
  };

  const exchange = async () => {
    const url = new URL(location.href);
    const code = url.searchParams.get('handoff');
    if (!code) return;
    url.searchParams.delete('handoff');
    history.replaceState({}, '', url);
    await request('/v1/web/session/exchange', { method: 'POST', body: JSON.stringify({ code }) });
  };

  buttons.forEach((button) => button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      const result = await request('/v1/web/billing/stripe/checkout', { method: 'POST', body: JSON.stringify({ tier: button.dataset.tier }) });
      location.assign(result.url);
    } catch (error) {
      show(`Checkout failed: ${error.message}`, true);
      button.disabled = false;
    }
  }));
  manage?.addEventListener('click', async () => {
    manage.disabled = true;
    try { location.assign((await request('/v1/web/billing/stripe/portal', { method: 'POST', body: '{}' })).url); }
    catch (error) { show(`Billing portal failed: ${error.message}`, true); manage.disabled = false; }
  });

  exchange().then(load).catch((error) => show(`Open this page from Tardy again. ${error.message}`, true));
})();
