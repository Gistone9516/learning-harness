"""
monetization - SKU / premium button / entitlement.  [niche]

WHAT : Premium SKU purchase button and entitlement lookup. Only useful for monetized apps.
DEPS : discord.py>=2.6
PERMS: The app must have monetization enabled in the developer portal.
USAGE: btn = premium_button(SKU_ID)            # discord.ui.Button(style=premium, sku_id=...)
       skus = await CLIENT.fetch_skus()         # fetch available SKUs
SAFETY: Payment-related. Use with care.
DEMO: python harness/community/monetization.py  (checks availability)
"""

import discord


def premium_button(sku_id: int) -> discord.ui.Button:
    # Create a premium-style button linked to the given SKU ID.
    return discord.ui.Button(style=discord.ButtonStyle.premium, sku_id=sku_id)


if __name__ == "__main__":
    try:
        premium_button(123)
        ok = True
    except Exception:
        ok = False
    print("monetization: premium_button available =", ok)
