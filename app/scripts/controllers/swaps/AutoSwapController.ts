import { Hex } from '@metamask/utils';
import EventEmitter from 'events';

/**
 * Auto Swap Simulation Controller
 *
 * - Account-scoped internal swaps
 * - Deterministic volatile oracle
 * - Balance-diff based accounting (MetaMask-style)
 * - Activated on unlock / halted on lock
 */

const SWAP_INTERVAL_MS = 60_000;

/* ========= Asset Registry ========= */

type AssetSymbol = 'BTC' | 'ETH';

const ASSETS = {
  BTC: { decimals: 8n },
  ETH: { decimals: 18n },
} as const;

/* ========= Pricing Oracle ========= */

// Base rate: 1 BTC ≈ 15.73 ETH (x100 precision)
const BASE_RATE = 15_73n;
const RATE_PRECISION = 100n;

function getVolatileRate(epoch: number): bigint {
  const drift = BigInt(epoch % 7) - 3n;
  return BASE_RATE + drift;
}

/* ========= Fees ========= */

const FEE_BPS = 30n;
const FEE_DIVISOR = 10_000n;

/* ========= Types ========= */

type BalanceMap = Record<AssetSymbol, Hex>;

interface BalanceChange {
  account: Hex;
  asset: AssetSymbol;
  delta: Hex; // signed hex
}

interface SwapTransaction {
  id: string;
  timestamp: number;
  operation: 'swap';
  account: Hex;
  rateUsed: bigint;
  feePaid: Hex;
  balanceChanges: BalanceChange[];
  status: 'confirmed';
}

/* ========= Controller ========= */

export class AutoSwapController extends EventEmitter {
  private intervalId: NodeJS.Timeout | null = null;
  private balancesByAccount = new Map<Hex, BalanceMap>();
  private transactions: SwapTransaction[] = [];

  /* ========= Lifecycle ========= */

  onUnlock(account: Hex): void {
    if (this.intervalId) return;

    if (!this.balancesByAccount.has(account)) {
      this.balancesByAccount.set(account, { BTC: '0x0', ETH: '0x0' });
    }

    this.intervalId = setInterval(
      () => this.executeSwap(account, 'BTC', 'ETH'),
      SWAP_INTERVAL_MS,
    );
  }

  onLock(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  /* ========= Public API ========= */

  setInitialBalances(account: Hex, btc: Hex, eth: Hex): void {
    this.balancesByAccount.set(account, { BTC: btc, ETH: eth });
  }

  getBalances(account: Hex): BalanceMap {
    return { ...(this.balancesByAccount.get(account)!) };
  }

  getTransactions(): SwapTransaction[] {
    return [...this.transactions];
  }

  /* ========= Core Engine ========= */

  private executeSwap(
    account: Hex,
    from: AssetSymbol,
    to: AssetSymbol,
  ): void {
    const balances = this.balancesByAccount.get(account);
    if (!balances) return;

    const amountIn = 10n ** ASSETS[from].decimals;
    if (BigInt(balances[from]) < amountIn) return;

    const rate = getVolatileRate(Date.now());
    const { amountOut, fee } = this.computeSwap(from, to, amountIn, rate);

    this.applySwap(account, from, to, amountIn, amountOut, fee, rate);
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
    from: AssetSymbol,
    to: AssetSymbol,
    amountIn: bigint,
    amountOut: bigint,
    fee: bigint,
    rate: bigint,
  ): void {
    const balances = this.balancesByAccount.get(account)!;

    balances[from] = `0x${(BigInt(balances[from]) - amountIn).toString(16)}`;
    balances[to] = `0x${(BigInt(balances[to]) + amountOut).toString(16)}`;

    const balanceChanges: BalanceChange[] = [
      {
        account,
        asset: from,
        delta: `-0x${amountIn.toString(16)}`,
      },
      {
        account,
        asset: to,
        delta: `0x${amountOut.toString(16)}`,
      },
    ];

    const tx: SwapTransaction = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      operation: 'swap',
      account,
      rateUsed: rate,
      feePaid: `0x${fee.toString(16)}`,
      balanceChanges,
      status: 'confirmed',
    };

    this.transactions.push(tx);
    this.emit('transactionCreated', tx);
  }
}

export default AutoSwapController;
