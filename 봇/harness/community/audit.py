"""
audit - Read guild audit logs.  [non-core]

WHAT  : Reads guild audit log entries (who did what).
DEPS  : discord.py>=2.6
PERMS : View Audit Log
USAGE : entries = await recent_audit(guild, limit=20)
SAFETY: Read-only. Be careful not to expose sensitive information.
DEMO  : python harness/community/audit.py  (guidance)
"""

from typing import List, Optional
import discord


async def recent_audit(
    guild: "discord.Guild",
    limit: int = 20,
    action: Optional[discord.AuditLogAction] = None,
) -> List[discord.AuditLogEntry]:
    out: List[discord.AuditLogEntry] = []
    try:
        async for e in guild.audit_logs(limit=limit, action=action):
            out.append(e)
    except Exception:
        pass
    return out


if __name__ == "__main__":
    print("audit: entries = await recent_audit(guild, 20)")
