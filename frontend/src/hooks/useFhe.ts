import { useCallback, useEffect } from "react";
import { useAccount } from "wagmi";
import { initFheInstance } from "@/lib/fhe/encrypt";
import { useAppStore } from "@/store/appStore";
import { getErrMsg } from "@/lib/errors";

export function useFhe() {
  const { address, isConnected } = useAccount();
  const { fhevmInst, fheStatus, fheError, setFhevmInst, setFheStatus, setFheError } =
    useAppStore();

  const init = useCallback(() => {
    setFheStatus("initializing");
    initFheInstance()
      .then((inst) => setFhevmInst(inst))
      .catch((err) => setFheError(getErrMsg(err)));
  }, [setFhevmInst, setFheStatus, setFheError]);

  useEffect(() => {
    // Auto-init once a wallet is connected. Skip if an instance already exists or one is
    // in flight. An "error" status does NOT auto-retry (that could hammer a down relayer) —
    // the consumer drives recovery via the returned `retry()`.
    if (!isConnected || !address || fhevmInst || fheStatus === "initializing" || fheStatus === "error") return;
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected, address]);

  // Manual recovery after a failed/aborted init (e.g. relayer was briefly down).
  const retry = useCallback(() => {
    if (fheStatus === "initializing") return;
    setFheError(null);
    init();
  }, [fheStatus, init, setFheError]);

  return { fhevmInst, fheStatus, fheError, isReady: fheStatus === "ready", retry };
}
