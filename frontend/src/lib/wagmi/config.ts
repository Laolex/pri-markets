import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { http } from "wagmi";
import { sepolia } from "wagmi/chains";
import { SEPOLIA_RPC } from "@/lib/contracts/config";

export const wagmiConfig = getDefaultConfig({
  appName: "Confidential Batch Clearing",
  projectId: process.env.VITE_WALLETCONNECT_PROJECT_ID ?? "confidential-batch-auction", // TODO: set VITE_WALLETCONNECT_PROJECT_ID from cloud.walletconnect.com
  chains: [sepolia],
  transports: { [sepolia.id]: http(SEPOLIA_RPC) }, // reliable RPC; default public endpoint is rate-limited
  ssr: false,
});
