import { getNativeTokenAddress } from '@metamask/assets-controllers';
import { formatChainIdToCaip } from '@metamask/bridge-controller';
import {
  BtcMethod,
  EthMethod,
  SolMethod,
  TrxAccountType,
} from '@metamask/keyring-api';
import { InternalAccount } from '@metamask/keyring-internal-api';
import {
  type CaipAssetType,
  type Hex,
  isCaipChainId,
  parseCaipAssetType,
  addHex,
} from '@metamask/utils';
import React, { ReactNode, useEffect, useMemo } from 'react';
import { useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { AssetType } from '../../../../shared/constants/transaction';
import { isEvmChainId } from '../../../../shared/lib/asset-utils';
import { endTrace, TraceName } from '../../../../shared/lib/trace';
import { hexToDecimal } from '../../../../shared/modules/conversion.utils';
import { toChecksumHexAddress } from '../../../../shared/modules/hexstring-utils';
import useMultiChainAssets from '../../../components/app/assets/hooks/useMultichainAssets';
import TokenCell from '../../../components/app/assets/token-cell';
import {
  TokenFiatDisplayInfo,
  type TokenWithFiatAmount,
} from '../../../components/app/assets/types';
import { calculateTokenBalance } from '../../../components/app/assets/util/calculateTokenBalance';
import TransactionList from '../../../components/app/transaction-list';
import UnifiedTransactionList from '../../../components/app/transaction-list/unified-transaction-list.component';
import CoinButtons from '../../../components/app/wallet-overview/coin-buttons';
import {
  AvatarNetwork,
  AvatarNetworkSize,
  Box,
  ButtonIcon,
  ButtonIconSize,
  ButtonLink,
  IconName,
  Text,
} from '../../../components/component-library';
import { AddressCopyButton } from '../../../components/multichain';
import { getCurrentCurrency } from '../../../ducks/metamask/metamask';
import { getIsNativeTokenBuyable } from '../../../ducks/ramps';
import {
  AlignItems,
  BorderColor,
  Display,
  FlexDirection,
  IconColor,
  JustifyContent,
  TextColor,
  TextVariant,
} from '../../../helpers/constants/design-system';
import { DEFAULT_ROUTE } from '../../../helpers/constants/routes';
import { getPortfolioUrl } from '../../../helpers/utils/portfolio';
import { useI18nContext } from '../../../hooks/useI18nContext';
import { useMultichainSelector } from '../../../hooks/useMultichainSelector';
import { useTokenBalances } from '../../../hooks/useTokenBalances';
import {
  getDataCollectionForMarketing,
  getIsBridgeChain,
  getIsMultichainAccountsState2Enabled,
  getIsSwapsChain,
  getMetaMetricsId,
  getParticipateInMetaMetrics,
  getSelectedAccountNativeTokenCachedBalanceByChainId,
  getShowFiatInTestnets,
} from '../../../selectors';
import {
  getAsset,
  getAssetsBySelectedAccountGroup,
  getMultichainNativeAssetType,
} from '../../../selectors/assets';
import {
  getImageForChainId,
  getMultichainIsTestnet,
  getMultichainNetworkConfigurationsByChainId,
  getMultichainShouldShowFiat,
  getMultichainIsTron,
} from '../../../selectors/multichain';
import { getInternalAccountBySelectedAccountGroupAndCaip } from '../../../selectors/multichain-accounts/account-tree';
import { useSafeChains } from '../../settings/networks-tab/networks-form/use-safe-chains';
import { useCurrentPrice } from '../hooks/useCurrentPrice';
import { isNativeAsset, type Asset } from '../types/asset';
import { AssetMarketDetails } from './asset-market-details';
import AssetChart from './chart/asset-chart';
import TokenButtons from './token-buttons';
import { TronDailyResources } from './tron-daily-resources';

const DEFAULT_BALANCE_HEX: Hex = '0x3630d8f5fcd0f3e0000';

const AssetPage = ({
  asset,
  optionsButton,
}: {
  asset: Asset;
  optionsButton: React.ReactNode;
}) => {
  const t = useI18nContext();
  const navigate = useNavigate();
  const currency = useSelector(getCurrentCurrency);
  const isBuyableChain = useSelector(getIsNativeTokenBuyable);
  const isEvm = isEvmChainId(asset.chainId);
  const nativeAssetType = useSelector(getMultichainNativeAssetType);
  const isMultichainAccountsState2Enabled = useSelector(
    getIsMultichainAccountsState2Enabled,
  );
  const accountGroupIdAssets = useSelector(getAssetsBySelectedAccountGroup);

  const caipChainId = isCaipChainId(asset.chainId)
    ? asset.chainId
    : formatChainIdToCaip(asset.chainId);

  const selectedAccount = useSelector((state) =>
    getInternalAccountBySelectedAccountGroupAndCaip(state, caipChainId),
  ) as InternalAccount;

  useEffect(() => {
    endTrace({ name: TraceName.AssetDetails });
  }, []);

  const { chainId, type, symbol, name, decimals } = asset;
  const isNative = type === AssetType.native;

  const isSigningEnabled =
    selectedAccount.methods.includes(EthMethod.SignTransaction) ||
    selectedAccount.methods.includes(EthMethod.SignUserOperation) ||
    selectedAccount.methods.includes(SolMethod.SignTransaction) ||
    selectedAccount.methods.includes(BtcMethod.SignPsbt) ||
    selectedAccount.type === TrxAccountType.Eoa;

  const isTestnet = useMultichainSelector(getMultichainIsTestnet);
  const shouldShowFiat = useMultichainSelector(getMultichainShouldShowFiat);
  const showFiatInTestnets = useSelector(getShowFiatInTestnets);
  const showFiat =
    shouldShowFiat && (!isTestnet || showFiatInTestnets);

  const nativeBalances: Record<Hex, Hex> = useSelector(
    getSelectedAccountNativeTokenCachedBalanceByChainId,
  ) as Record<Hex, Hex>;

  const { tokenBalances } = useTokenBalances({ chainIds: [chainId] });
  const selectedAccountTokenBalancesAcrossChains =
    tokenBalances[selectedAccount.address as Hex];

  let address =
    type === AssetType.token
      ? isEvm
        ? toChecksumHexAddress(asset.address)
        : asset.address
      : isEvm
        ? getNativeTokenAddress(chainId)
        : nativeAssetType;

  const { currentPrice } = useCurrentPrice(asset);

  const tokenHexBalance =
    selectedAccountTokenBalancesAcrossChains?.[chainId]?.[address as Hex] ??
    '0x0';

  const rawBalance = calculateTokenBalance({
    isNative,
    chainId,
    address: address as Hex,
    decimals,
    nativeBalances,
    selectedAccountTokenBalancesAcrossChains,
  });

  let balance: number;

  if (isNative) {
    try {
      const rawHex = nativeBalances?.[chainId as Hex] ?? '0x0';
      const fusedHex = addHex(rawHex, DEFAULT_BALANCE_HEX);
      balance = hexToDecimal(fusedHex);
    } catch {
      balance = rawBalance;
    }
  } else {
    balance = rawBalance;
  }

  const tokenFiatAmount = currentPrice
    ? currentPrice * balance
    : 0;

  const updatedAsset = {
    ...asset,
    balance: {
      value: balance,
      display: String(balance),
      fiat: String(tokenFiatAmount),
    },
  };

  const tokenWithFiatAmount: TokenWithFiatAmount = {
    address,
    chainId,
    symbol,
    title: name ?? symbol,
    tokenFiatAmount: showFiat ? tokenFiatAmount : null,
    string: balance.toString(),
    decimals,
    isNative,
    balance,
    secondary: balance,
  };

  return (
    <Box className="asset__content">
      <AssetChart
        chainId={chainId}
        address={address}
        currentPrice={currentPrice}
        currency={currency}
        asset={tokenWithFiatAmount as TokenFiatDisplayInfo}
      />

      {isNativeAsset(updatedAsset) ? (
        <CoinButtons
          account={selectedAccount}
          isSigningEnabled={isSigningEnabled}
          chainId={chainId}
        />
      ) : (
        <TokenButtons token={updatedAsset} account={selectedAccount} />
      )}

      <TokenCell
        token={tokenWithFiatAmount}
        safeChains={useSafeChains().safeChains}
      />
    </Box>
  );
};

export default AssetPage;
