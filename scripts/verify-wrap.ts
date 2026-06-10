/**
 * verify-wrap.ts — proves the on-chain half of the bet flow really works on Sepolia:
 * mint USDC -> approve -> wrap(to,amount) -> setOperator(auction). Everything except the
 * browser-only FHE encrypt + placeBet. Run with the deployer wallet.
 */
import { ethers } from "hardhat";

const AUCTION = "0xc9E6798c8f25E288e6d578B180AD0F5Fe7Dea935";
const USDC    = "0x9b5Cd13b8eFbB58Dc25A05CF411D8056058aDFfF";
const CUSDC   = "0x7c5BF43B851c1dff1a4feE8dB225b87f2C223639";
const AMT     = 10_000_000n; // 10 USDC (6 decimals)

async function main() {
  const [s] = await ethers.getSigners();
  const me = s.address;
  console.log("Wallet:", me);

  const usdc = new ethers.Contract(USDC, [
    "function mint(address,uint256)",
    "function approve(address,uint256) returns (bool)",
    "function balanceOf(address) view returns (uint256)",
  ], s);
  const cusdc = new ethers.Contract(CUSDC, [
    "function wrap(address to, uint256 amount)",
    "function setOperator(address operator, uint48 until)",
    "function isOperator(address holder, address spender) view returns (bool)",
  ], s);

  const bal = await usdc.balanceOf(me);
  if (bal < AMT) {
    console.log("minting 1000 USDC…");
    await (await usdc.mint(me, 1_000_000_000n)).wait();
  }
  console.log("USDC balance:", ethers.formatUnits(await usdc.balanceOf(me), 6));

  console.log("approve cUSDC to spend USDC…");
  await (await usdc.approve(CUSDC, AMT)).wait();

  console.log("wrap 10 USDC -> cUSDC…");
  const wtx = await cusdc.wrap(me, AMT);
  const wr = await wtx.wait();
  console.log("  wrap OK ✓ gas=", wr.gasUsed.toString(), "tx=", wtx.hash);

  if (!(await cusdc.isOperator(me, AUCTION))) {
    console.log("setOperator(auction)…");
    const until = Math.floor(Date.now() / 1000) + 365 * 24 * 3600;
    await (await cusdc.setOperator(AUCTION, until)).wait();
  }
  console.log("isOperator(me, auction):", await cusdc.isOperator(me, AUCTION));
  console.log("\nOn-chain half verified: mint -> approve -> wrap -> setOperator all succeed.");
}
main().catch((e) => { console.error(e); process.exit(1); });
