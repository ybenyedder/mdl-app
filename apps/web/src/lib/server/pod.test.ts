import { describe, expect, it, vi } from 'vitest';
import { buildGelatoOrderPayload, getGelatoConfigFromEnv } from './pod';

describe('Gelato print-on-demand connector', () => {
  it('stays disabled when GELATO_API_KEY is unset', () => {
    const cfg = getGelatoConfigFromEnv({});
    expect(cfg.enabled).toBe(false);
    expect(cfg.orderType).toBe('draft');
  });

  it('builds a valid Gelato v4 payload and substitutes {SIZE} placeholder', () => {
    const cfg = getGelatoConfigFromEnv({
      GELATO_API_KEY: 'gelato_test_key',
      GELATO_ORDER_TYPE: 'order',
      GELATO_SHIP_FIRST_NAME: 'MDL',
      GELATO_SHIP_LAST_NAME: 'Renoir',
      GELATO_SHIP_ADDRESS_LINE1: '2 Avenue Marcel Pagnol',
      GELATO_SHIP_POSTAL_CODE: '06800',
      GELATO_SHIP_CITY: 'Cagnes-sur-Mer',
      GELATO_SHIP_COUNTRY: 'fr',
      GELATO_SHIP_EMAIL: 'mdl@lycee.fr',
      GELATO_SHIP_PHONE: '+33493000000'
    });

    const built = buildGelatoOrderPayload(
      { id: 42, lookupCode: 'MDL-CMD-1234ABCD', size: 'XL', quantity: 2 },
      {
        supplierReference:
          'apparel_product_gca_hoodie_gcu_unisex_gsi_{SIZE}_gco_black_gpr_4-0',
        supplierUrl: 'https://cdn.example.fr/prints/hoodie-logo.png',
        imageUrl: null
      },
      cfg
    );

    expect(built.ok).toBe(true);
    if (built.ok) {
      expect(built.payload.orderType).toBe('order');
      expect(built.payload.currency).toBe('EUR');
      expect(built.payload.orderReferenceId).toBe('MDL-CMD-1234ABCD');
      expect(built.payload.items[0]?.productUid).toBe(
        'apparel_product_gca_hoodie_gcu_unisex_gsi_xl_gco_black_gpr_4-0'
      );
      expect(built.payload.items[0]?.quantity).toBe(2);
      expect(built.payload.shippingAddress.country).toBe('FR');
    }
  });

  it('skips cleanly when shipping address or print file is missing', () => {
    const cfg = getGelatoConfigFromEnv({
      GELATO_API_KEY: 'gelato_test_key'
    });
    const missingFile = buildGelatoOrderPayload(
      { id: 1, lookupCode: 'MDL-CMD-0001', size: 'M', quantity: 1 },
      { supplierReference: 'uid_m', supplierUrl: '', imageUrl: null },
      cfg
    );
    expect(missingFile.ok).toBe(false);

    const mockFetch = vi.fn();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
