/**
 * Cloudflare Pages Function
 * POST /api/cryptobot/create-invoice
 *
 * Requires an env var:
 *   CRYPTO_PAY_API_TOKEN = <token from @CryptoBot -> Crypto Pay -> Create App>
 */

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'content-type'
    }
  });
}

export async function onRequestPost({ request, env }) {
  try {
    const token = env.CRYPTO_PAY_API_TOKEN;
    if (!token) {
      return json({ ok: false, error: 'CRYPTO_PAY_API_TOKEN is not set' }, 500);
    }

    const body = await request.json().catch(() => ({}));

    // Incoming fields from the frontend
    const amountRaw = body?.amount;
    const fiat = String(body?.currency || 'USD').toUpperCase();
    const asset = String(body?.asset || 'USDT').toUpperCase();
    const product = String(body?.product || 'Product');
    const plan = String(body?.plan || '');

    const amountNum = Number.parseFloat(String(amountRaw));
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      return json({ ok: false, error: 'INVALID_AMOUNT' }, 400);
    }

    // Crypto Pay API supports many fiat currencies; we pass through what the site uses.
    // If you only use USD, keep USD.
    const invoiceReq = {
      currency_type: 'fiat',
      fiat,
      amount: amountNum.toFixed(2),
      accepted_assets: asset,
      description: plan ? `${product} — ${plan}` : product,
      // Attach any metadata you need later (up to 4kb)
      payload: JSON.stringify({
        email: body?.email || null,
        product,
        plan,
        amount: amountNum.toFixed(2),
        fiat,
        asset,
        coupon_code: body?.coupon_code || null,
        discount: body?.discount || 0
      }),
      allow_comments: false,
      allow_anonymous: true,
      expires_in: 3600
    };

    const apiRes = await fetch('https://pay.crypt.bot/api/createInvoice', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'Crypto-Pay-API-Token': token
      },
      body: JSON.stringify(invoiceReq)
    });

    const data = await apiRes.json().catch(() => null);

    if (!data || data.ok !== true) {
      return json({ ok: false, error: data?.error || 'API_ERROR', raw: data || null }, 502);
    }

    return json(data, 200);
  } catch (err) {
    return json({ ok: false, error: 'SERVER_ERROR', message: String(err?.message || err) }, 500);
  }
}
