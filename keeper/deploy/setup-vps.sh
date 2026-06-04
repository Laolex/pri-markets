#!/usr/bin/env bash
#
# setup-vps.sh — deploy the CBA keeper as a systemd service on the VPS.
# Run as a sudo-capable user (e.g. laolex). Idempotent.
#
#   ssh ubuntu@100.108.240.93   # then: su - laolex
#   curl -fsSL <or scp this file> ; bash setup-vps.sh
#
set -euo pipefail

REPO_DIR=/opt/confidential-batch-auction
BRANCH=prediction-market-v2
ENV_FILE=/etc/cba-keeper.env

echo "==> 1/5  Clone or update the repo at ${REPO_DIR}"
if [ ! -d "${REPO_DIR}/.git" ]; then
  sudo mkdir -p "${REPO_DIR}"
  sudo chown "$(whoami):$(whoami)" "${REPO_DIR}"
  git clone https://github.com/Laolex/confidential-batch-auction.git "${REPO_DIR}"
fi
cd "${REPO_DIR}"
git fetch origin "${BRANCH}"
git checkout "${BRANCH}"
git pull --ff-only origin "${BRANCH}"

echo "==> 2/5  Build the keeper"
cd "${REPO_DIR}/keeper"
npm ci
npm run build

echo "==> 3/5  Ensure ${ENV_FILE} exists (secrets, chmod 600)"
if [ ! -f "${ENV_FILE}" ]; then
  sudo tee "${ENV_FILE}" >/dev/null <<'EOF'
# CBA keeper secrets — DO NOT COMMIT. chmod 600.
KEEPER_PRIVATE_KEY=0xREPLACE_WITH_FUNDED_KEEPER_KEY
SEPOLIA_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com
# ZAMA_RELAYER_URL=https://relayer.testnet.zama.org/v2
EOF
  sudo chmod 600 "${ENV_FILE}"
  echo "    !! Edit ${ENV_FILE} and set KEEPER_PRIVATE_KEY before starting."
fi

echo "==> 4/5  Install the systemd unit"
sudo cp "${REPO_DIR}/keeper/deploy/cba-keeper.service" /etc/systemd/system/cba-keeper.service
sudo systemctl daemon-reload
sudo systemctl enable cba-keeper

echo "==> 5/5  (Re)start the service"
sudo systemctl restart cba-keeper
sleep 2
sudo systemctl --no-pager status cba-keeper | head -15
echo
echo "Logs:  journalctl -u cba-keeper -f"
