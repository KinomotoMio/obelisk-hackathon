// Shared shell of Obelisk's public pages (see site.css): shows which network
// the data on the page comes from, read from this service's GET /v1/chain.

const NETWORK_NAMES = { 677: 'BOT Chain 主网', 968: 'BOT Chain 测试网', 31337: '本地开发链' };

export function networkName(chainId) {
  return NETWORK_NAMES[chainId] ?? `未知网络（${chainId}）`;
}

let chainInfo = null;

/** GET /v1/chain, once per page load; null when the service cannot be reached. */
export function loadChain() {
  chainInfo ??= fetch('/v1/chain', { headers: { accept: 'application/json' } })
    .then((response) => (response.ok ? response.json() : null))
    .catch(() => null);
  return chainInfo;
}

export async function showNetwork() {
  const badge = document.querySelector('[data-site-network]');
  if (!badge) return;
  const chain = await loadChain();
  if (!chain || typeof chain.chainId !== 'number') return;
  badge.textContent = networkName(chain.chainId);
  badge.hidden = false;
}
