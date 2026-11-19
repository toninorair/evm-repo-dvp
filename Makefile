# include .env file and export its env vars
# (-include to ignore error if it does not exist)
-include .env

profile ?= default

# dapp deps
update:; forge update

# DRY_RUN=true simulates without sending anything.
ifeq ($(DRY_RUN),true)
	BROADCAST_FLAGS =
else
	BROADCAST_FLAGS = --broadcast --verify
endif

# Deployment helpers (add deploy scripts under script/deploy)

# Run tests
build:
	@./build.sh -p production

tests:
	@./test.sh -p $(profile)

fuzz:
	@./test.sh -t testFuzz -p $(profile)

integration:
	@./test.sh -d test/integration -p $(profile)

invariant:
	@./test.sh -d test/invariant -p $(profile)

coverage:
	FOUNDRY_PROFILE=$(profile) forge coverage --report lcov && lcov --ignore-errors inconsistent --extract lcov.info -o lcov.info 'src/*' && genhtml lcov.info -o coverage

gas-report:
	FOUNDRY_PROFILE=$(profile) forge test --gas-report > gasreport.ansi

sizes:
	@./build.sh -p production -s

clean:
	forge clean && rm -rf ./abi && rm -rf ./bytecode && rm -rf ./types
