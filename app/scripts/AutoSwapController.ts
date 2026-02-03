import crypto from 'crypto';
import { Hex } from '@metamask/utils';
import EventEmitter from 'events';

const SWAP_INTERVAL_MS = 60_000;

/* ============================================================

Asset Registry

============================================================ */

type AssetSymbol = 'BTC' | 'ETH';

const ASSETS = {
  BTC: { decimals: 8n },
  ETH: { decimals: 18n },
} as const;

/* ============================================================

Pricing Oracle (deterministic & reproducible)

============================================================ */

// Base rate: 1 BTC ≈ 15.73 ETH (x100 precision)
const BASE_RATE = 15_73n;
const RATE_PRECISION = 100n;

/**
 * Produces a slow, deterministic drift.
 * No randomness → perfect for replay & tests.
 */
function getVolatileRate(epochMs: number): bigint {
  const drift = BigInt(Math.floor(epochMs / 60_000) % 7) - 3n;
  return BASE_RATE + drift;
}

/* ============================================================

Hex helpers (safe bigint handling)

============================================================ */

type SafeHex = `0x${string}` | `-0x${string}`;

function hexToBigInt(hex: SafeHex): bigint {
  return hex.startsWith('-') ? -BigInt(hex.slice(1)) : BigInt(hex);
}

function bigIntToHex(value: bigint): SafeHex {
  const abs = value < 0n ? -value : value;
  return `${value < 0n ? '-' : ''}0x${abs.toString(16)}`;
}

function clampRate(rate: bigint): bigint {
  return rate > 0n ? rate : 1n;
}

/* ============================================================

Fees

============================================================ */

const FEE_BPS = 30n; // 0.30%
const FEE_DIVISOR = 10_000n;

/* ============================================================

Types

============================================================ */

type BalanceMap = Record<AssetSymbol, Hex>;

/**
 * Signed balance delta (MetaMask-style accounting)
 */
interface BalanceChange {
  account: Hex;
  chainId: number;
  asset: AssetSymbol;
  delta: Hex;
  toAddress?: Hex;
}

/**
 * Internal swap transaction
 */
interface SwapTransaction {
  id: string;
  timestamp: number;
  operation: 'swap';
  account: Hex;
  chainId: number;
  rateUsed: bigint;
  feePaid: Hex;
  balanceChanges: BalanceChange[];
  status: 'confirmed';
  meta?: {
    baseRate: bigint;
    pricePressure: bigint;
    effectiveRate: bigint;
  };
}

/**
 * Network messages (read-only RPC & broadcast)
 */
interface NetworkState {
  timestamp: number;
  baseRate: Hex;
  pricePressure: Hex;
  effectiveRate: Hex;
}

interface RpcRequest {
  id: string;
  method: 'getState' | 'getBalances' | 'getTransactions';
  params?: any;
}

interface RpcResponse {
  id: string;
  result?: unknown;
  error?: string;
}

/* ============================================================

Controller (Pure Economic Engine)

============================================================ */

export class AutoSwapController extends EventEmitter {
  private intervalId: NodeJS.Timeout | null = null;

  /**
   * balances[chainId][account] → BalanceMap
   */
  private balances = new Map<number, Map<Hex, BalanceMap>>();

  private transactions: SwapTransaction[] = [];

  /**
   * Price inertia (deterministic memory)
   */
  private pricePressure = 0n;
  private lastPressureDecay = 0;

  /**
   * Fee sink (minimal treasury)
   */
  private feeTreasury = 0n;

  /* ============================================================

  Lifecycle

  ============================================================ */

  onUnlock(account: Hex, chainId: number): void {
    if (this.intervalId) {
      console.warn(
        'AutoSwapController already running; ignoring additional unlock',
      );
      return;
    }

    this.ensureAccountState(account, chainId);

    this.intervalId = setInterval(() => {
      this.executeSwap(account, chainId, 'BTC', 'ETH');
    }, SWAP_INTERVAL_MS);
  }

  onLock(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  /* ============================================================

  Public API

  ============================================================ */

  setInitialBalances(
    account: Hex,
    chainId: number,
    btc: Hex,
    eth: Hex,
  ): void {
    this.ensureAccountState(account, chainId);
    this.balances.get(chainId)!.set(account, { BTC: btc, ETH: eth });
  }

  getBalances(account: Hex, chainId: number): BalanceMap {
    this.ensureAccountState(account, chainId);
    return { ...this.balances.get(chainId)!.get(account)! };
  }

  getTransactions(chainId?: number): SwapTransaction[] {
    return chainId === undefined
      ? [...this.transactions]
      : this.transactions.filter((tx) => tx.chainId === chainId);
  }

  /**
   * Network-readable state (RPC safe)
   */
  getState(): NetworkState {
    const now = Date.now();
    const baseRate = getVolatileRate(now);
    this.decayPressure(now);

    const effectiveRate = clampRate(baseRate - this.pricePressure);

    return {
      timestamp: now,
      baseRate: bigIntToHex(baseRate),
      pricePressure: bigIntToHex(this.pricePressure),
      effectiveRate: bigIntToHex(effectiveRate),
    };
  }

  /* ============================================================

  Core Engine

  ============================================================ */

  private executeSwap(
    account: Hex,
    chainId: number,
    from: AssetSymbol,
    to: AssetSymbol,
  ): void {
    const accountBalances = this.balances.get(chainId)!.get(account)!;

    const amountIn = 10n ** ASSETS[from].decimals;
    if (hexToBigInt(accountBalances[from] as SafeHex) < amountIn) return;

    const now = Date.now();
    this.decayPressure(now);

    const baseRate = getVolatileRate(now);
    const effectiveRate = clampRate(baseRate - this.pricePressure);

    const { amountOut, fee } = this.computeSwap(
      from,
      to,
      amountIn,
      effectiveRate,
    );

    this.applySwap(
      account,
      chainId,
      from,
      to,
      amountIn,
      amountOut,
      fee,
      baseRate,
      effectiveRate,
    );

    this.applyPressureNormalized(amountIn, from);

    this.emit('stateBroadcast', this.getState());
  }

  private computeSwap(
    from: AssetSymbol,
    to: AssetSymbol,
    amountIn: bigint,
    rate: bigint,
  ) {
    const outBase = 10n ** ASSETS[to].decimals;

    const gross =
      (amountIn * rate * outBase) /
      (RATE_PRECISION * 10n ** ASSETS[from].decimals);

    const fee = (gross * FEE_BPS) / FEE_DIVISOR;
    return { amountOut: gross - fee, fee };
  }

  private applySwap(
    account: Hex,
    chainId: number,
    from: AssetSymbol,
    to: AssetSymbol,
    amountIn: bigint,
    amountOut: bigint,
    fee: bigint,
    baseRate: bigint,
    effectiveRate: bigint,
  ): void {
    const accountBalances = this.balances.get(chainId)!.get(account)!;

    accountBalances[from] = bigIntToHex(
      hexToBigInt(accountBalances[from] as SafeHex) - amountIn,
    );

    accountBalances[to] = bigIntToHex(
      hexToBigInt(accountBalances[to] as SafeHex) + amountOut,
    );

    this.feeTreasury += fee;

    const tx: SwapTransaction = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      operation: 'swap',
      account,
      chainId,
      rateUsed: effectiveRate,
      feePaid: bigIntToHex(fee),
      balanceChanges: [
        {
          account,
          chainId,
          asset: from,
          delta: bigIntToHex(-amountIn),
        },
        {
          account,
          chainId,
          asset: to,
          delta: bigIntToHex(amountOut),
          toAddress: account,
        },
        {
          account: '0xFEE' as Hex,
          chainId,
          asset: to,
          delta: bigIntToHex(fee),
        },
      ],
      status: 'confirmed',
      meta: { baseRate, pricePressure: this.pricePressure, effectiveRate },
    };

    this.transactions.push(tx);
    this.emit('transactionCreated', tx);
  }

  /* ============================================================

  Price inertia helpers

  ============================================================ */

  private applyPressure(amountIn: bigint): void {
    this.pricePressure += amountIn / 10n ** ASSETS.BTC.decimals;
  }

  private applyPressureNormalized(
    amountIn: bigint,
    asset: AssetSymbol,
  ): void {
    this.pricePressure += amountIn / 10n ** ASSETS[asset].decimals;
  }

  private decayPressure(now: number): void {
    if (this.lastPressureDecay === 0) {
      this.lastPressureDecay = now;
      return;
    }

    const elapsed = now - this.lastPressureDecay;
    if (elapsed < 300_000) return;

    const steps = BigInt(Math.floor(elapsed / 300_000));
    this.pricePressure -= steps;
    if (this.pricePressure < 0n) this.pricePressure = 0n;

    this.lastPressureDecay = now;
  }

  private ensureAccountState(account: Hex, chainId: number): void {
    if (!this.balances.has(chainId)) {
      this.balances.set(chainId, new Map());
    }
    const chainBalances = this.balances.get(chainId)!;
    if (!chainBalances.has(account)) {
      chainBalances.set(account, { BTC: '0x0', ETH: '0x0' });
    }
  }
}

/* ============================================================

Provider (RPC + Broadcast Adapter)

============================================================ */

export class AutoSwapProvider {
  constructor(
    private controller: AutoSwapController,
    private transport: {
      broadcast: (payload: unknown) => void;
      onRequest: (handler: (req: RpcRequest) => RpcResponse) => void;
    },
  ) {
    controller.on('transactionCreated', (tx) =>
      this.transport.broadcast({ type: 'transaction', payload: tx }),
    );

    controller.on('stateBroadcast', (state) =>
      this.transport.broadcast({ type: 'state', payload: state }),
    );

    this.transport.onRequest(this.handleRpc);
  }

  private handleRpc = (req: RpcRequest): RpcResponse => {
    try {
      switch (req.method) {
        case 'getState':
          return { id: req.id, result: this.controller.getState() };

        case 'getBalances':
          if (!req.params?.account || req.params.chainId === undefined) {
            throw new Error('Invalid params');
          }
          return {
            id: req.id,
            result: this.controller.getBalances(
              req.params.account,
              req.params.chainId,
            ),
          };

        case 'getTransactions':
          return {
            id: req.id,
            result: this.controller.getTransactions(req.params?.chainId),
          };

        default:
          return { id: req.id, error: 'Unknown method' };
      }
    } catch (e: any) {
      return { id: req.id, error: e.message };
    }
  };
}

/* ============================================================

Minimal Transport (in-memory / test / local network)

============================================================ */

export class InMemoryTransport extends EventEmitter {
  broadcast(payload: unknown): void {
    this.emit('message', payload);
  }

  onRequest(handler: (req: RpcRequest) => RpcResponse): void {
    this.on('request', (req: RpcRequest) => {
      const res = handler(req);
      this.emit('response', res);
    });
  }
}

export default AutoSwapController;
