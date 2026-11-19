# evm-dvp-repo

Smart contracts for tokenized repurchase agreements (repo) with delivery-versus-payment (DvP) settlement on EVM chains.

## Layout

| Path | Purpose |
| --- | --- |
| `src/core` | Core repo agreement / DvP settlement contracts |
| `src/abstract` | Shared abstract base contracts |
| `src/periphery` | Auxiliary contracts (helpers, faucets, adapters) |
| `src/libraries` | Pure/shared libraries |
| `test/{unit,integration,fuzz,invariant}` | Test suites |
| `test/{mock,harness,utils}` | Test support code |
| `script/{deploy,configure,execute}` | Foundry scripts |
| `script/{config,libraries,interfaces}` | Script support code |
| `deploymentConfigs/<chainId>` | Per-chain deployment inputs |
| `deployments/<chainId>.json` | Deployed addresses |
| `audits`, `diagrams` | Audit reports and architecture diagrams |

## Setup

```bash
forge install foundry-rs/forge-std
npm install
cp .env.example .env
```

## Usage

```bash
make build        # compile
make tests        # all tests
make fuzz         # fuzz tests
make integration  # integration tests
make invariant    # invariant tests
make coverage     # lcov coverage
make gas-report   # gas report
```
