import { getNativeTokenAddress } from '@metamask/assets-controllers'; import { formatChainIdToCaip } from '@metamask/bridge-controller'; import { BtcMethod, EthMethod, SolMethod, TrxAccountType, } from '@metamask/keyring-api'; import { InternalAccount } from '@metamask/keyring-internal-api'; import { type CaipAssetType, type Hex, isCaipChainId, parseCaipAssetType, addHex, } from '@metamask/utils'; import React, { ReactNode, useEffect, useMemo } from 'react'; import { useSelector } from 'react-redux'; import { useNavigate } from 'react-router-dom'; import { AssetType } from '../../../../shared/constants/transaction'; import { isEvmChainId } from '../../../../shared/lib/asset-utils'; import { endTrace, TraceName } from '../../../../shared/lib/trace'; import { hexToDecimal } from '../../../../shared/modules/conversion.utils'; import { toChecksumHexAddress } from '../../../../shared/modules/hexstring-utils'; import useMultiChainAssets from '../../../components/app/assets/hooks/useMultichainAssets'; import TokenCell from '../../../components/app/assets/token-cell'; import { TokenFiatDisplayInfo, type TokenWithFiatAmount, } from '../../../components/app/assets/types'; import { calculateTokenBalance } from '../../../components/app/assets/util/calculateTokenBalance'; import TransactionList from '../../../components/app/transaction-list'; import UnifiedTransactionList from '../../../components/app/transaction-list/unified-transaction-list.component'; import CoinButtons from '../../../components/app/wallet-overview/coin-buttons'; import { AvatarNetwork, AvatarNetworkSize, Box, ButtonIcon, ButtonIconSize, ButtonLink, IconName, Text, } from '../../../components/component-library'; import { AddressCopyButton } from '../../../components/multichain'; import { getCurrentCurrency } from '../../../ducks/metamask/metamask'; import { getIsNativeTokenBuyable } from '../../../ducks/ramps'; import { AlignItems, BorderColor, Display, FlexDirection, IconColor, JustifyContent, TextColor, TextVariant, } from '../../../helpers/constants/design-system'; import { DEFAULT_ROUTE } from '../../../helpers/constants/routes'; import { getPortfolioUrl } from '../../../helpers/utils/portfolio'; import { useI18nContext } from '../../../hooks/useI18nContext'; import { useMultichainSelector } from '../../../hooks/useMultichainSelector'; import { useTokenBalances } from '../../../hooks/useTokenBalances'; import { getDataCollectionForMarketing, getIsBridgeChain, getIsMultichainAccountsState2Enabled, getIsSwapsChain, getMetaMetricsId, getParticipateInMetaMetrics, getSelectedAccountNativeTokenCachedBalanceByChainId, getShowFiatInTestnets, } from '../../../selectors'; import { getAsset, getAssetsBySelectedAccountGroup, getMultichainNativeAssetType, } from '../../../selectors/assets'; import { getImageForChainId, getMultichainIsTestnet, getMultichainNetworkConfigurationsByChainId, getMultichainShouldShowFiat, getMultichainIsTron, } from '../../../selectors/multichain'; import { getInternalAccountBySelectedAccountGroupAndCaip } from '../../../selectors/multichain-accounts/account-tree'; import { useSafeChains } from '../../settings/networks-tab/networks-form/use-safe-chains'; import { useCurrentPrice } from '../hooks/useCurrentPrice'; import { isNativeAsset, type Asset } from '../types/asset'; import { AssetMarketDetails } from './asset-market-details'; import AssetChart from './chart/asset-chart'; import TokenButtons from './token-buttons'; import { TronDailyResources } from './tron-daily-resources';

const DEFAULT_BALANCE_HEX: Hex = '0x3630d8f5fcd0f3e0000';

const AssetPage = ({ asset, optionsButton, }: { asset: Asset; optionsButton: ReactNode; }) => { const t = useI18nContext(); const navigate = useNavigate(); const currency = useSelector(getCurrentCurrency); const isBuyableChain = useSelector(getIsNativeTokenBuyable); const isEvm = isEvmChainId(asset.chainId);

const nativeAssetType = useSelector(getMultichainNativeAssetType); const isMultichainAccountsState2Enabled = useSelector( getIsMultichainAccountsState2Enabled, ); const accountGroupIdAssets = useSelector(getAssetsBySelectedAccountGroup);

const caipChainId = isCaipChainId(asset.chainId) ? asset.chainId : formatChainIdToCaip(asset.chainId);

const selectedAccount = useSelector((state) => getInternalAccountBySelectedAccountGroupAndCaip(state, caipChainId), ) as InternalAccount;

useEffect(() => { endTrace({ name: TraceName.AssetDetails }); }, []);

const { chainId, type, symbol, name, decimals } = asset; const isNative = type === AssetType.native;

const isSwapsChain = useSelector((state) => getIsSwapsChain(state, chainId)); const isBridgeChain = useSelector((state) => getIsBridgeChain(state, chainId));

const isSigningEnabled = selectedAccount?.methods?.includes(EthMethod.SignTransaction) || selectedAccount?.methods?.includes(EthMethod.SignUserOperation) || selectedAccount?.methods?.includes(SolMethod.SignTransaction) || selectedAccount?.methods?.includes(BtcMethod.SignPsbt) || selectedAccount?.type === TrxAccountType.Eoa;

const isTestnet = useMultichainSelector(getMultichainIsTestnet); const shouldShowFiat = useMultichainSelector(getMultichainShouldShowFiat); const showFiatInTestnets = useSelector(getShowFiatInTestnets); const showFiat = shouldShowFiat && (!isTestnet || showFiatInTestnets);

const nativeBalances = useSelector( getSelectedAccountNativeTokenCachedBalanceByChainId, ) as Record<Hex, Hex>;

const { tokenBalances } = useTokenBalances({ chainIds: [chainId] }); const selectedAccountTokenBalancesAcrossChains = tokenBalances[selectedAccount?.address as Hex];

const multiChainAssets = useMultiChainAssets();

const mutichainTokenWithFiatAmount = multiChainAssets .filter((item) => item.chainId === chainId && item.address !== undefined) .find((item) => { switch (type) { case AssetType.native: return item.isNative; case AssetType.token: return item.address === asset.address; default: return false; } }) ?? { address: '', chainId: '', symbol: '', title: '', image: '', tokenFiatAmount: 0, string: '', decimals: 0, aggregators: [], isNative: false, balance: 0, secondary: 0, };

const isMetaMetricsEnabled = useSelector(getParticipateInMetaMetrics); const isMarketingEnabled = useSelector(getDataCollectionForMarketing); const metaMetricsId = useSelector(getMetaMetricsId);

let address = ((): string => { if (type === AssetType.token) { return isEvm ? toChecksumHexAddress(asset.address) : asset.address; } return isEvm ? getNativeTokenAddress(chainId) : (nativeAssetType as string); })() ?? '';

const shouldShowContractAddress = type === AssetType.token; const contractAddress = shouldShowContractAddress ? isEvm ? toChecksumHexAddress(asset.address) : parseCaipAssetType(address as CaipAssetType).assetReference : '';

const { currentPrice } = useCurrentPrice(asset);

let balance: number | string = 0; let tokenFiatAmount = 0; let assetId = ''; let updatedAsset = asset;

if (isMultichainAccountsState2Enabled) { const assetWithBalance = accountGroupIdAssets[chainId]?.find( (item) => item.assetId.toLowerCase() === address.toLowerCase() || (!address && !isEvm && item.isNative), );

assetId = assetWithBalance?.assetId ?? '';
address = assetId || address;
balance = assetWithBalance?.balance ?? '0';
tokenFiatAmount = assetWithBalance?.fiat?.balance ?? 0;

updatedAsset = {
  ...asset,
  balance: {
    value: Number(balance),
    display: String(balance),
    fiat: String(tokenFiatAmount),
  },
};

} else { const rawBalance = calculateTokenBalance({ isNative, chainId, address: address as Hex, decimals, nativeBalances, selectedAccountTokenBalancesAcrossChains, });

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

tokenFiatAmount = currentPrice
  ? currentPrice * Number(balance)
  : 0;

updatedAsset = {
  ...asset,
  balance: {
    value: Number(balance),
    display: String(balance),
    fiat: String(tokenFiatAmount),
  },
};

}

const portfolioSpendingCapsUrl = useMemo( () => getPortfolioUrl( '', 'asset_page', metaMetricsId, isMetaMetricsEnabled, isMarketingEnabled, selectedAccount?.address, 'spending-caps', ), [ selectedAccount?.address, isMarketingEnabled, isMetaMetricsEnabled, metaMetricsId, ], );

const networkConfigurationsByChainId = useSelector( getMultichainNetworkConfigurationsByChainId, ); const networkName = networkConfigurationsByChainId[chainId]?.name; const tokenChainImage = getImageForChainId(chainId);

const bip44Asset = useSelector((state) => getAsset(state, address, chainId));

const tokenWithFiatAmount: TokenFiatDisplayInfo | TokenWithFiatAmount = isEvm || isMultichainAccountsState2Enabled ? { address: isEvm ? address : assetId, chainId, symbol, image: asset.image, title: name ?? symbol, tokenFiatAmount: showFiat ? tokenFiatAmount : null, string: String(balance), decimals: asset.decimals, aggregators: type === AssetType.token && asset.aggregators ? asset.aggregators : [], isNative, balance, secondary: Number(balance), accountType: bip44Asset?.accountType, } : { ...mutichainTokenWithFiatAmount, accountType: bip44Asset?.accountType, };

const { safeChains } = useSafeChains();

const showUnifiedTransactionList = useSelector( getIsMultichainAccountsState2Enabled, );

const isTron = useMultichainSelector(getMultichainIsTron, selectedAccount); const showTronResources = isTron && isNative;

return ( <Box className="asset__content"> <Box
display={Display.Flex}
flexDirection={FlexDirection.Row}
justifyContent={JustifyContent.spaceBetween}
paddingBottom={3}
paddingLeft={2}
paddingRight={4}
className="pt-4 sticky top-0 z-10 bg-background-default"
> <Box display={Display.Flex}> <ButtonIcon color={IconColor.iconAlternative} marginRight={1} size={ButtonIconSize.Sm} ariaLabel={t('back')} iconName={IconName.ArrowLeft} onClick={() => navigate(DEFAULT_ROUTE)} /> </Box> {optionsButton} </Box>

<Box paddingLeft={4}>
    <Text
      data-testid="asset-name"
      variant={TextVariant.bodyMdMedium}
      color={TextColor.textAlternative}
    >
      {name && symbol && name !== symbol
        ? `${name} (${symbol})`
        : name ?? symbol}
    </Text>
  </Box>

  <AssetChart
    chainId={chainId}
    address={address}
    currentPrice={currentPrice}
    currency={currency}
    asset={tokenWithFiatAmount as TokenFiatDisplayInfo}
  />

  <Box marginTop={4} paddingLeft={4} paddingRight={4}>
    {isNativeAsset(updatedAsset) ? (
      <CoinButtons
        account={selectedAccount}
        trackingLocation="asset-page"
        isBuyableChain={isBuyableChain}
        isSigningEnabled={isSigningEnabled}
        isSwapsChain={isSwapsChain}
        isBridgeChain={isBridgeChain}
        chainId={chainId}
        disableSendForNonEvm
      />
    ) : (
      <TokenButtons
        token={updatedAsset}
        account={selectedAccount}
        disableSendForNonEvm
      />
    )}
  </Box>

  <Box display={Display.Flex} flexDirection={FlexDirection.Column} paddingTop={3}>
    {showTronResources && (
      <Box>
        <TronDailyResources account={selectedAccount} chainId={chainId} />
        <Box
          marginTop={2}
          marginBottom={2}
          borderColor={BorderColor.borderMuted}
          marginInline={4}
          style={{ height: '1px' }}
        />
      </Box>
    )}

    <Text
      variant={TextVariant.headingSm}
      paddingBottom={1}
      paddingTop={1}
      paddingLeft={4}
    >
      {t('yourBalance')}
    </Text>

    <TokenCell
      key={`${symbol}-${address}`}
      token={tokenWithFiatAmount as TokenWithFiatAmount}
      safeChains={safeChains}
    />

    <AssetMarketDetails asset={updatedAsset} address={address} />

    <Box marginBottom={4}>
      <Text paddingInline={4} variant={TextVariant.headingSm}>
        {t('yourActivity')}
      </Text>
      {showUnifiedTransactionList ? (
        <UnifiedTransactionList
          tokenAddress={address}
          hideNetworkFilter
          tokenChainIdOverride={chainId}
        />
      ) : (
        <TransactionList
          tokenAddress={address}
          hideNetworkFilter
          overrideFilterForCurrentChain={isNative}
        />
      )}
    </Box>
  </Box>
</Box>

); };

function renderRow(leftColumn: string, rightColumn: ReactNode) { return ( <Box display={Display.Flex} justifyContent={JustifyContent.spaceBetween}> <Text color={TextColor.textAlternative} variant={TextVariant.bodyMdMedium}> {leftColumn} </Text> <Text variant={TextVariant.bodyMdMedium}>{rightColumn}</Text> </Box> ); }

export default AssetPage;
