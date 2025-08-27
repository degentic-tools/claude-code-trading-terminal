// src/constants.js
export const TOOL_NAMES = {
  // Agg API Tools
  GET_SWAP_PRICE: "get_swap_price",
  GET_SWAP_QUOTE: "get_swap_quote",
  EXECUTE_SWAP: "execute_swap",
  GET_SUPPORTED_CHAINS: "get_supported_chains",
  GET_LIQUIDITY_SOURCES: "get_liquidity_sources",

  // Gasless Agg API Tools
  GET_GASLESS_PRICE: "get_gasless_price",
  GET_GASLESS_QUOTE: "get_gasless_quote",
  SUBMIT_GASLESS_SWAP: "submit_gasless_swap",
  GET_GASLESS_STATUS: "get_gasless_status",
  GET_GASLESS_CHAINS: "get_gasless_chains",
  GET_GASLESS_APPROVAL_TOKENS: "get_gasless_approval_tokens",

  // CoinGecko API Tools
  GET_TOKEN_PRICE: "get_token_price",
  GET_COINGECKO_NETWORKS: "get_coingecko_networks",
  GET_SUPPORTED_DEXES: "get_supported_dexes",
  GET_TRENDING_POOLS: "get_trending_pools",
  GET_TRENDING_POOLS_BY_NETWORK: "get_trending_pools_by_network",
  GET_MULTIPLE_POOLS_DATA: "get_multiple_pools_data",
  GET_TOP_POOLS_BY_DEX: "get_top_pools_by_dex",
  GET_NEW_POOLS: "get_new_pools",
  SEARCH_POOLS: "search_pools",

  // Additional CoinGecko API Tools
  GET_TOP_POOLS_BY_TOKEN: "get_top_pools_by_token",
  GET_TOKEN_DATA: "get_token_data",
  GET_MULTIPLE_TOKENS_DATA: "get_multiple_tokens_data",
  GET_TOKEN_INFO: "get_token_info",
  GET_RECENTLY_UPDATED_TOKENS: "get_recently_updated_tokens",
  GET_POOL_OHLCV: "get_pool_ohlcv",
  GET_POOL_TRADES: "get_pool_trades",

  // Portfolio API Tools
  GET_PORTFOLIO_TOKENS: "get_portfolio_tokens",
  GET_PORTFOLIO_BALANCES: "get_portfolio_balances",
  GET_PORTFOLIO_TRANSACTIONS: "get_portfolio_transactions",

  // Conversion Utility Tools
  CONVERT_WEI_TO_FORMATTED: "convert_wei_to_formatted",
  CONVERT_FORMATTED_TO_WEI: "convert_formatted_to_wei",

  // Solana Tools
  GET_SOLANA_BALANCE: "get_solana_balance",
  TRANSFER_SOL: "transfer_sol",
  GET_SOLANA_ACCOUNT_INFO: "get_solana_account_info",
  GET_SOLANA_TRANSACTION_STATUS: "get_solana_transaction_status", 
  GET_SOLANA_TRANSACTION_DETAILS: "get_solana_transaction_details",
  AIRDROP_SOL: "airdrop_sol",
  GET_SOLANA_SUPPORTED_CLUSTERS: "get_solana_supported_clusters",
  GET_SOLANA_SLOT: "get_solana_slot",
  GET_SOLANA_EPOCH_INFO: "get_solana_epoch_info",
  GET_SOLANA_CLUSTER_NODES: "get_solana_cluster_nodes",
  GET_SOLANA_WALLET_ADDRESS: "get_solana_wallet_address",

  // Advanced Solana DEX Trading Tools
  SWAP_ON_SOLANA_DEX: "swap_on_solana_dex",
  GET_SOLANA_DEX_QUOTE: "get_solana_dex_quote",
  CREATE_SOLANA_LIMIT_ORDER: "create_solana_limit_order",
  GET_SOLANA_LIMIT_ORDERS: "get_solana_limit_orders",
  CANCEL_SOLANA_LIMIT_ORDER: "cancel_solana_limit_order",

  // Memecoin Trading Tools
  GET_PUMPFUN_TRENDING: "get_pumpfun_trending",
  GET_PUMPFUN_TOKEN: "get_pumpfun_token",
  QUICK_BUY_MEMECOIN: "quick_buy_memecoin",
  SCAN_NEW_MEMECOINS: "scan_new_memecoins",
};

// Aggregator Server Configuration
export const AG_URL = "http://44.252.136.98";
