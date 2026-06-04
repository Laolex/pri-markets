import { createConfig, http } from "wagmi";
import { sepolia } from "wagmi/chains";
import { connectorsForWallets } from "@rainbow-me/rainbowkit";
import {
  injectedWallet,
  metaMaskWallet,
  rabbyWallet,
  walletConnectWallet,
} from "@rainbow-me/rainbowkit/wallets";
import { SEPOLIA_RPC } from "@/lib/contracts/config";

// Vite exposes env via import.meta.env, NOT process.env. A WalletConnect/Reown
// projectId must be a real 32-hex id from cloud.reown.com — anything else 403s and
// produces a half-initialized connector (the infamous `connector.getChainId is not a
// function` on write). So WalletConnect is OPT-IN: included only when a real id is set.
const wcProjectId = (
  import.meta.env.VITE_WALLETCONNECT_PROJECT_ID as string | undefined
)?.trim();

// injected + MetaMask + Rabby need no projectId — these cover the Sepolia demo path.
const wallets = [
  injectedWallet,
  metaMaskWallet,
  rabbyWallet,
  ...(wcProjectId ? [walletConnectWallet] : []),
];

const connectors = connectorsForWallets(
  [{ groupName: "Connect a wallet", wallets }],
  { appName: "Confidential Batch Clearing", projectId: wcProjectId ?? "" },
);

export const wagmiConfig = createConfig({
  connectors,
  chains: [sepolia],
  transports: { [sepolia.id]: http(SEPOLIA_RPC) }, // reliable RPC; default public endpoint is rate-limited
  ssr: false,
});
