#!/usr/bin/env bash
set -e

gas=false
verbose=false

while getopts d:g:p:t:v flag; do
	case "${flag}" in
	d) directory=${OPTARG} ;;
	g) gas=true ;;
	p) profile=${OPTARG} ;;
	t) test=${OPTARG} ;;
	v) verbose=true ;;
	esac
done

export FOUNDRY_PROFILE=$profile
echo Using profile: $FOUNDRY_PROFILE
echo Higher verbosity: $verbose
echo Gas report: $gas
echo Test Match pattern: $test

if [ "$verbose" = false ]; then
	verbosity="-vv"
else
	verbosity="-vvvv"
fi

if [ "$gas" = false ];
then
    gasReport=""
else
    gasReport="--gas-report"
fi

# Tests deploy the T-REX suite by artifact name (deployCode), so build script/ too; filtered
# forge test runs only compile the files they import.
forge build

if [ -z "$test" ]; then
	if [ -z "$directory" ]; then
		forge test --match-path "test/*" $gasReport $verbosity
	else
		forge test --match-path "$directory/*.t.sol" $gasReport $verbosity
	fi
else
	forge test --match-test "$test" $gasReport $verbosity
fi
