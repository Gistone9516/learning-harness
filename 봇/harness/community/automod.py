"""
automod - AutoMod rule utilities.  [niche / low-traffic]

WHAT : Fetch guild AutoMod rules (keyword filtering, etc.).
       Creating rules requires version-specific argument validation.
DEPS : discord.py>=2.6
PERMS: Manage Guild
USAGE: rules = await list_rules(guild)
       # To create: guild.create_automod_rule(...)
       # (check argument names for your discord.py version)
SAFETY: Requires Manage Guild permission. Use with care.
DEMO  : python harness/community/automod.py
"""

from typing import List, Any


async def list_rules(guild: Any) -> List[Any]:
    try:
        return await guild.fetch_automod_rules()
    except Exception:
        return []


if __name__ == "__main__":
    print("automod: await list_rules(guild).  To create rules, see guild.create_automod_rule(...).")
