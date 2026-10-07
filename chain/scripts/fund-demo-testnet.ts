// Fund isolated demo roles with test coins only. Receipts make reruns recoverable.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { network } from 'hardhat';
import { getAddress, parseEther, type Hex } from 'viem';

const { viem, networkName } = await network.create();
const client = await viem.getPublicClient();
if (networkName !== 'botTestnet' || await client.getChainId() !== 968) throw new Error('Demo funding is testnet 968 only');
const targets = (process.env['DEMO_FUND_TARGETS'] ?? '').split(',').filter(Boolean).map(value => getAddress(value));
if (!targets.length || targets.length > 3 || new Set(targets).size !== targets.length) throw new Error('Specify 1–3 distinct DEMO_FUND_TARGETS');
const file = process.env['DEMO_FUND_JOURNAL'];
if (!file) throw new Error('Specify an absolute DEMO_FUND_JOURNAL path');
if (!file.startsWith('/')) throw new Error('Journal path must be absolute');
const rows: Record<string, Hex> = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
const [sender] = await viem.getWalletClients();
if (!sender) throw new Error('No testnet deployer');
const floor = parseEther('0.05');
for (const address of targets) {
  const previous = rows[address];
  if (previous) {
    const receipt = await client.waitForTransactionReceipt({ hash: previous });
    if (receipt.status !== 'success') throw new Error(`Previous funding reverted: ${previous}`);
    console.log(JSON.stringify({ address, transaction: previous, status: 'already_funded' }));
    continue;
  }
  const balance = await client.getBalance({ address });
  if (balance >= floor) { console.log(JSON.stringify({ address, status: 'sufficient_balance' })); continue; }
  const hash = await sender.sendTransaction({ to: address, value: floor - balance });
  rows[address] = hash;
  writeFileSync(file, JSON.stringify(rows, null, 2), { mode: 0o600 });
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') throw new Error(`Funding reverted: ${hash}`);
  console.log(JSON.stringify({ address, transaction: hash, valueWei: (floor - balance).toString(), status: 'funded' }));
}
