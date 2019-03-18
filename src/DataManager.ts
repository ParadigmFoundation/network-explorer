import * as WebSocket from "ws";
import * as Paradigm from "paradigm-connect";
import * as uuid from "uuid/v4";
import { isUndefined, cloneDeep } from "lodash";
import { log, error, warn } from "./functions";
import { RedisWrapper } from "./RedisWrapper";

interface QueryDefinition {
    [key: string]: {
        updateEvery: number;
        updateFunc: (_this, paradigm, query, db) => Promise<string>;
        timer?: NodeJS.Timer;
    }
}

export class DataManager {
    private conn: WebSocket;
    private paradigm: any;
    private redis: RedisWrapper;

    private defs: QueryDefinition;
    private keys: string[];
    private values: any;

    // non generalizable data
    private lastBlockTimes: Array<number> = [];
    private lastTime: number;
    private averageOver: number;

    // validators and transactions are managed separately
    private validators: IValidator[];
    private orders: IOrder[];

    // timer set to update validator info 
    private validatorTimer: NodeJS.Timer;
    private orderAmount: number;

    constructor(
        definitions: QueryDefinition,
        socketUrl: string,
        averageOver: number,
        validatorInterval: number,
        orderAmount: number = 20
    ) {
        this.keys = [];
        this.values = {};

        this.validators = [];
        this.orders = [];

        this.averageOver = averageOver;
        this.orderAmount = orderAmount;
        this.defs = definitions;

        this.paradigm = new Paradigm();
        this.redis = new RedisWrapper();

        this.conn = new WebSocket(socketUrl);
        this.conn.setMaxListeners(100);
        this.conn.on("open", () => {
            this.setup();
        });

        // set timer to update validators
        this.validatorTimer = setInterval(this.updateValidators(), validatorInterval);
    }

    private async setup() {
        // clear the db
        this.redis.purgeAll();

        // setup timers and store initial value
        Object.keys(this.defs).forEach(async key => {
            const def = this.defs[key];
            this.keys.push(key);
            this.updateVal(key)();
            def.timer = setInterval(this.updateVal(key), def.updateEvery);
        });

        // perform initial validator update
        await this.updateValidators()();
    }

    private updateValidators(): () => Promise<void> {
        return async () => {
            this.validators = [];
            try {
                // get the current list of validator IDs
                const rawIds = await this.query("validators", 10000);
                const valListArr = rawIds.slice(1, -1).split(",");
                for (let i = 0; i < valListArr.length; i ++) {
                    const id = valListArr[i];
                    const validator = await this.getValidatorInfo(id); 
                    this.validators.push(validator);
                }
            } catch (err) {
                error(`unable to update validator info: ${err.message}`);
            }
        }
    }

    private async getValidatorInfo(id: string): Promise<IValidator> {
        const validator = {};
        const pending = [];
        const fields = [
            "totalVotes", 
            "firstVote",
            "lastVoted",
            "publicKey",
            "balance",
            "power"
        ]

        fields.forEach(field => { 
            pending.push(this.query(`validators/${id}/${field}`, 10000));
        });

        const
            total = await this.query(`validators/${id}/totalVotes`, 10000),
            first = await this.query(`validators/${id}/firstVote`, 10000),
            last = await this.query(`validators/${id}/lastVoted`, 10000),
            key = await this.query(`validators/${id}/publicKey`, 10000),
            stake = await this.query(`validators/${id}/balance`, 10000),
            power = await this.query(`validators/${id}/power`, 10000);

        const currHeight = parseInt(this.getLatest("network/block_height"));
        const uptimePercent = Math.floor(100 * (total / ((currHeight - first))));
        
        // assign values (raw and computed) to validator object
        validator["public_key"] = key;
        validator["stake"] = stake;
        validator["uptime_percent"] = uptimePercent.toString();
        validator["first_block"] = first;
        validator["last_voted"] = last;
        validator["power"] = power;
        
        // @todo update
        validator["reward"] = "0"; // temporary
        console.log(JSON.stringify(validator));
        return validator as IValidator;
    }

    private updateVal(key: string): () => Promise<void> {
        return async () => {
            const value = await this.callFunc(key);
            if (!value || value === "") {
                warn(`not updating because we got null value for key '${key}'`);
            } else {
                this.redis.set(key, value);
                log(`set new value for '${key}' as '${value}'`);
            }
            return;
        }
    }

    private async callFunc(key: string) {
        if (!this.defs[key] || !this.defs[key]["updateFunc"]) return;
        let res = "";
        try {
            const val = this.defs[key];
            res = await val.updateFunc(this, this.paradigm, this.query, this.redis);
        } catch (err) {
            error(`failed to update value for '${key}': ${err}`);
        }
        return res;
    }

    private query(path, timeout = 5000): Promise<any> {
        return new Promise((resolve, reject) => {
            const reqid = uuid();
            this.conn.send(JSON.stringify({
                jsonrpc: "2.0",
                id: reqid,
                method: "state.query",
                params: { path }
            }));
            const timer = setTimeout(() => {
                this.conn.removeListener("message", handler);
                warn(`query failed due to request timeout for: "${path}"`);
                resolve();
            }, timeout);
            const handler = (msg) => {
                const parsed = JSON.parse(msg.toString());
                if (parsed.id === reqid) {
                    this.conn.removeListener("message", handler);
                    clearInterval(timer);
                    resolve(parsed.result.response.info);
                }
            };
            this.conn.addListener("message", handler);
        });
    }

    public async updateBlockData(height: string, time: string): Promise<void> {
        const timeNum = parseInt(time);
        if (this.lastBlockTimes.length === 0) {
            this.lastTime = timeNum;
            this.addBlockTime(0);
        } else {
            const diff = timeNum - this.lastTime;
            this.addBlockTime(diff);
        }

        // update in-state last-time
        this.lastTime = timeNum;
        
        // recalculate average interval
        const avg = this.updateAverageBlockTime().toString();

        // set new values and update from db
        try { 
            await Promise.all([
                this.redis.set("network/block_height", height),
                this.redis.set("network/last_block_time", time),
                this.redis.set("network/avg_block_interval", avg)
            ]);
            await this.setLatest();
            log(`successfully updated all data for block '${height}'`);
        } catch (err) {
            warn(`failed to update one or more block data values`);
            warn(`redis returned error: ${err}`);
        }

        return;
    }

    private addBlockTime(blockTime: number): void {
        if (this.lastBlockTimes.length < this.averageOver) {
            this.lastBlockTimes.push(blockTime);
        } else if (this.lastBlockTimes.length === this.averageOver) {
            this.lastBlockTimes.shift();
            this.lastBlockTimes.push(blockTime);
        } else {
            this.lastBlockTimes.push(blockTime);
            while (this.lastBlockTimes.length > this.averageOver) {
                this.lastBlockTimes.shift();
            }
        }
    }

    public addOrder(order: any): void {
        this.orders.push(order);
        while (this.orders.length > this.orderAmount) {
            this.orders.shift();
        }
    }

    private updateAverageBlockTime(): number {
        let average, length, sum = 0;
        length = this.lastBlockTimes.length;
        this.lastBlockTimes.forEach(diff => sum += diff);
        average = Math.round(sum / length);
        return average;
    }

    private async getValue(key: string): Promise<string> {
        return await this.redis.get(key);
    }

    private async setValue(key: string, value: string): Promise<void> {
        return await this.redis.set(key, value);
    }

    public async setLatest() {
        const [
            total_supply,
            price,
            total_limit,
            total_orders,
            remaining_limit,
            number_posters,
            sec_to_next_period,
            current_eth_block,
            period_end_eth_block,
            rebalance_period_number,
            block_height,
            last_block_time,
            avg_block_interval,
            number_validators,
            total_poster_stake,
            total_validator_stake 
        ] = await Promise.all([
            this.getValue("token/total_supply"),
            this.getValue("token/price"),
            this.getValue("bandwidth/total_limit"),
            this.getValue("bandwidth/total_orders"),
            this.getValue("bandwidth/remaining_limit"),
            this.getValue("bandwidth/number_posters"),
            this.getValue("bandwidth/sec_to_next_period"),
            this.getValue("bandwidth/current_eth_block"),
            this.getValue("bandwidth/period_end_eth_block"),
            this.getValue("bandwidth/rebalance_period_number"),
            this.getValue("network/block_height"),
            this.getValue("network/last_block_time"),
            this.getValue("network/avg_block_interval"),
            this.getValue("network/number_validators"),
            this.getValue("network/total_poster_stake"),
            this.getValue("network/total_validator_stake")
        ]);
        this.values = {
            token: { total_supply, price },
            bandwidth: {
                total_limit,
                total_orders,
                remaining_limit,
                number_posters,
                sec_to_next_period,
                current_eth_block,
                period_end_eth_block,
                rebalance_period_number
            },
            network: {
                block_height,
                last_block_time,
                avg_block_interval,
                number_validators,
                total_poster_stake,
                total_validator_stake
            },
            validators: cloneDeep(this.validators),
            transactions: cloneDeep(this.orders)
        }
    }

    public getLatest(key?: string): any {
        let res;
        if (!key) {
            return cloneDeep(this.values);
        }
        const [ one, two ] = key.split("/");
        return this.values[one][two];
    }
}