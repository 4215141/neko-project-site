// Payment config for the static checkout.
// 1) Put YOUR wallet addresses below.
// 2) Optionally tweak fallbackUsdPrices (used if live rate fetch fails).
// NOTE: For USDT, use the address for the network YOU accept (e.g., TRC20).
window.NEKO_PAY_CONFIG = {
  updatedAt: "2026-01-13T00:00:00Z",
  wallets: {
    // Provided wallets
    USDT: { address: "TEbZVPG6RJ7HxVYjCVJS6BRfqeoyRByWGC" },
    TON:  { address: "UQB4bZ7IiOVLAYvaighO7Vu6dJeAHkokuDR4w5yY46NXV0dM" },
    TRX:  { address: "TEbZVPG6RJ7HxVYjCVJS6BRfqeoyRByWGC" },
    BTC:  { address: "bc1q6k7q3hzww7t7e4c6k5t7c4y9yxmnqlmjvawerr" },
    ETH:  { address: "0xb9f48aD5425CE04b6c43DbF2F9D603201b334F91" },
    LTC:  { address: "ltc1q6p2c0d7jn9rdsa763ly293nv4y2q4tmuaszccy" }
  },
  fallbackUsdPrices: {
    USDT: 0.9987,
    TON:  1.75,
    TRX:  0.2992,
    BTC:  90233.26,
    ETH:  3108.61,
    LTC:  79.22
  }
};
