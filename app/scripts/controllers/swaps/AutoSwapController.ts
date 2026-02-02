import { Hex } from '@metamask/utils';
import EventEmitter from 'events';

/**
 * Auto Swap Simulation Controller
 *
 * - Account + Chain scoped internal swaps
 * - Deterministic volatile oracle
 * - Balance-diff based accounting (MetaMask-style)
 * - Explicit chainId binding
 * - Activated on unlock / halted on lock
 *
 * ⚠️ Simulation locale uniquement (aucun RPC, aucun broadcast)
 */

const SWAP_INTERVAL_MS = 60_000;

/* ============================================================
 * Asset Registry
 * ============================================================ */

type AssetSymbol = 'BTC' | 'ETH';

const ASSETS = {
  BTC: { decimals: 8n },
  ETH: { decimals: 18n },
} as const;

/* ============================================================
 * Pricing Oracle (deterministic & reproducible)
 * ============================================================ */

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
 * Fees
 * ============================================================ */

const FEE_BPS = 30n; // 0.30%
const FEE_DIVISOR = 10_000n;

/* ============================================================
 * Types
 * ============================================================ */

type BalanceMap = Record<AssetSymbol, Hex>;

/**
 * Signed balance delta (MetaMask-style accounting)
 */
interface BalanceChange {
  account: Hex;
  chainId: number;
  asset: AssetSymbol;
  delta: Hex; // signed hex
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
}

/* ============================================================
 * Controller
 * ============================================================ */

export class AutoSwapController extends EventEmitter {
  private intervalId: NodeJS.Timeout | null = null;

  /**
   * balances[chainId][account] → BalanceMap
   */
  private balances = new Map<number, Map<Hex, BalanceMap>>();

  private transactions: SwapTransaction[] = [];

  /* ============================================================
   * Lifecycle
   * ============================================================ */

  onUnlock(account: Hex, chainId: number): void {
    if (this.intervalId) return;

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
   * Public API
   * ============================================================ */

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

  /* ============================================================
   * Core Engine
   * ============================================================ */

  private executeSwap(
    account: Hex,
    chainId: number,
    from: AssetSymbol,
    to: AssetSymbol,
  ): void {
    const accountBalances = this.balances.get(chainId)!.get(account)!;

    // Swap strict : 1 BTC → ETH
    const amountIn = 10n ** ASSETS[from].decimals;
    if (BigInt(accountBalances[from]) < amountIn) return;

    const rate = getVolatileRate(Date.now());
    const { amountOut, fee } = this.computeSwap(from, to, amountIn, rate);

    this.applySwap(
      account,
      chainId,
      from,
      to,
      amountIn,
      amountOut,
      fee,
      rate,
    );
  }

  private computeSwap(
    from: AssetSymbol,
    to: AssetSymbol,
    amountIn: bigint,
    rate: bigint,
  ): { amountOut: bigint; fee: bigint } {
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
    rate: bigint,
  ): void {
    const accountBalances = this.balances.get(chainId)!.get(account)!;

    accountBalances[from] =
      `0x${(BigInt(accountBalances[from]) - amountIn).toString(16)}`;
    accountBalances[to] =
      `0x${(BigInt(accountBalances[to]) + amountOut).toString(16)}`;

    const balanceChanges: BalanceChange[] = [
      {
        account,
        chainId,
        asset: from,
        delta: `-0x${amountIn.toString(16)}`,
      },
      {
        account,
        chainId,
        asset: to,
        delta: `0x${amountOut.toString(16)}`,
        toAddress: account,
      },
    ];

    const tx: SwapTransaction = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      operation: 'swap',
      account,
      chainId,
      rateUsed: rate,
      feePaid: `0x${fee.toString(16)}`,
      balanceChanges,
      status: 'confirmed',
    };

    this.transactions.push(tx);

    // MetaMask-style signal
    this.emit('transactionCreated', tx);
  }

  /* ============================================================
   * Internal helpers
   * ============================================================ */

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

export default AutoSwapController;
