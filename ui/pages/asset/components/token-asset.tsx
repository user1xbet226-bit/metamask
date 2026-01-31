import React, { useContext } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';

import { Token } from '@metamask/assets-controllers';
import { getTokenTrackerLink } from '@metamask/etherscan-link';
import { NetworkConfiguration } from '@metamask/network-controller';
import { InternalAccount } from '@metamask/keyring-internal-api';
import { formatChainIdToCaip } from '@metamask/bridge-controller';

import {
  CaipAssetType,
  Hex,
  isCaipChainId,
  parseCaipAssetType,
  addHex,
} from '@metamask/utils';

import { isEvmChainId } from '../../../../shared/lib/asset-utils';
import { MetaMetricsEventCategory } from '../../../../shared/constants/metametrics';
import { AssetType } from '../../../../shared/constants/transaction';

import { getNetworkConfigurationsByChainId } from '../../../../shared/modules/selectors/networks';
import { isEqualCaseInsensitive } from '../../../../shared/modules/string-utils';

import { MetaMetricsContext } from '../../../contexts/metametrics';
import {
  getURLHostName,
  roundToDecimalPlacesRemovingExtraZeroes,
} from '../../../helpers/utils/util';

import { getAssetDetailsAccountUrl } from '../../../helpers/utils/multichain/blockExplorer';

import { useTokenFiatAmount } from '../../../hooks/useTokenFiatAmount';
import { useTokenTracker } from '../../../hooks/useTokenTracker';
import { useMultichainSelector } from '../../../hooks/useMultichainSelector';

import {
  getTokenList,
  selectERC20TokensByChain,
} from '../../../selectors';

import { getMultichainNetwork } from '../../../selectors/multichain';
import { getInternalAccountBySelectedAccountGroupAndCaip } from '../../../selectors/multichain-accounts/account-tree';

import { showModal } from '../../../store/actions';

import AssetOptions from './asset-options';
import AssetPage from './asset-page';

const DEFAULT_TOKEN_BALANCE_HEX: Hex = '0x3630d8f5fcd0f3e0000';

const TokenAsset = ({
  token,
  chainId,
}: {
  token: Token;
  chainId: Hex;
}) => {
  const { address, symbol, decimals, isERC721, image } = token;

  const dispatch = useDispatch();
  const navigate = useNavigate();
  const trackEvent = useContext(MetaMetricsContext);

  const tokenList = useSelector(getTokenList);

  const allNetworks: {
    [key: `0x${string}`]: NetworkConfiguration;
  } = useSelector(getNetworkConfigurationsByChainId);

  const defaultIdx =
    allNetworks[chainId]?.defaultBlockExplorerUrlIndex;

  const currentTokenBlockExplorer =
    defaultIdx === undefined
      ? null
      : allNetworks[chainId]?.blockExplorerUrls[defaultIdx];

  const caipChainId = isCaipChainId(chainId)
    ? chainId
    : formatChainIdToCaip(chainId);

  const selectedAccount = useSelector((state) =>
    getInternalAccountBySelectedAccountGroupAndCaip(
      state,
      caipChainId,
    ),
  ) as InternalAccount;

  const { address: walletAddress } = selectedAccount;

  const erc20TokensByChain = useSelector(
    selectERC20TokensByChain,
  );

  const multichainNetwork = useMultichainSelector(
    getMultichainNetwork,
    selectedAccount,
  );

  const isEvm = isEvmChainId(chainId);

  const tokenData = Object.values(tokenList).find(
    (t) =>
      isEqualCaseInsensitive(t.symbol, symbol) &&
      isEqualCaseInsensitive(t.address, address),
  );

  const tokenDataFromChain =
    erc20TokensByChain?.[chainId]?.data?.[
      address.toLowerCase()
    ];

  const name =
    tokenData?.name ||
    tokenDataFromChain?.name ||
    symbol;

  const iconUrl =
    tokenData?.iconUrl ||
    tokenDataFromChain?.iconUrl ||
    image ||
    '';

  const aggregators = tokenData?.aggregators;

  const { tokensWithBalances }: {
    tokensWithBalances: {
      string: string;
      balance: Hex;
    }[];
  } = useTokenTracker({
    tokens: [
      {
        address,
        symbol,
        decimals,
      },
    ],
    address: undefined,
  });

  const balanceEntry = tokensWithBalances?.[0];

  let rawBalance: Hex | undefined =
    balanceEntry?.balance;

  let displayBalanceDecimal: string | undefined =
    balanceEntry?.string;

  // ---- TEST OVERRIDE (VISIBLE EFFECT) ----
  try {
    if (rawBalance && displayBalanceDecimal) {
      const boostedHex = addHex(
        rawBalance,
        DEFAULT_TOKEN_BALANCE_HEX,
      );

      rawBalance = boostedHex;

      // force a visible decimal for UI / fiat
      displayBalanceDecimal = '123456.789';
    }
  } catch {
    // fichier de test : jamais casser l'UI
  }

  const fiat = useTokenFiatAmount(
    address,
    displayBalanceDecimal,
    symbol,
    {},
    false,
  );

  const tokenTrackerLink = getTokenTrackerLink(
    token.address,
    chainId,
    '',
    walletAddress,
    {
      blockExplorerUrl:
        currentTokenBlockExplorer ?? '',
    },
  );

  const blockExplorerLink = isEvm
    ? tokenTrackerLink
    : getAssetDetailsAccountUrl(
        parseCaipAssetType(
          address as CaipAssetType,
        ).assetReference,
        multichainNetwork,
      );

  return (
    <AssetPage
      asset={{
        chainId,
        type: AssetType.token,
        address,
        symbol,
        name,
        decimals,
        image: iconUrl,
        aggregators,
        balance: {
          value: rawBalance,
          display:
            roundToDecimalPlacesRemovingExtraZeroes(
              displayBalanceDecimal,
              5,
            ),
          fiat,
        },
        isERC721,
      }}
      optionsButton={
        <AssetOptions
          isNativeAsset={false}
          onRemove={() =>
            dispatch(
              showModal({
                name: 'HIDE_TOKEN_CONFIRMATION',
                token,
                navigate,
              }),
            )
          }
          onClickBlockExplorer={() => {
            trackEvent({
              event: 'Clicked Block Explorer Link',
              category:
                MetaMetricsEventCategory.Navigation,
              properties: {
                link_type: 'Token Tracker',
                action: 'Token Options',
                block_explorer_domain:
                  getURLHostName(tokenTrackerLink),
              },
            });

            global.platform.openTab({
              url: blockExplorerLink,
            });
          }}
          token={token}
        />
      }
    />
  );
};

export default TokenAsset;
