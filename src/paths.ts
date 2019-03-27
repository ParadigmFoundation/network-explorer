export const fields = {
    "token/total_supply": {
        updateEvery: 3600000,
        updateFunc: async (_this, paradigm, query, db) => {
            const val = await paradigm.digmToken.totalSupply();
            return val.toString()
        }
    },
    "token/price": {
        updateEvery: 3600000,
        updateFunc: async (_this, paradigm, query, db) => {
            return "0";
        }
    },
    "bandwidth/total_limit": {
        updateEvery: 1800000,
        updateFunc: async (_this, paradigm, query, db) => {
            return await query.call(_this, "round/limit");
        }
    },
    "bandwidth/total_orders": {
        updateEvery: 3000,
        updateFunc: async (_this, paradigm, query, db) => {
            return await query.call(_this, "orderCounter");
        }
    },
    "bandwidth/remaining_limit": {
        updateEvery: 4000,
        updateFunc: async (_this, paradigm, query, db) => {
            const totalLimitStr = _this.getLatest("bandwidth/total_limit");
            const totalLimit = parseInt(totalLimitStr);

            const limitUsedStr = await query.call(_this, "round/limitUsed");
            const limitUsed = parseInt(limitUsedStr);

            const remainingLimit = totalLimit - limitUsed;
            const remainingLimitStr = remainingLimit.toString();
            return remainingLimitStr;
        }
    },
    "bandwidth/number_posters": {
        updateEvery: 60000,
        updateFunc: async (_this, paradigm, query, db) => {
            const raw = await query.call(_this, "posters");
            const arr = raw.split(",");
            return arr.length.toString();
        }
    },
    "bandwidth/sec_to_next_period": {
        updateEvery: 3500,
        updateFunc: async (_this, paradigm, query, db) => {
            // initial query
            const raw = await query.call(_this, "round/endsAt");
            const ethBlock = await paradigm.web3.eth.getBlockNumber();
            const ethBlockStr = ethBlock.toString();

            // set values while we have them
            await db.set("bandwidth/current_eth_block", ethBlockStr);
            await db.set("bandwidth/period_end_eth_block", raw);

            // calculate difference
            const diff = parseInt(raw) - parseInt(ethBlockStr);
            if (diff <= 0) {
                return "15";
            } else {
                const sec = 15 + (diff * 15);
                return sec.toString();
            }
        }
    },
    "bandwidth/rebalance_period_number": {
        updateEvery: 10000,
        updateFunc: async (_this, paradigm, query, db) => {
            return await query.call(_this, "round/number");
        }
    },
    "network/number_validators": {
        updateEvery: 5000,
        updateFunc: async (_this, paradigm, query, db) => {
            const raw = await query.call(_this, "validators");
            const arr = raw.split(",");
            return arr.length.toString();
        }
    },
    "network/total_validator_stake": {
        updateEvery: 3600000,
        updateFunc: async (_this, paradigm, query, db) => {
            return "0";
        }
    },
    "network/total_poster_stake": {
        updateEvery: 60000,
        updateFunc: async (_this, paradigm, query, db) => {
            const raw = await paradigm.posterRegistry.tokensContributed();
            return raw.toString();
        }
    }
};