#!/usr/bin/env bash
# Deploys the full stack to a local anvil node (`make local-chain`) and points the settlement console at it.
# Anvil's default accounts are used: #0 deployer and NAV agent, #1 borrower, #2 lender. These keys are public test keys.
set -euo pipefail

RPC=http://127.0.0.1:8545
DEPLOYER_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
BORROWER=0x70997970C51812dc3A010C7d01b50e0d17dc79C8
LENDER=0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC

if ! cast chain-id --rpc-url "$RPC" >/dev/null 2>&1; then
  echo "No node at $RPC. Start one first with: make local-chain" >&2
  exit 1
fi

cd "$(dirname "$0")/../.."
log=$(mktemp)
if ! PRIVATE_KEY=$DEPLOYER_KEY BORROWER_ADDRESS=$BORROWER LENDER_ADDRESS=$LENDER \
  forge script script/deploy/DeployAll.s.sol --rpc-url "$RPC" --broadcast >"$log" 2>&1; then
  tail -20 "$log" >&2
  exit 1
fi

repo=$(grep -oE 'RepoDvP \(Settlement Engine\) deployed at: 0x[0-9a-fA-F]{40}' "$log" | grep -oE '0x[0-9a-fA-F]{40}')
cat >app/.env.local <<EOF
VITE_NETWORK=local
VITE_RPC_URL=$RPC
VITE_REPO_DVP=$repo
VITE_DEPLOY_BLOCK=0
EOF

echo "RepoDvP deployed at $repo. Wrote app/.env.local (overrides app/.env until you delete it)."
echo "Next: npm run app:dev, then import these anvil keys into MetaMask:"
echo "  deployer / NAV agent  0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
echo "  borrower $BORROWER  0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"
echo "  lender   $LENDER  0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a"
