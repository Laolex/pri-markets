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
// projectId must be a real 32-hex id from cloud.reown.com — anything else (empty,
// placeholder, revoked, truncated) 403s and produces a half-initialized connector
// (the infamous `connector.getChainId is not a function` on write). So WalletConnect is
// OPT-IN and we validate the FORMAT, not just presence: a malformed id falls back to
// injected/MetaMask/Rabby instead of crashing every write.
const rawWcProjectId = (
  import.meta.env.VITE_WALLETCONNECT_PROJECT_ID as string | undefined
)?.trim();
const wcProjectId =
  rawWcProjectId && /^[0-9a-f]{32}$/i.test(rawWcProjectId) ? rawWcProjectId : undefined;

// True when an id WAS provided but is malformed — surfaced in the UI (not just console)
// so whoever set the bad env var knows WalletConnect was silently disabled.
export const WALLETCONNECT_DISABLED_BAD_ID = !!rawWcProjectId && !wcProjectId;
if (WALLETCONNECT_DISABLED_BAD_ID) {
  // eslint-disable-next-line no-console
  console.warn(
    "[wagmi] VITE_WALLETCONNECT_PROJECT_ID is set but not a valid 32-hex Reown id — " +
      "ignoring it and disabling WalletConnect to avoid the `connector.getChainId` crash.",
  );
}

// injected + MetaMask + Rabby need no projectId — these cover the Sepolia demo path.
const wallets = [
  injectedWallet,
  metaMaskWallet,
  rabbyWallet,
  ...(wcProjectId ? [walletConnectWallet] : []),
];

const connectors = connectorsForWallets(
  [{ groupName: "Connect a wallet", wallets }],
  { appName: "Pri-Markets", projectId: wcProjectId ?? "" },
);

export const wagmiConfig = createConfig({
  connectors,
  chains: [sepolia],
  transports: { [sepolia.id]: http(SEPOLIA_RPC) }, // reliable RPC; default public endpoint is rate-limited
  ssr: false,
});
