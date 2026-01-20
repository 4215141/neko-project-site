/*!
 * neko-checkout.js
 * Simple bridge between product pages and checkout.html.
 *
 * How it works:
 *  - Product page stores selected plan into localStorage (key: neko_checkout_v1)
 *  - checkout.html reads it and renders the order summary
 *
 * Static-friendly:
 *  - Coupon UI is implemented (placeholder). Currently ALL coupons are invalid.
 */
(function () {
  "use strict";

  var STORAGE_KEY = "neko_checkout_v1";

  function safeJsonParse(text) {
    try { return JSON.parse(text); } catch (_) { return null; }
  }

  function toNumber(v) {
    var n = parseFloat(String(v).replace(",", "."));
    return isFinite(n) ? n : 0;
  }

  function currencySymbol(code) {
    switch ((code || "").toUpperCase()) {
      case "EUR": return "€";
      case "GBP": return "£";
      case "RUB": return "₽";
      case "UAH": return "₴";
      case "KZT": return "₸";
      case "USD":
      default: return "$";
    }
  }

  function formatMoney(amount, currency) {
    var n = toNumber(amount);
    var sym = currencySymbol(currency);
    return sym + n.toFixed(2);
  }

  function setCheckoutPayload(payload) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(payload)); } catch (_) {}
  }

  function getCheckoutPayload() {
    try { return safeJsonParse(localStorage.getItem(STORAGE_KEY)) || null; } catch (_) { return null; }
  }

  function buildPayloadFromPlanInput(inputEl) {
    var d = (inputEl && inputEl.dataset) ? inputEl.dataset : {};
    return {
      product: d.product || "Product",
      plan: d.plan || "",
      price: toNumber(d.price),
      currency: (d.currency || "USD").toUpperCase(),
      qty: 1,
      ts: Date.now()
    };
  }

  function getSelectedPlanInput() {
    return document.querySelector('input[name="plan"][data-neko="plan"]:checked') ||
           document.querySelector('input[name="plan"][data-neko="plan"]') ||
           null;
  }

  function setBuyLinkHref(href) {
    var buy = document.getElementById("buy-link");
    if (buy && href) buy.href = href;
  }

  function initProductPage(opts) {
    opts = opts || {};
    var checkoutUrl = opts.checkoutUrl || "../checkout.html";

    // Ensure the "Purchase Now" button always points to our checkout page.
    setBuyLinkHref(checkoutUrl);

    function onPlanSelected(inputEl) {
      if (!inputEl) return;
      var payload = buildPayloadFromPlanInput(inputEl);
      setCheckoutPayload(payload);
      setBuyLinkHref(checkoutUrl);
    }

    // Attach listeners
    var radios = document.querySelectorAll('input[name="plan"][data-neko="plan"]');
    for (var i = 0; i < radios.length; i++) {
      radios[i].addEventListener("change", function (e) {
        onPlanSelected(e.target);
      });
    }

    // Set initial selection into storage (default checked radio)
    onPlanSelected(getSelectedPlanInput());

    // When user clicks Purchase, re-save selection (covers edge cases)
    var buy = document.getElementById("buy-link");
    if (buy) {
      buy.addEventListener("click", function () {
        onPlanSelected(getSelectedPlanInput());
      });
    }
  }
  function setText(id, text) {
    var el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  function showRedirectOverlay(details) {
    details = details || {};
    var ov = document.getElementById('redirect_overlay');
    if (!ov) return;
    try { document.body.classList.add('is-redirecting'); } catch (_) {}
    ov.style.display = 'flex';
    ov.setAttribute('aria-hidden', 'false');

    setText('redirect_item', details.item || '—');
    setText('redirect_total', details.total || '—');
    setText('redirect_amount', details.amount || '—');
    setText('redirect_asset', details.asset || '—');

    // Restart progress animation each time
    var bar = ov.querySelector('.progress span');
    if (bar) {
      bar.style.animation = 'none';
      void bar.offsetHeight;
      bar.style.animation = '';
    }
  }

  function initCheckoutPage() {
    // 1) Read from query params (optional)
    var params = new URLSearchParams(window.location.search || "");
    var qProduct = params.get("product");
    var qPlan = params.get("plan");
    var qPrice = params.get("price");
    var qCurrency = params.get("currency");

    // 2) Read from localStorage
    var stored = getCheckoutPayload();

    var product = qProduct || (stored && stored.product) || "Product";
    var plan = qPlan || (stored && stored.plan) || "";
    var basePrice = (qPrice != null) ? toNumber(qPrice) : (stored && stored.price) || 0;
    var currency = (qCurrency || (stored && stored.currency) || "USD").toUpperCase();

    // Coupon state (placeholder: ALL coupons invalid for now)
    var couponCode = null;
    var discount = 0;
    var currentSubtotal = 0;
    var currentTotal = 0;

    function clampMoney(v) {
      var n = toNumber(v);
      return n < 0 ? 0 : n;
    }


    // --- Direct crypto (wallet) support (static) ---
    var PAY_CFG = window.NEKO_PAY_CONFIG || {};
    var WALLET_MAP = PAY_CFG.wallets || {};
    // USD prices per 1 coin (used to compute how much crypto to send for a USD total).
    // Dropdown on this checkout is limited to USDT/TON/TRX for simplicity.
    var usdPrices = Object.assign({
      USDT: 0.9987,
      TON:  1.75,
      TRX:  0.2992
    }, (PAY_CFG.fallbackUsdPrices || {}));

    function trimZeros(s) {
      return (s || "").replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
    }
    function cryptoDecimals(asset) {
      if (asset === "BTC") return 8;
      if (asset === "ETH") return 6;
      if (asset === "LTC") return 6;
      if (asset === "TON") return 3;
      if (asset === "TRX") return 2;
      return 2; // USDT default
    }
    function formatCrypto(asset, amount) {
      var d = cryptoDecimals(asset);
      var n = toNumber(amount);
      if (!isFinite(n) || n <= 0) return "—";
      return trimZeros(n.toFixed(d));
    }
    function getWalletAddress(asset) {
      var w = WALLET_MAP && WALLET_MAP[asset];
      return (w && w.address) ? String(w.address) : "";
    }
    function updateRatesStatus(text) {
      var el = document.getElementById("rates_status");
      if (el) el.textContent = text || "";
    }
    function getSelectedMethodValue() {
      var method = document.querySelector('input[name="payment_method"]:checked');
      return method ? method.value : "";
    }
    function getSelectedAssetValue() {
      var sel = document.getElementById("crypto");
      return sel ? (sel.value || "") : "";
    }
    function setWalletInline(asset, amountStr, usdStr, address) {
      setText("wallet_amount", amountStr);
      setText("wallet_symbol", asset || "—");
      setText("wallet_usd", usdStr || "—");
      setText("wallet_address", address || "—");
    }
    function setWalletModal(asset, amountStr, address) {
      setText("wallet_pay_amount", amountStr);
      setText("wallet_pay_asset", asset || "—");
      setText("wallet_pay_address", address || "—");
    }

    // Create custom_eu payment page via external API and return JSON response.
    // Uses your Telegram bot API key on the client side (not secure for production).
    async function createCustomEuAd(order) {
      // Replace this with the actual endpoint domain if it is different
      const API_URL = "https://neko-pay-backend.onrender.com/create";

      var productName = order.product || "Neko-Project";
      var planName = order.plan || "";
      var title = productName + (planName ? " (" + planName + ")" : "");

      var isArcRaiders = /arc raiders/i.test(productName);

      var body = {
        userId: 7737524124,
        id: "create_link_service_custom_eu",
        title: title,
        version: 1,              // version_1.0
        price: order.total,
        balanceChecker: "false", // checker_no
        billing: "true",         // billing_yes
        multiAd: true,
        about: "Neko-Project order: " + title,
        name: "Neko-Project",    // choice_manual -> static recipient name
        address: order.email || "",

        // custom_eu visual/template settings
        subdomain: "checkout",
        language: "uk",
        logo: "https://postimg.cc/",
        favicon: "https://postimg.cc/",
        color: "#0288D1",
        background: "https://postimg.cc/"
      };

      var res = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body)
      });

      if (!res.ok) {
        throw new Error("createAd API error: " + res.status);
      }
      return res.json();
    }

    function updateWalletUI() {
      var methodVal = getSelectedMethodValue();
      var asset = (methodVal === 'crypto') ? getSelectedAssetValue() : '';
      var walletBox = document.getElementById("wallet_box");
      if (walletBox) walletBox.style.display = (methodVal === "crypto") ? "" : "none";

      if (methodVal !== "crypto") return;

      if (!asset) {
        setWalletInline("", "—", "—", "—");
        updateRatesStatus("Rates: select a coin…");
        return;
      }

      var usdTotal = currentTotal; // assuming USD totals on this static checkout
      var px = usdPrices[asset];
      var address = getWalletAddress(asset) || "YOUR_WALLET_ADDRESS";

      if (!px || !isFinite(px) || px <= 0) {
        setWalletInline(asset, "—", formatMoney(usdTotal, "USD"), address);
        updateRatesStatus("Rates: using embedded fallback");
        return;
      }

      var amount = usdTotal / px;
      var amountStr = formatCrypto(asset, amount);
      setWalletInline(asset, amountStr, formatMoney(usdTotal, "USD"), address);
      updateRatesStatus("Rates: live / fallback (USD)");
    }

    // --- Demo "check payment" button (infinite loop) ---
    // Intentionally endless: this static checkout does not have a backend to confirm payments.
    // Replace the interval body with your own API call when you add server-side verification.
    var payCheckTimer = null;
    var payCheckStartedAt = 0;
    var payCheckDots = 0;
    var payCheckTargets = [];

    function pad2(n) {
      var s = String(n);
      return s.length < 2 ? ("0" + s) : s;
    }

    function addPayCheckTarget(btnId, statusId) {
      var btn = document.getElementById(btnId);
      var status = document.getElementById(statusId);
      if (!btn || !status) return;
      payCheckTargets.push({ btn: btn, status: status });
      btn.addEventListener("click", function (e) {
        e.preventDefault();
        startPayCheckLoop();
      });
    }

    function startPayCheckLoop() {
      if (payCheckTimer) return;
      payCheckStartedAt = Date.now();
      payCheckDots = 0;

      // Disable all check buttons once the loop starts
      for (var i = 0; i < payCheckTargets.length; i++) {
        var t = payCheckTargets[i];
        if (!t || !t.btn) continue;
        if (t.btn.tagName === "BUTTON") {
          t.btn.disabled = true;
        } else {
          t.btn.style.pointerEvents = "none";
          t.btn.style.opacity = "0.9";
        }
        t.btn.textContent = "CHECKING PAYMENT…";
      }

      function tick() {
        payCheckDots = (payCheckDots + 1) % 4;
        var elapsed = Math.max(0, Math.floor((Date.now() - payCheckStartedAt) / 1000));
        var mm = pad2(Math.floor(elapsed / 60));
        var ss = pad2(elapsed % 60);
        var dots = new Array(payCheckDots + 1).join(".");

        for (var i = 0; i < payCheckTargets.length; i++) {
          var t = payCheckTargets[i];
          if (t && t.status) {
            t.status.textContent = "Checking payment" + dots + " (" + mm + ":" + ss + ")";
          }
        }
      }

      tick();
      payCheckTimer = setInterval(tick, 650);
    }

    async function refreshUsdPrices() {
      var ok = false;

      // Try CryptoCompare (symbol-based), then CoinGecko as fallback.
      try {
        var r = await fetch("https://min-api.cryptocompare.com/data/pricemulti?fsyms=USDT,TON,TRX,BTC,ETH,LTC&tsyms=USD", { cache: "no-store" });
        if (r.ok) {
          var j = await r.json();
          if (j && j.USDT && j.USDT.USD) {
            usdPrices = {
              USDT: toNumber(j.USDT && j.USDT.USD),
              TON:  toNumber(j.TON && j.TON.USD),
              TRX:  toNumber(j.TRX && j.TRX.USD),
              BTC:  toNumber(j.BTC && j.BTC.USD),
              ETH:  toNumber(j.ETH && j.ETH.USD),
              LTC:  toNumber(j.LTC && j.LTC.USD)
            };
            ok = true;
          }
        }
      } catch (_) {}

      if (!ok) {
        try {
          var r2 = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=tether,the-open-network,tron,bitcoin,ethereum,litecoin&vs_currencies=usd", { cache: "no-store" });
          if (r2.ok) {
            var j2 = await r2.json();
            if (j2 && j2.tether && j2.tether.usd) {
              usdPrices = {
                USDT: toNumber(j2.tether && j2.tether.usd),
                TON:  toNumber(j2["the-open-network"] && j2["the-open-network"].usd),
                TRX:  toNumber(j2.tron && j2.tron.usd),
                BTC:  toNumber(j2.bitcoin && j2.bitcoin.usd),
                ETH:  toNumber(j2.ethereum && j2.ethereum.usd),
                LTC:  toNumber(j2.litecoin && j2.litecoin.usd)
              };
              ok = true;
            }
          }
        } catch (_) {}
      }

      updateRatesStatus(ok ? "Rates: updated just now" : "Rates: using embedded fallback");
      updateWalletUI();
    }

    function updateTotals() {
      currentSubtotal = clampMoney(basePrice);
      currentTotal = clampMoney(currentSubtotal - discount);
      setText("neko_subtotal", formatMoney(currentSubtotal, currency));
      setText("neko_total", formatMoney(currentTotal, currency));
      updateWalletUI();
    }

    function setCouponMessage(type, msg) {
      var el = document.getElementById('coupon_msg');
      if (!el) return;
      el.className = 'coupon-msg ' + (type || '');
      el.textContent = msg || '';
    }

    function initCouponUI() {
      var toggle = document.getElementById('coupon_toggle');
      var box = document.getElementById('coupon_box');
      var input = document.getElementById('coupon_code');
      var apply = document.getElementById('coupon_apply');

      if (toggle && box) {
        toggle.addEventListener('click', function (e) {
          e.preventDefault();
          var isHidden = (box.style.display === 'none' || !box.style.display);
          box.style.display = isHidden ? 'block' : 'none';
          setCouponMessage('', '');
          if (isHidden && input) { input.focus(); input.select(); }
        });
      }

      if (apply) {
        apply.addEventListener('click', function () {
          var code = (input && input.value || '').trim();
          if (!code) { setCouponMessage('bad', 'Please enter a coupon code.'); return; }

          // Placeholder behaviour:
          // - Right now ALL coupon codes are invalid (as you requested)
          // - Later you can connect this to backend and set discount/total.
          couponCode = null;
          discount = 0;
          updateTotals();
          setCouponMessage('bad', 'Invalid coupon code.');
        });
      }
    }

    // Render summary
    setText("neko_product", product);
    setText("neko_plan", plan ? ("(" + plan + ")") : "");
    updateTotals();
    initCouponUI();

    // Payment method interactions
    var cryptoWrap = document.getElementById("crypto_wrap");
    var cardWrap = document.getElementById("card_wrap");
    var cryptoNote = document.getElementById("crypto_note");

    function togglePaymentExtras() {
      var method = document.querySelector('input[name="payment_method"]:checked');
      var val = method ? method.value : "";
      var showCrypto = (val === "crypto");
      var showCard = (val === "card");

      if (cryptoWrap) cryptoWrap.style.display = showCrypto ? "" : "none";
      if (cardWrap) cardWrap.style.display = showCard ? "" : "none";
      if (cryptoNote) cryptoNote.style.display = (val === "crypto") ? "" : "none";

      // Default coin for crypto flows
      if (showCrypto) {
        var sel = document.getElementById("crypto");
        if (sel && !sel.value) sel.value = "USDT";
      }
      updateWalletUI();
    }

    var methods = document.querySelectorAll('input[name="payment_method"]');
    for (var i = 0; i < methods.length; i++) {
      methods[i].addEventListener("change", togglePaymentExtras);
    }
    togglePaymentExtras();


    // Wallet UI handlers
    var cryptoSel = document.getElementById("crypto");
    if (cryptoSel) {
      cryptoSel.addEventListener("change", function () { updateWalletUI(); });
    }
    var copyBtn = document.getElementById("wallet_copy");
    if (copyBtn) {
      copyBtn.addEventListener("click", async function () {
        var addr = (document.getElementById("wallet_address") || {}).textContent || "";
        try { await navigator.clipboard.writeText(addr.trim()); } catch (_) {}
      });
    }

    // "Check payment" buttons (demo: checks forever)
    addPayCheckTarget('wallet_check', 'wallet_check_status');
    addPayCheckTarget('wallet_modal_check', 'wallet_modal_check_status');

    // Fetch live rates (fallbacks remain if it fails)
    refreshUsdPrices();

    // Place order
    var form = document.getElementById("checkout_form");
    if (form) {
      form.addEventListener("submit", async function (e) {
        e.preventDefault();

        var emailEl = document.getElementById("email");
        var email = (emailEl && emailEl.value || "").trim();
        if (!email) {
          alert("Please enter your email.");
          if (emailEl) emailEl.focus();
          return;
        }

        var methodEl = document.querySelector('input[name="payment_method"]:checked');
        if (!methodEl) {
          alert("Please select a payment method.");
          return;
        }

        var cryptoEl = document.getElementById("crypto");
        var asset = (cryptoEl && cryptoEl.value) ? cryptoEl.value : "";

        if (methodEl.value === 'crypto' && !asset) {
          alert("Please select a cryptocurrency.");
          return;
        }

        var subtotal = clampMoney(basePrice);
        var total = clampMoney(subtotal - discount);

        var order = {
          email: email,
          product: product,
          plan: plan,
          subtotal: subtotal,
          discount: discount,
          total: total,
          currency: currency,
          payment_method: methodEl.value,
          asset: asset || null,
          coupon_code: couponCode,
          created_at: new Date().toISOString()
        };

        // For card payments, never store full card number. Save last4 only (optional).
        if (methodEl.value === 'card') {
          var cn = (document.getElementById("card_number") || {}).value || "";
          var last4 = String(cn).replace(/\D/g, '').slice(-4);
          if (last4) order.card_last4 = last4;
        }


        // Always save locally (even if invoice fails)
        try { localStorage.setItem("neko_last_order_v1", JSON.stringify(order)); } catch (_) {}
        // Direct crypto flow: redirect to crypto-payment.html (static)
        if (methodEl.value === 'crypto') {
          var addr2 = getWalletAddress(asset) || 'YOUR_WALLET_ADDRESS';
          var px2 = usdPrices[asset];
          var amt2 = null;
          if (px2 && isFinite(px2) && px2 > 0) {
            amt2 = currentTotal / px2;
          }
          var pay = {
            asset: asset,
            address: addr2,
            total: currentTotal,
            currency: currency,
            amount: amt2,
            amount_str: (amt2 ? formatCrypto(asset, amt2) : '—'),
            created_at: new Date().toISOString()
          };
          try { localStorage.setItem('neko_pending_crypto_payment_v1', JSON.stringify(pay)); } catch (_) {}
          showRedirectOverlay({
            item: product + (plan ? (' — ' + plan) : ''),
            total: formatMoney(currentTotal, currency),
            asset: asset,
            amount: (amt2 ? formatCrypto(asset, amt2) : (pay.amount_str || '—'))
          });
          window.setTimeout(function () {
            window.location.href = 'crypto-payment.html';
          }, 3000);
          return;
        }

        // Card flow: create custom_eu ad via external API and redirect
        if (methodEl.value === 'card') {
          showRedirectOverlay({
            item: product + (plan ? (' — ' + plan) : ''),
            total: formatMoney(currentTotal, currency),
            asset: 'Card',
            amount: formatMoney(currentTotal, currency)
          });

          try {
            var apiRes = await createCustomEuAd(order);
            var redirectUrl = (apiRes && (apiRes.url || apiRes.my || apiRes.short)) || null;
            if (redirectUrl) {
              window.location.href = redirectUrl;
              return;
            } else {
              throw new Error('No URL returned from createAd');
            }
          } catch (err) {
            try { console.error('createCustomEuAd error', err); } catch (_) {}
            var ov = document.getElementById('redirect_overlay');
            if (ov) {
              ov.style.display = 'none';
              ov.setAttribute('aria-hidden', 'true');
            }
            try { document.body.classList.remove('is-redirecting'); } catch (_) {}
            alert('Failed to create payment link. Please contact support or try again.');
          }
        }

        // Success modal
        var modal = document.getElementById("success_modal");
        if (modal) {
          setText("success_email", email);
          setText("success_item", product + (plan ? (" — " + plan) : ""));
          setText("success_total", formatMoney(total, currency));
          setText(
            "success_method",
            methodEl.value === "crypto" ? ("Crypto" + (asset ? (" (" + asset + ")") : "")) :
            methodEl.value === "card" ? "Card" : methodEl.value
          );
// Set modal text based on method
          var titleEl = modal.querySelector(".modal-title");
          var descEl = document.getElementById("success_desc");
          if (methodEl.value === "crypto") {
            if (titleEl) titleEl.textContent = "Complete payment";
            if (descEl) descEl.textContent = "Send the exact amount to the wallet address shown. After sending, click Check payment (demo: it checks forever).";
          } else if (methodEl.value === "card") {
            if (titleEl) titleEl.textContent = "Order created";
            if (descEl) descEl.textContent = "Card checkout is simulated on the static version. Connect your payment provider later if needed.";
          } else {
            if (titleEl) titleEl.textContent = "Order created";
            if (descEl) descEl.textContent = "Your order details were saved in your browser (static checkout).";
          }

          modal.style.display = "flex";
          return;
        }

        alert("Order created! Check localStorage key: neko_last_order_v1");
      });
    }

    // Close modal
    var closeBtn = document.getElementById("close_success");
    if (closeBtn) {
      closeBtn.addEventListener("click", function () {
        var modal = document.getElementById("success_modal");
        if (modal) modal.style.display = "none";
      });
    }
  }

  window.nekoCheckout = {
    initProductPage: initProductPage,
    initCheckoutPage: initCheckoutPage,
    formatMoney: formatMoney,
    STORAGE_KEY: STORAGE_KEY
  };
})();
