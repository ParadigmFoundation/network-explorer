interface INetworkData {
    token: {
        total_supply?: number;
        price?: number;
    }
    bandwidth: {
        total_limit?: number;
        total_orders?: number;
        remaining_limit?: number;
        number_posters?: number;
        sec_to_next_period?: number;
        rebalance_period_number?: number;
        period_end_eth_block?: number;
        current_eth_block?: number;
    }
    network: {
        block_height?: number;
        last_block_time?: number;
        avg_block_interval?: number;
        number_validators?: number;
        total_validator_stake?: number;
        total_poster_stake?: number;
    }
    transactions?: IOrder[];
    validators?: IValidator[];
}

interface IOrder {
    order_id: string;
    poster_address: string;
    maker_address: string;
    subcontract_address: string;
    order_type: string;
}

interface IValidator {
    moniker: string;
    stake: number;
    reward: number;
    uptime_percent: number;
    first_block: number;
    last_voted: number;
}

interface Constructable<T> {
    new(): T;
}

interface IWsRequest {
    id: string;
    method: string;
    param: string;
}

interface IWsResponse {
    id: string;
    code: number;
    data?: string;
}

interface OrderData {
    order_id: string;
    poster_address: string;
    maker_address: string;
    subcontract_address: string;
    order_type: string;
}