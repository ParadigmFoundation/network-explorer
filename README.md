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
        "total_supply": "111111",           // 1
        "price": "12.34"                    // 2
    },
    "bandwidth": {
        "total_limit": "12002453",          // 3
        "total_orders": "23123123",         // 4
        "remaining_limit": "123123"         // 5
    },
    "network": {
        "block_height": "345345",           // 6
        "last_block_time": "18293719283",   // 7
        "avg_block_interval": "920",        // 8
        "number_validators": "867",         // 9
        "total_validator_stake": "7234666", // 10
        "rebalance_period_number": "731",   // 11
        "time_to_next_period": "2300"       // 12
        "eth_blocks_to_next_period": "2",   // 13
    },
    "transactions": [                       // 14
        // ...
        {
            "order_id": "askdasd",          // 14 (a)
            "poster_address": "0x....",     // 14 (b)
            "maker_address": "0x...",       // 14 (c)
            "order_type": "0x"              // 14 (d)
        },
        // ...
    ],
    "validators": [                         // 15
        // ...
        {
            "moniker": "bs1",               // 15 (a)
            "stake": "13456",               // 15 (b)
            "reward": "12",                 // 15 (c)
            "uptime_percent": "11",         // 15 (d)
            "first_block": "0"              // 15 (e)
        },
        {
            "moniker": "bs2",
            "stake": "7896",
            "reward": "-16",
            "uptime_percent": "100",
            "first_block": "0"
        }
        // ...
    ]
}
```

### Annotations

1. **DIGM token supply:** the total number of DIGM tokens in circulation. Keep in mind this number will be in units of `wei` (smallest divisible unit) so for the actual "quantity" of full DIGM tokens, this value will need to be multiplied by `1 * 10^18`.

1. **DIGM token price:** there is currently no concept of DIGM "price", so for now, this value can be ignored. 

1. **Total limit:** this value is the current network-agreed-upon value for the total number of `order` transactions that can be accepted per rebalance period. It is a consensus-critical parameter that is unlikely to change very often.

1. **Total orders:** this incremental value simply counts the total number of `order` transactions accepted on the network since genesis. It is independent of any individual period.

1. **Remaining limit:** the number of remaining (unused) allocated orders for the current period. It will count down during each period as orders are accepted, and will reset to the `total_limit` upon each rebalance event. 

1. **Block height:** updates with each new committed block, the `block_height` increases by 1. It tracks the current height of the OrderStream blockchain. 

1. **Last block time:** the UNIX timestamp (in milliseconds) of the most recently committed block.

1. **Average interval:** the `average_block_interval` tracks the arithmetic moving average (over a server-configurable number of blocks) of the interval in milliseconds between each block. Commonly referred to as the "block-time", it can be shown in seconds by dividing the number by 1000.

1. **Validator counter:** `number_validators` simply tracks the number of validators in the active validator set. It will change only when a new validator is added, or a current one is removed via governance processes. 

1. **Total validator stake:** the total number of DIGM (in `wei`) staked in the `ValidatorRegistry` contract by active validators. Also an important metric for determining network security and value. 

1. **Rebalance period number:** an incremental counter that tracks the number of rebalance periods that have occurred. Displays the number of the currently active period (not the last completed).

1. **Time to next period:** a (very) rough estimation of the number of seconds to the next rebalance period. Taken by counting the number of Ethereum blocks until the next period, multiplied by the average Ethereum block-time. 

1. **Blocks to next period:** the number of Ethereum blocks until the next rebalance period starts. 

1. **Transactions:** an array of objects (defined below) with some data representing the most recent 10 order transactions from the network.

    a. **Order ID:** a hash of the Paradigm order object, used to identify orders.

    b. **Poster address:** the Ethereum address of the `poster` entity who signed and submitted the order.

    c. **Maker address:** the Ethereum address of the `maker` entity who originated the order message.

    d. **Order type:** if the `subContract` for a given order is known, the `order_type` field will be a short string of the name of the settlement logic (such as "0x", or "Dharma") and will be `null` if unknown.

1. **Validators:** an array of objects (defined below) for each active validator on the network. 

    a. **Moniker:** a human-readable string name used to identify the validator.

    b. **Stake:** a specific validators DIGM stake (in `wei`) currently held in the `ValidatorRegistry` contract.

    c. **Reward:** the number of DIGM tokens (in `wei`) the validator has specified to receive (or burn, if negative) for each reward period.

    d. **Uptime percent:** a number between 0 and 100 that represents that validators uptime: the percentage of time they have been online (voting on blocks) since they were added as a validator.

    e. **First block:** the height of the first OrderStream block that a given validator voted on. Used as, or to calculate a validators "age" in the network.

## Usage

API usage coming soon...
