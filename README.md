# Tool: `network-summary-api`

The network summary API provides a simple WebSocket subscription for various statistics about the Paradigm OrderStream network and token system. It also provides a set of simple REST methods to assist the creation of a network summary front-end. 

## Specification

The primary usage of this tool is the WebSocket API that push various blockchain and network data over a client <> server connection for each connected party. The schematic of the output object is shown and described below.

### API Schema

Structure of the stringified object streamed to each connection, updated upon each new block. 

```js
// js-flavored JSON shown with annotations

{
    "token": {
        "total_supply": "11111111", // 1                   
        "price": 0                  // 2
    },
    "bandwidth": {      
        "total_limit": 75000,               // 3
        "total_orders": 1210351,            // 4
        "remaining_limit": 73125,           // 5
        "number_posters": 1514,             // 6
        "sec_to_next_period": 60,           // 7
        "period_end_eth_block": 5230844,    // 8
        "current_eth_block": 5230840        // 9
        "rebalance_period_number": 27940,   // 10
    },
    "network": {
        "block_height": 1327413,                // 11
        "last_block_time": 1551727994832,       // 12
        "avg_block_interval": 1492,             // 13
        "number_validators": 32,                // 14
        "total_validator_stake": 65314806500000 // 15
    },
    "transactions": [                       // 16
        // ...
        {   
            "order_id": "askdasd",          // 16 (a)     
            "poster_address": "0x....",     // 16 (b)
            "maker_address": "0x...",       // 16 (c)
            "order_type": "0x"              // 16 (d)
        }
        // ...
    ],
    "validators": [                 // 17
        // ...
        {
            "public_key": "...",    // 17 (a)
            "stake": 1345600000000, // 17 (b)
            "reward": 1200000000,   // 17 (c)
            "uptime_percent": 11,   // 17 (d)
            "first_block": 45102,   // 17 (e)
            "last_voted": 1327413   // 17 (f)
            "power": 10             // 17 (g)
        }
        // ...
    ]
}
```

### Annotations

1. **DIGM token supply** (`token.total_supply`): the total number of DIGM tokens in circulation. Keep in mind this number will be in units of `wei` (smallest divisible unit) so for the actual "quantity" of full DIGM tokens, this value will need to be multiplied by `1 * 10^18`.

1. **DIGM token price** (`token.price`): there is currently no concept of DIGM "price", so for now, this value can be ignored. 

1. **Total limit** (`bandwidth.total_limit`): this value is the current network-agreed-upon value for the total number of `order` transactions that can be accepted per rebalance period. It is a consensus-critical parameter that is unlikely to change very often.

1. **Total orders** (`bandwidth.total_orders`): this incremental value simply counts the total number of `order` transactions accepted on the network since genesis. It is independent of any individual period.

1. **Remaining limit** (`bandwidth.remaining_limit`): the number of remaining (unused) allocated orders for the current period. It will count down during each period as orders are accepted, and will reset to the `total_limit` upon each rebalance event. 

1. **Number of posters** (`bandwidth.number_posters`): the total number of `poster` accounts; the number of addresses with DIGM registered to post order's to the OS network.

1. **Seconds to next period** (`bandwidth.sec_to_next_period`): a (very) rough estimation of the number of seconds to the next rebalance period. Taken by counting the number of Ethereum blocks until the next period, multiplied by the average Ethereum block-time.

1. **Period end Ethereum block** (`bandwidth.period_end_eth_block`): the Ethereum block number at which the current rebalance period ends.

1. **Current Ethereum block** (`bandwidth.current_eth_block`): the best-known (highest) Ethereum block number. Updated each time an OrderStream block is committed.

1. **Rebalance period number** (`bandwidth.rebalance_period_number`): an incremental counter that tracks the number of rebalance periods that have occurred. Displays the number of the currently active period (not the last completed).

1. **Block height** (`network.block_height`): updates with each new committed block, the `block_height` increases by 1. It tracks the current height of the OrderStream blockchain. 

1. **Last block time** (`network.last_block_time`): the UNIX timestamp (in milliseconds) of the most recently committed block.

1. **Average interval** (`network.avg_block_interval`): the `average_block_interval` tracks the arithmetic moving average (over a server-configurable number of blocks) of the interval in milliseconds between each block. Commonly referred to as the "block-time", it can be shown in seconds by dividing the number by 1000.

1. **Validator counter** (`network.number_validators`): simply tracks the number of validators in the active validator set. It will change only when a new validator is added, or a current one is removed via governance processes. 

1. **Total validator stake** (`network.total_validator_stake`): the total number of DIGM (in `wei`) staked in the `ValidatorRegistry` contract by active validators. Also an important metric for determining network security and value. 

1. **Transactions** (`transactions`): an array of objects (defined below) with some data representing the most recent 10 order transactions from the network.

    a. **Order ID** (`transactions[N].order_id`): a hash of the Paradigm order object, used to identify orders.

    b. **Poster address** (`transactions[N].poster_address`): the Ethereum address of the `poster` entity who signed and submitted the order.

    c. **Maker address** (`transactions[N].maker_address`): the Ethereum address of the `maker` entity who originated the order message.

    d. **Order type** (`transactions[N].order_type`): if the `subContract` for a given order is known, the `order_type` field will be a short string of the name of the settlement logic (such as "0x", or "Dharma") and will be `null` if unknown.

1. **Validators** (`validators`): an array of objects (defined below) for each active validator on the network. 

    a. **Public Key** (`validators[N].public_key`): the validators active tendermint public key, which corresponds to a current validating private key. Hashed in multiple ways to generate `node_id`, etc. Also used to query the `ValidatorRegistry` contract.

    b. **Stake** (`validators[N].stake`): a specific validators DIGM stake (in `wei`) currently held in the `ValidatorRegistry` contract.

    c. **Reward** (`validators[N].reward`): the number of DIGM tokens (in `wei`) the validator has specified to receive (or burn, if negative) for each reward period.

    d. **Uptime percent** (`validators[N].uptime_percent`): a number between 0 and 100 that represents that validators uptime: the percentage of time they have been online (voting on blocks) since they were added as a validator.

    e. **First block** (`validators[N].first_block`): the height of the first OrderStream block that a given validator voted on. Used as, or to calculate a validators "age" in the network.

    f. **Last voted** (`validators[N].last_voted`): the height of OrderStream network at which a given validator voted (or proposed) a block.

    g. **Vote power** (`validators[N].power`): the vote power the validator has on the Tendermint chain. Also affects how often a given validator is selected as block proposer.

## Usage

API usage coming soon...
