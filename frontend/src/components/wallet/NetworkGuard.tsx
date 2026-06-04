import type { ReactNode } from "react";
import { useAccount, useChainId } from "wagmi";
import { CHAIN_ID } from "@/lib/contracts/config";

export function NetworkGuard({ children }: { children: ReactNode }) {
  const { isConnected } = useAccount();
  const chainId = useChainId();

  if (!isConnected) return <>{children}</>;

  if (chainId !== CHAIN_ID) {
    return (
      <div className="fixed inset-0 bg-void/95 backdrop-blur-sm flex items-center justify-center z-50">
        <div className="bg-surface border border-gold-border notched-lg p-8 max-w-sm w-full mx-4">
          <div className="font-mono text-[10px] tracking-widest2 text-gold-dim mb-6">
            NETWORK ERROR / CBC-E001
          </div>
          <div className="font-display text-3xl text-gold mb-3">WRONG NETWORK</div>
          <p className="font-body text-ink-secondary text-[14px] leading-relaxed">
            Switch to <span className="font-mono text-ink-primary">Sepolia Testnet</span> to access
            the Pri-Markets protocol.
          </p>
          <div className="mt-6 pt-4 border-t border-wire">
            <div className="font-mono text-[10px] text-ink-dim">CHAIN ID REQUIRED: 11155111</div>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
