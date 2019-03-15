import { QueryValue } from "./QueryValue";
import { cloneDeep } from "lodash";
import * as WebSocket from "ws";
import * as uuid from "uuid/v4"

export class CoreData {
    private static tenMinutes = 10 * 60 * 1000;
    private static fiveMinutes = 5 * 60 * 1000;
    private conn: WebSocket;
    private pInitialized: Promise<void>;
    private initialized: boolean;
    private paradigm: any;

    private lastBlockTimes: Array<number> = [];
    private lastTime: number;
    private averageOver: number;

    private ethUpdateTimer: NodeJS.Timer;
    private validatorUpdateTimer: NodeJS.Timer;

    private tSupply: string = "";
    private tPrice: string = "0";

    private bTotalLimit: AutoQuery<string>;
    private bTotalOrders: AutoQuery<string>;
    private bRemainingLimit: AutoQuery<string>;
    private bNumberPosters: AutoQuery<string>;
    private bSecToNextPeriod: AutoQuery<string>;
    private bRebalancePeriodNumber: AutoQuery<string>;

    private nNumberValidators: AutoQuery<string>;
    private nTotalValidatorStake: string = ""; // AutoQuery<string>;
    private nTotalPosterStake: string = "";

    private nBlockHeight: string = "";
    private nBlockTime: string = "";
    private nBlockInterval: string = "";

    private bPeriodEndEthBlock: string = "";
    private bCurrentEthBlock: string = "";

    private transactions: OrderData[] = [];
    private validators: OrderData[] = [];

    private validatorIds: string[];
    constructor(conn: WebSocket, paradigm: any, averageOver: number) {
        this.conn = conn;
        this.averageOver = averageOver;
        this.paradigm = paradigm;
        this.initialized = false;
        this.pInitialized = this.initializer()();
    }
    private initializer(): () => Promise<void> {
        return async () => { 
            this.bTotalLimit = new QueryValue(this.conn, "round/limit", CoreData.tenMinutes);
            this.bTotalLimit.update();
            this.bTotalOrders = new QueryValue(this.conn, "orderCounter", 5000);
            this.bRemainingLimit = new QueryValue(
                this.conn,
                "round/limitUsed",
                5000,
                (limitUsed) => {
                    if (!limitUsed) return;
                    return (75000 - parseInt(limitUsed)).toString();
                }
            );
            this.bNumberPosters = new QueryValue(
                this.conn,
                "posters",
                120000,
                (rawPosters) => {
                    if (!rawPosters) return "";
                    return rawPosters.slice(1, -1).split(",").length.toString();
                }
            );
            this.bNumberPosters.update();
            this.bSecToNextPeriod = new QueryValue(
                this.conn,
                "round/endsAt",
                2500, 
                async (endsAt) => {
                    let time;
                    try {
                        if (!endsAt) return;
                        const endBlock = parseInt(endsAt);
                        const currentBlock = await this.paradigm.web3.eth.getBlockNumber();
                        const rawDiff = endBlock - currentBlock;
                        time = (rawDiff * 15) + 15;
                
                        // set these values while we have them
                        this.bCurrentEthBlock = currentBlock;
                        this.bPeriodEndEthBlock = endsAt;
                    } catch (error) {
                        return "00";
                    }
                    return time > 0 ? time.toString() : "0";
                }
            );
            this.bRebalancePeriodNumber = new QueryValue(this.conn, "round/number", 7000);
            this.nNumberValidators = new QueryValue(
                this.conn,
                "validators",
                120000, 
                (valListStr) => {
                    if (!valListStr) return;
                    const valListArr = valListStr.slice(1, -1).split(",");
                    if (valListArr) {
                        this.validatorIds = valListArr;
                    }
                    return valListArr.length.toString();
                }
            );
            this.nNumberValidators.update();
            this.nTotalValidatorStake = "0"; // @todo
            await this.updateSupplyData()();
            await this.updateValidatorData()();

            this.ethUpdateTimer = setInterval(
                this.updateSupplyData(), 
                CoreData.fiveMinutes
            );
            this.validatorUpdateTimer = setInterval(
                this.updateValidatorData(),
                120000
            );
            this.initialized = true;
        }
    }
    public cancelMain(): void {
        clearInterval(this.ethUpdateTimer);
        clearInterval(this.validatorUpdateTimer);
    }
    private updateSupplyData(): () => Promise<void> {
        return async () => {
            try {
                this.nTotalPosterStake = (await this.paradigm.posterRegistry.tokensContributed()).toString();
                this.tSupply = (await this.paradigm.digmToken.totalSupply()).toString()
            } catch (err) {
                console.log(err);
                return;
            }
        }
    }
    private updateValidatorData(): () => Promise<void> {
        return async () => {
            if (!this.validatorIds) return;
            const validators = [];

            // get validator info
            for (let i = 0; i < this.validatorIds.length; i++) {
                // setup validator
                const validator = {};
                const valId = this.validatorIds[i];

                try {
                    // make necessary queries to local node's state
                    const totalVotes = await this.executeQuery(`validators/${valId}/totalVotes`);
                    const firstBlock = await this.executeQuery(`validators/${valId}/firstVote`);
                    const lastVoted = await this.executeQuery(`validators/${valId}/lastVoted`);
                    const publicKey = await this.executeQuery(`validators/${valId}/publicKey`);
                    const stake = await this.executeQuery(`validators/${valId}/balance`);
                    const power = await this.executeQuery(`validators/${valId}/power`);

                    // calculate uptime percent for this validator, this block
                    const currHeight = parseInt(this.nBlockHeight);
                    const uptimePercent = Math.floor(100 * (totalVotes / ((currHeight - firstBlock))));
                    
                    // assign values (raw and computed) to validator object
                    validator["public_key"] = publicKey;
                    validator["stake"] = stake;
                    validator["uptime_percent"] = uptimePercent.toString();
                    validator["first_block"] = firstBlock;
                    validator["last_voted"] = lastVoted;
                    validator["power"] = power;
                    
                    // @todo update
                    validator["reward"] = "0"; // temporary

                    // append this validator to validator array
                    validators.push(validator);
                } catch {
                    console.log("failed to update validators");
                }
            }
            this.validators = validators;
        }
    }
    private executeQuery(path): Promise<any> {
        return new Promise((resolve, reject) => {
            const reqid = uuid();
            this.conn.send(JSON.stringify({
                jsonrpc: "2.0",
                id: reqid,
                method: "state.query",
                params: { path }
            }));
            const timer = setTimeout(() => {
                this.conn.off("message", handler);
                console.log(`timeout: failed query: "${path}"`);
                resolve();
            }, 5000);
            const handler = (msg) => {
                const parsed = JSON.parse(msg.toString());
                if (parsed.id === reqid) {
                    this.conn.off("message", handler);
                    clearInterval(timer);
                    resolve(parsed.result.response.info);
                }
            };
            this.conn.on("message", handler);
        });
    }

    public updateBlockData(height: string, time: string) {
        const timeNum = parseInt(time);
        if (this.lastBlockTimes.length === 0) {
            this.lastTime = timeNum;
            this.addBlockTime(0);
        } else {
            const diff = timeNum - this.lastTime;
            this.addBlockTime(diff);
        }
        this.lastTime = timeNum;
        this.nBlockHeight = height;
        this.nBlockTime = time;
        this.nBlockInterval = this.calculateAverageBlockTime();
    }
    private addBlockTime(blockTime: number) {
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
    private calculateAverageBlockTime() {
        let average, length, sum = 0;
        length = this.lastBlockTimes.length;
        this.lastBlockTimes.forEach(diff => sum += diff);
        average = Math.round(sum / length);
        return average;
    }
    public toJSON() {
        return {
            token: {
                total_supply: this.tSupply,
                price: this.tPrice,
            },
            bandwidth: {
                total_limit: this.bTotalLimit.is(),
                total_orders: this.bTotalOrders.is(),
                remaining_limit: this.bRemainingLimit.is(),
                number_posters: this.bNumberPosters.is(),
                sec_to_next_period: this.bSecToNextPeriod.is(),
                current_eth_block: this.bCurrentEthBlock.toString(),
                period_end_eth_block: this.bPeriodEndEthBlock.toString(),
                rebalance_period_number: this.bRebalancePeriodNumber.is(),  
            },
            network: {
                block_height: this.nBlockHeight.toString(),
                last_block_time: this.nBlockTime.toString(),
                avg_block_interval: this.nBlockInterval.toString(),
                number_validators: this.nNumberValidators.is(),
                total_validator_stake: this.nTotalValidatorStake.toString(),
                total_poster_stake: this.nTotalPosterStake.toString()
            },
            transactions: cloneDeep(this.transactions),
            validators: cloneDeep(this.validators)
        };
    }
}

interface AutoQuery<T> extends QueryValue {
    is(): T;   
}

interface TokenData {
    total_supply?: number;
    price?: number;
}

interface BandwidthData {
    total_limit?: number;
    total_orders?: number;
    remaining_limit?: number;
    number_posters?: number;
    sec_to_next_period?: number;
    rebalance_period_number?: number;
    period_end_eth_block?: number;
    current_eth_block?: number;
}

interface NetworkData {
    block_height?: number;
    last_block_time?: number;
    avg_block_interval?: number;
    number_validators?: number;
    total_validator_stake?: number;
    total_poster_stake?: number;
}

interface ValidatorData {
    moniker: string;
    stake: number;
    reward: number;
    uptime_percent: number;
    first_block: number;
    last_voted: number;
}

interface OrderData {
    order_id: string;
    poster_address: string;
    maker_address: string;
    subcontract_address: string;
    order_type: string;
}