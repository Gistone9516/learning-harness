"""
botinvite - Generate a bot re-invite OAuth URL.

WHAT  : Builds a bot invite URL with the required permissions and scopes
        (threads / webhooks / files / slash commands each need extra perms).
DEPS  : (standard library only)
PERMS : See _PERMS dict below for the individual permission bits used.
USAGE : print(invite_url(CLIENT_ID))                   # recommended perms + applications.commands
        print(invite_url(CLIENT_ID, permissions=INT))  # custom permission integer
SAFETY: client_id is NOT a secret (unlike a bot token). Never expose the token.
DEMO  : python harness/meta/botinvite.py   (prints recommended permission integer and URL)
"""

from typing import Optional

_PERMS = {
    "View Channel": 1 << 10, "Send Messages": 1 << 11, "Embed Links": 1 << 14,
    "Attach Files": 1 << 15, "Read History": 1 << 16, "Add Reactions": 1 << 6,
    "Manage Channels": 1 << 4, "Manage Messages": 1 << 13, "Manage Webhooks": 1 << 29,
    "Create Public Threads": 1 << 35, "Send Messages in Threads": 1 << 38, "Manage Threads": 1 << 34,
}


def recommended_permissions() -> int:
    """Return the bitwise OR of all recommended permission flags."""
    v = 0
    for b in _PERMS.values():
        v |= b
    return v


def invite_url(
    client_id: str,
    permissions: Optional[int] = None,
    scopes: str = "bot+applications.commands",
) -> str:
    """Build and return a Discord OAuth2 bot invite URL.

    Args:
        client_id:   The bot application client ID (not secret).
        permissions: Permission integer to request. Defaults to recommended_permissions().
        scopes:      OAuth2 scope string. Default includes slash-command registration.

    Returns:
        A fully formed Discord invite URL string.
    """
    p = recommended_permissions() if permissions is None else permissions
    return (
        f"https://discord.com/api/oauth2/authorize"
        f"?client_id={client_id}&permissions={p}&scope={scopes}"
    )


if __name__ == "__main__":
    print("Recommended permission integer:", recommended_permissions())
    print(invite_url("CLIENT_ID"))
