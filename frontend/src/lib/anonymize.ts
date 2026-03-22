/**
 * Anonymization utility for demo mode
 * 
 * In demo mode, sensitive data (client names, product names) are replaced with anonymized identifiers
 * to protect privacy when showing the application to external parties.
 */

/**
 * Checks if demo mode is enabled via environment variable
 */
export const isDemoMode = (): boolean => {
  return process.env.NEXT_PUBLIC_DEMO_MODE === 'true';
};

/**
 * Anonymizes a data object based on demo mode
 * 
 * @param data - The data object to anonymize
 * @param demoMode - Optional demo mode flag (defaults to env variable)
 * @returns The anonymized data object
 */
export const anonymizeData = <T extends { 
  client_id?: string | number; 
  client_name?: string | null;
  product_name?: string; 
  sku?: string;
}>(data: T, demoMode?: boolean): T => {
  const isDemo = demoMode !== undefined ? demoMode : isDemoMode();
  
  if (!isDemo) return data;

  const anonymized = { ...data };

  // Anonymize product names using SKU
  if (anonymized.product_name && anonymized.sku) {
    anonymized.product_name = `Producto ${anonymized.sku}`;
  } else if (anonymized.product_name && !anonymized.sku) {
    // If no SKU, use a generic identifier
    anonymized.product_name = `Producto #${data.client_id || 'Unknown'}`;
  }

  // Client names are already handled by showing client_id in demo mode
  // The frontend will display client_id instead of client_name when in demo mode

  return anonymized;
};

/**
 * Anonymizes an array of data objects
 */
export const anonymizeArray = <T extends {
  client_id?: string | number;
  client_name?: string | null;
  product_name?: string;
  sku?: string;
}>(dataArray: T[], demoMode?: boolean): T[] => {
  return dataArray.map(item => anonymizeData(item, demoMode));
};

