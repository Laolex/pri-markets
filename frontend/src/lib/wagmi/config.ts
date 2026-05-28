import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { sepolia } from "wagmi/chains";

export const wagmiConfig = getDefaultConfig({
  appName: "Confidential Batch Clearing",
  projectId: process.env.VITE_WALLETCONNECT_PROJECT_ID ?? "confidential-batch-auction", // TODO: set VITE_WALLETCONNECT_PROJECT_ID from cloud.walletconnect.com
  chains: [sepolia],
  ssr: false,
});
