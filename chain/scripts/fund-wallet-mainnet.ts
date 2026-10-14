// Send a small amount of mainnet BOT from the deployer to one wallet, so a
// person can try the site with their own browser wallet (gas, a cheap Skill).
// Preview unless FUND_CONFIRM=1; capped at 0.05 BOT per run.
//
//   FUND_TO=0x… FUND_AMOUNT=0.02 npx hardhat run --network botMainnet scripts/fund-wallet-mainnet.ts
//   FUND_TO=0x… FUND_AMOUNT=0.02 FUND_CONFIRM=1 npx hardhat run --network botMainnet scripts/fund-wallet-mainnet.ts
import { network } from 'hardhat';
import { formatEther, getAddress, parseEther } from 'viem';

const { viem, networkName } = await network.create();
const client = await viem.getPublicClient();
if (networkName !== 'botMainnet' || await client.getChainId() !== 677) throw new Error('This script only funds on BOT Chain Mainnet (677)');
const to = getAddress(process.env['FUND_TO'] ?? '');
const amount = parseEther(process.env['FUND_AMOUNT'] ?? '0.02');
if (amount <= 0n || amount > parseEther('0.05')) throw new Error('FUND_AMOUNT must be above 0 and at most 0.05 BOT');
const [sender] = await viem.getWalletClients();
if (!sender) throw new Error('No mainnet deployer configured (BOT_DEPLOYER_PRIVATE_KEY)');
const [from, to0] = [await client.getBalance({ address: sender.account.address }), await client.getBalance({ address: to })];
console.log(JSON.stringify({ from: sender.account.address, fromBalance: formatEther(from), to, toBalance: formatEther(to0), amount: formatEther(amount) }, null, 2));
if (process.env['FUND_CONFIRM'] !== '1') {
  console.log('Preview only. Re-run with FUND_CONFIRM=1 to send.');
} else {
  const hash = await sender.sendTransaction({ to, value: amount });
  const receipt = await client.waitForTransactionReceipt({ hash });
  console.log(JSON.stringify({ status: receipt.status, transaction: hash, explorer: `https://scan.botchain.ai/tx/${hash}` }, null, 2));
}
