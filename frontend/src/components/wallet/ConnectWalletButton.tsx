import { ConnectButton } from "@rainbow-me/rainbowkit";
import { WALLETCONNECT_DISABLED_BAD_ID } from "@/lib/wagmi/config";

export function ConnectWalletButton() {
  return (
    <div className="flex flex-col items-end gap-1">
      <ConnectButton
        chainStatus="icon"
        showBalance={false}
        accountStatus="address"
      />
      {WALLETCONNECT_DISABLED_BAD_ID && (
        <span
          className="font-mono text-[8px] tracking-wider text-crimson/70"
          title="VITE_WALLETCONNECT_PROJECT_ID is not a valid 32-hex Reown id. Unset it or use a real id from cloud.reown.com."
        >
          WALLETCONNECT DISABLED · BAD PROJECT ID
        </span>
      )}
    </div>
  );
}
